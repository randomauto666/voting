/* ---------------------------------------------------------
   Jahresabstimmung – Logik mit Supabase als zentralem Speicher

   Der Admin legt nur Klassen an. Jede Note, die eine
   abstimmende Person vergibt, ist gleichzeitig ihre Stimme
   (1 = sehr gut ... 6 = ungenügend). Pro Klasse kann jeder
   Browser genau einmal eine Note abgeben.
--------------------------------------------------------- */

const LS_VOTED = 'ja_voted'; // { [entryId]: note } – lokale Sperre + eigene Note

// Supabase-Projekt: Settings → API. Der "anon"/"publishable" key ist zur
// Verwendung im Browser vorgesehen (kein Geheimnis) – die eigentliche
// Absicherung übernehmen die RLS-Policies in Supabase (siehe supabase.sql).
const SUPABASE_URL = 'https://fofncyaweychquyconmt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_YpaPyjX6jtabCzZZCI7y-w_EuTtvCiF';

let sb = null;
let entries = []; // öffentliche Ansicht: [{ id, klasse }]
let adminRows = []; // adminansicht: [{ entry_id, klasse, vote_count, avg_note }]
let noteCounts = {}; // { [entry_id]: { 1: count, ..., 6: count } }
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
    .select('id, klasse, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    console.error(error);
    showToast('Fehler beim Laden der Daten.');
    return;
  }
  entries = data || [];
}

async function fetchAdminStats() {
  const { data, error } = await sb.rpc('admin_stats');
  if (error) {
    console.error(error);
    showToast('Fehler beim Laden der Statistik.');
    return;
  }
  adminRows = data || [];
}

async function fetchNoteBreakdown() {
  const { data, error } = await sb.rpc('admin_note_breakdown');
  if (error) {
    console.error(error);
    showToast('Fehler beim Laden der Notenverteilung.');
    return;
  }
  noteCounts = {};
  (data || []).forEach(row => {
    if (!noteCounts[row.entry_id]) noteCounts[row.entry_id] = {};
    noteCounts[row.entry_id][row.note] = Number(row.cnt);
  });
}

/* ---------- Hilfsfunktionen ---------- */

function makeId(klasse) {
  const base = klasse.toLowerCase().replace(/\s+/g, '');
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
    grid.innerHTML = '<div class="empty">Noch keine Klassen zum Abstimmen angelegt.</div>';
    return;
  }
  grid.innerHTML = entries.map(e => {
    const votedNote = votedLocal[e.id];
    const noteButtons = [1, 2, 3, 4, 5, 6].map(n =>
      `<button class="note-btn" data-id="${e.id}" data-note="${n}">${n}</button>`
    ).join('');

    return `
      <div class="card">
        <div class="field">
          <span class="label">Klasse</span>
          <span class="value">${escapeHtml(e.klasse)}</span>
        </div>
        ${votedNote
          ? `<div class="voted-msg">Abgestimmt: Note ${votedNote} ✓</div>`
          : `<div class="note-buttons">${noteButtons}</div>`}
      </div>`;
  }).join('');

  grid.querySelectorAll('.note-btn').forEach(btn => {
    btn.addEventListener('click', () => castVote(btn.dataset.id, Number(btn.dataset.note)));
  });
}

async function castVote(id, note) {
  if (votedLocal[id]) return;
  votedLocal[id] = note;
  saveVotedLocal();
  renderPublic(); // sofort sperren, kein Doppelklick

  const { error } = await sb.from('ratings').insert({ entry_id: id, note });
  if (error) {
    console.error(error);
    delete votedLocal[id];
    saveVotedLocal();
    renderPublic();
    showToast('Note konnte nicht gespeichert werden.');
    return;
  }
  showToast('Deine Note wurde gespeichert.');
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

/* ---------- Admin: Klassen verwalten ---------- */

function fmtAvg(v) {
  return v === null || v === undefined ? '–' : Number(v).toFixed(1);
}

function renderEntryTable() {
  const body = document.getElementById('entryTableBody');
  const emptyHint = document.getElementById('entryEmptyHint');
  if (adminRows.length === 0) {
    body.innerHTML = '';
    emptyHint.style.display = 'block';
    return;
  }
  emptyHint.style.display = 'none';
  body.innerHTML = adminRows.map(r => `
    <tr>
      <td class="num">${escapeHtml(r.klasse)}</td>
      <td class="num">${r.vote_count}</td>
      <td class="num">${fmtAvg(r.avg_note)}</td>
      <td><button class="btn danger" style="padding:4px 10px;font-size:0.78rem;" data-id="${r.entry_id}">Löschen</button></td>
    </tr>
  `).join('');

  body.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => deleteEntry(btn.dataset.id));
  });
}

async function addEntry(klasse) {
  const id = makeId(klasse);
  const { error } = await sb.from('entries').insert({ id, klasse });
  if (error) {
    console.error(error);
    showToast('Klasse konnte nicht angelegt werden.');
    return;
  }
  showToast('Klasse hinzugefügt.');
  await refreshAdmin();
}

async function deleteEntry(id) {
  if (!confirm('Diese Klasse inkl. ihrer Stimmen wirklich löschen?')) return;
  const { error } = await sb.from('entries').delete().eq('id', id);
  if (error) {
    console.error(error);
    showToast('Klasse konnte nicht gelöscht werden.');
    return;
  }
  await refreshAdmin();
}

async function resetVotes() {
  if (!confirm('Wirklich ALLE abgegebenen Noten aller Abstimmenden löschen?')) return;
  const { error } = await sb.rpc('reset_all_ratings');
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
  if (adminRows.length === 0) {
    chart.innerHTML = '<p class="hint">Noch keine Klassen für eine Statistik vorhanden.</p>';
    return;
  }
  const rows = [...adminRows].sort((a, b) => b.vote_count - a.vote_count);
  const max = Math.max(1, ...rows.map(r => r.vote_count));

  chart.innerHTML = rows.map(r => `
    <div class="chart-row">
      <div class="bar-label">
        ${escapeHtml(r.klasse)}
        <span class="bar-sub">Ø ${fmtAvg(r.avg_note)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.vote_count / max) * 100}%"></div></div>
      <div class="bar-count">${r.vote_count}</div>
    </div>
  `).join('');
}

function renderDistribution() {
  const wrap = document.getElementById('distribution');
  if (adminRows.length === 0) {
    wrap.innerHTML = '<p class="hint">Noch keine Klassen für eine Verteilung vorhanden.</p>';
    return;
  }

  wrap.innerHTML = adminRows.map(r => {
    const counts = noteCounts[r.entry_id] || {};
    const max = Math.max(1, ...[1, 2, 3, 4, 5, 6].map(n => counts[n] || 0));

    const rows = [1, 2, 3, 4, 5, 6].map(n => {
      const c = counts[n] || 0;
      return `
        <div class="dist-row">
          <div class="dist-label">Note ${n}</div>
          <div class="dist-track"><div class="dist-fill" style="width:${(c / max) * 100}%"></div></div>
          <div class="dist-count">${c}</div>
        </div>`;
    }).join('');

    return `
      <div class="dist-group">
        <h3 class="dist-heading">${escapeHtml(r.klasse)} <span class="dist-total">${r.vote_count} Stimmen</span></h3>
        <div class="dist-rows">${rows}</div>
      </div>`;
  }).join('');
}

/* ---------- Gesamtrendering ---------- */

async function refreshAdmin() {
  await fetchAdminStats();
  await fetchNoteBreakdown();
  renderEntryTable();
  renderChart();
  renderDistribution();
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ratings' }, () => route())
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
    if (!klasse) return;
    addEntry(klasse);
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
