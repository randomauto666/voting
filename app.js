/* ---------------------------------------------------------
   Jahresabstimmung – Logik mit Supabase als zentralem Speicher
   und Supabase Auth (E-Mail/Passwort) für den Adminbereich.

   Voten ist weiterhin öffentlich (kein Login nötig). Anlegen/
   Löschen von Feldern und Zurücksetzen der Stimmen erfordert
   eine Anmeldung – abgesichert über RLS-Policies in Supabase
   (siehe supabase.sql), nicht nur über die Oberfläche hier.
--------------------------------------------------------- */

const LS_VOTED = 'ja_voted'; // { [entryId]: true } – nur lokale Klick-Sperre

// Supabase-Projekt: Settings → API. Der "anon"/"publishable" key ist zur
// Verwendung im Browser vorgesehen (kein Geheimnis) – die eigentliche
// Absicherung übernehmen die RLS-Policies in Supabase (siehe supabase.sql).
const SUPABASE_URL = 'https://fofncyaweychquyconmt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_YpaPyjX6jtabCzZZCI7y-w_EuTtvCiF';

let sb = null;
let entries = []; // [{ id, klasse, note, count }]
let votedLocal = {};
let session = null;

/* ---------- Setup ---------- */

function loadVotedLocal() {
  votedLocal = JSON.parse(localStorage.getItem(LS_VOTED) || 'null') || {};
}
function saveVotedLocal() {
  localStorage.setItem(LS_VOTED, JSON.stringify(votedLocal));
}

/* ---------- Daten laden ---------- */

async function fetchEntries() {
  const { data, error } = await sb
    .from('entries')
    .select('id, klasse, note, created_at, votes(count)')
    .order('created_at', { ascending: true });

  if (error) {
    console.error(error);
    showToast('Fehler beim Laden der Daten.');
    return;
  }

  entries = (data || []).map(e => ({
    id: e.id,
    klasse: e.klasse,
    note: e.note,
    count: (e.votes && e.votes[0] && e.votes[0].count) || 0
  }));
}

/* ---------- Hilfsfunktionen ---------- */

function makeId(klasse, note) {
  const base = (klasse + '-' + note).toLowerCase().replace(/\s+/g, '');
  let id = base, n = 1;
  const existing = new Set(entries.map(e => e.id));
  while (existing.has(id)) { n += 1; id = base + '-' + n; }
  return id;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ---------- Öffentliche Ansicht ---------- */

function renderPublic() {
  const grid = document.getElementById('publicGrid');
  if (entries.length === 0) {
    grid.innerHTML = '<div class="empty">Noch keine Felder zum Abstimmen angelegt.</div>';
    return;
  }
  grid.innerHTML = entries.map(e => {
    const voted = !!votedLocal[e.id];
    return `
      <div class="card">
        <div class="field">
          <span class="label">Klasse</span>
          <span class="value">${escapeHtml(e.klasse)}</span>
        </div>
        <div class="field note">
          <span class="label">Note</span>
          <span class="value">${escapeHtml(e.note)}</span>
        </div>
        <button class="vote-btn ${voted ? 'voted' : ''}" data-id="${e.id}" ${voted ? 'disabled' : ''}>
          ${voted ? 'Abgestimmt ✓' : 'Abstimmen'}
        </button>
      </div>`;
  }).join('');

  grid.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', () => castVote(btn.dataset.id));
  });
}

async function castVote(id) {
  if (votedLocal[id]) return;
  votedLocal[id] = true;
  saveVotedLocal();
  renderPublic(); // sofort sperren, kein Doppelklick

  const { error } = await sb.rpc('increment_vote', { p_entry_id: id });
  if (error) {
    console.error(error);
    delete votedLocal[id];
    saveVotedLocal();
    renderPublic();
    showToast('Stimme konnte nicht gespeichert werden.');
    return;
  }
  showToast('Deine Stimme wurde gespeichert.');
}

/* ---------- Admin: Login ---------- */

async function refreshSession() {
  const { data } = await sb.auth.getSession();
  session = data.session;
}

async function handleLogin(email, password) {
  const errBox = document.getElementById('loginError');
  errBox.style.display = 'none';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    errBox.textContent = 'Anmeldung fehlgeschlagen: falsche E-Mail oder falsches Passwort.';
    errBox.style.display = 'block';
    return;
  }
  await route();
}

async function handleLogout() {
  await sb.auth.signOut();
  await route();
}

/* ---------- Admin: Felder verwalten ---------- */

function renderEntryTable() {
  const body = document.getElementById('entryTableBody');
  const emptyHint = document.getElementById('entryEmptyHint');
  if (entries.length === 0) {
    body.innerHTML = '';
    emptyHint.style.display = 'block';
    return;
  }
  emptyHint.style.display = 'none';
  body.innerHTML = entries.map(e => `
    <tr>
      <td class="num">${escapeHtml(e.klasse)}</td>
      <td class="num">${escapeHtml(e.note)}</td>
      <td><button class="btn danger" style="padding:4px 10px;font-size:0.78rem;" data-id="${e.id}">Löschen</button></td>
    </tr>
  `).join('');

  body.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => deleteEntry(btn.dataset.id));
  });
}

async function addEntry(klasse, note) {
  const id = makeId(klasse, note);
  const { error } = await sb.from('entries').insert({ id, klasse, note });
  if (error) {
    console.error(error);
    showToast('Feld konnte nicht angelegt werden.');
    return;
  }
  showToast('Feld hinzugefügt.');
  await refreshAdmin();
}

async function deleteEntry(id) {
  if (!confirm('Dieses Feld inkl. seiner Stimmen wirklich löschen?')) return;
  const { error } = await sb.from('entries').delete().eq('id', id);
  if (error) {
    console.error(error);
    showToast('Feld konnte nicht gelöscht werden.');
    return;
  }
  await refreshAdmin();
}

async function resetVotes() {
  if (!confirm('Wirklich ALLE Stimmen aller Abstimmenden zurücksetzen?')) return;
  const { error } = await sb.rpc('reset_all_votes');
  if (error) {
    console.error(error);
    showToast('Zurücksetzen fehlgeschlagen.');
    return;
  }
  showToast('Alle Stimmen wurden zurückgesetzt.');
  await refreshAdmin();
}

/* ---------- Admin: Statistik ---------- */

function renderChart() {
  const chart = document.getElementById('chart');
  if (entries.length === 0) {
    chart.innerHTML = '<p class="hint">Noch keine Felder für eine Statistik vorhanden.</p>';
    return;
  }
  const rows = [...entries].sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...rows.map(r => r.count));

  chart.innerHTML = rows.map(e => `
    <div class="chart-row">
      <div class="bar-label">${escapeHtml(e.klasse)} · ${escapeHtml(e.note)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(e.count / max) * 100}%"></div></div>
      <div class="bar-count">${e.count}</div>
    </div>
  `).join('');
}

/* ---------- Gesamtrendering ---------- */

async function refreshAdmin() {
  await fetchEntries();
  renderEntryTable();
  renderChart();
}

/* ---------- Routing ---------- */

async function route() {
  const isAdmin = location.hash.toLowerCase() === '#adminpage';
  document.getElementById('publicView').style.display = isAdmin ? 'none' : '';
  document.getElementById('adminView').style.display = isAdmin ? '' : 'none';

  if (!isAdmin) {
    await fetchEntries();
    renderPublic();
    return;
  }

  await refreshSession();
  const loggedIn = !!session;
  document.getElementById('adminLogin').style.display = loggedIn ? 'none' : 'block';
  document.getElementById('adminContent').style.display = loggedIn ? 'block' : 'none';
  if (loggedIn) await refreshAdmin();
}

/* ---------- Realtime ---------- */

function subscribeRealtime() {
  sb.channel('jahresabstimmung-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, () => route())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'votes' }, () => route())
    .subscribe();
}

/* ---------- Init ---------- */

async function init() {
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  loadVotedLocal();

  document.getElementById('loginForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const email = document.getElementById('inEmail').value.trim();
    const password = document.getElementById('inPassword').value;
    handleLogin(email, password);
  });

  document.getElementById('logoutBtn').addEventListener('click', handleLogout);

  document.getElementById('addForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const klasse = document.getElementById('inKlasse').value.trim();
    const note = document.getElementById('inNote').value.trim();
    if (!klasse || !note) return;
    addEntry(klasse, note);
    ev.target.reset();
    document.getElementById('inKlasse').focus();
  });

  document.getElementById('resetVotesBtn').addEventListener('click', resetVotes);

  sb.auth.onAuthStateChange(() => route());

  window.addEventListener('hashchange', route);
  await route();
  subscribeRealtime();
}

init();
