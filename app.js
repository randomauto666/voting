/* ---------------------------------------------------------
   Jahresabstimmung – Logik mit Supabase als zentralem Speicher

   Der Admin legt nur Schulen an. Wer abstimmt, öffnet pro
   Schule ein Formular und trägt die eigene Klasse, eine Note
   (1–6) und einen Grund ein – das ist die Stimme. Pro Schule
   kann jeder Browser genau einmal abstimmen.
--------------------------------------------------------- */

const LS_VOTED = 'ja_voted'; // { [entryId]: { note } } – lokale Sperre + eigene Note

// Supabase-Projekt: Settings → API. Der "anon"/"publishable" key ist zur
// Verwendung im Browser vorgesehen (kein Geheimnis) – die eigentliche
// Absicherung übernehmen die RLS-Policies in Supabase (siehe supabase.sql).
const SUPABASE_URL = 'https://fofncyaweychquyconmt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_YpaPyjX6jtabCzZZCI7y-w_EuTtvCiF';

let sb = null;
let entries = []; // öffentliche Ansicht: [{ id, schule }]
let adminRows = []; // adminansicht: [{ entry_id, schule, vote_count, avg_note }]
let votedLocal = {};
let session = null;
let openFormId = null; // welches Abstimm-Formular gerade offen ist (öffentliche Seite)

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
    .select('id, schule, created_at')
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

/* ---------- Hilfsfunktionen ---------- */

function makeId(schule) {
  const base = schule.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  let id = base || 'schule', n = 1;
  const existing = new Set(entries.map(e => e.id));
  while (existing.has(id)) { n += 1; id = (base || 'schule') + '-' + n; }
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

function fmtAvg(v) {
  return v === null || v === undefined ? '–' : Number(v).toFixed(1);
}

const NOTE_OPTIONS = [
  [1, '1 – sehr gut'],
  [2, '2 – gut'],
  [3, '3 – befriedigend'],
  [4, '4 – ausreichend'],
  [5, '5 – mangelhaft'],
  [6, '6 – ungenügend']
];

/* ---------- Öffentliche Ansicht ---------- */

function renderPublic() {
  const grid = document.getElementById('publicGrid');
  if (entries.length === 0) {
    grid.innerHTML = '<div class="empty">Noch keine Schulen zum Abstimmen angelegt.</div>';
    return;
  }

  grid.innerHTML = entries.map(e => {
    const voted = votedLocal[e.id];

    if (voted) {
      return `
        <div class="card">
          <div class="field"><span class="label">Schule</span><span class="value">${escapeHtml(e.schule)}</span></div>
          <div class="voted-msg">Abgestimmt: Note ${voted.note} ✓</div>
        </div>`;
    }

    if (openFormId === e.id) {
      const options = NOTE_OPTIONS.map(([n, label]) => `<option value="${n}">${label}</option>`).join('');
      return `
        <div class="card">
          <div class="field"><span class="label">Schule</span><span class="value">${escapeHtml(e.schule)}</span></div>
          <form class="vote-form" data-id="${e.id}">
            <div class="field-group">
              <label for="klasse-${e.id}">Deine Klasse</label>
              <input id="klasse-${e.id}" name="klasse" type="text" placeholder="z. B. 8b" required maxlength="100">
            </div>
            <div class="field-group">
              <label for="note-${e.id}">Note der Schule</label>
              <select id="note-${e.id}" name="note" required>
                <option value="" disabled selected>Bitte wählen</option>
                ${options}
              </select>
            </div>
            <div class="field-group">
              <label for="grund-${e.id}">Grund für Note</label>
              <textarea id="grund-${e.id}" name="grund" rows="3" placeholder="Kurze Begründung" required maxlength="1000"></textarea>
            </div>
            <div class="actions-row">
              <button type="submit" class="btn">Abschicken</button>
              <button type="button" class="btn secondary vote-cancel-btn" data-id="${e.id}">Abbrechen</button>
            </div>
          </form>
        </div>`;
    }

    return `
      <div class="card">
        <div class="field"><span class="label">Schule</span><span class="value">${escapeHtml(e.schule)}</span></div>
        <button class="btn vote-open-btn" data-id="${e.id}" type="button">Abstimmen</button>
      </div>`;
  }).join('');

  grid.querySelectorAll('.vote-open-btn').forEach(btn => {
    btn.addEventListener('click', () => { openFormId = btn.dataset.id; renderPublic(); });
  });
  grid.querySelectorAll('.vote-cancel-btn').forEach(btn => {
    btn.addEventListener('click', () => { openFormId = null; renderPublic(); });
  });
  grid.querySelectorAll('.vote-form').forEach(form => {
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const id = form.dataset.id;
      const klasse = form.klasse.value.trim();
      const note = Number(form.note.value);
      const grund = form.grund.value.trim();
      if (!klasse || !note || !grund) return;
      castVote(id, klasse, note, grund);
    });
  });
}

async function castVote(id, klasse, note, grund) {
  const submitBtns = document.querySelectorAll(`.vote-form[data-id="${id}"] button`);
  submitBtns.forEach(b => b.disabled = true);

  const { error } = await sb.from('ratings').insert({ entry_id: id, klasse, note, grund });

  if (error) {
    console.error(error);
    submitBtns.forEach(b => b.disabled = false);
    showToast('Stimme konnte nicht gespeichert werden.');
    return;
  }

  votedLocal[id] = { note };
  saveVotedLocal();
  openFormId = null;
  renderPublic();
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

/* ---------- Admin: Schulen verwalten ---------- */

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
      <td class="num">${escapeHtml(r.schule)}</td>
      <td class="num">${r.vote_count}</td>
      <td class="num">${fmtAvg(r.avg_note)}</td>
      <td><button class="btn danger" style="padding:4px 10px;font-size:0.78rem;" data-id="${r.entry_id}">Löschen</button></td>
    </tr>
  `).join('');

  body.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => deleteEntry(btn.dataset.id));
  });
}

async function addEntry(schule) {
  const id = makeId(schule);
  const { error } = await sb.from('entries').insert({ id, schule });
  if (error) {
    console.error(error);
    showToast('Schule konnte nicht angelegt werden.');
    return;
  }
  showToast('Schule hinzugefügt.');
  await refreshAdmin();
}

async function deleteEntry(id) {
  if (!confirm('Diese Schule inkl. ihrer Stimmen wirklich löschen?')) return;
  const { error } = await sb.from('entries').delete().eq('id', id);
  if (error) {
    console.error(error);
    showToast('Schule konnte nicht gelöscht werden.');
    return;
  }
  await refreshAdmin();
}

async function resetVotes() {
  if (!confirm('Wirklich ALLE abgegebenen Stimmen aller Abstimmenden löschen?')) return;
  const { error } = await sb.rpc('reset_all_ratings');
  if (error) {
    console.error(error);
    showToast('Zurücksetzen fehlgeschlagen.');
    return;
  }
  showToast('Alle Stimmen wurden zurückgesetzt.');
  await refreshAdmin();
}

/* ---------- Admin: Statistik + Detail-Modal ---------- */

function renderChart() {
  const chart = document.getElementById('chart');
  if (adminRows.length === 0) {
    chart.innerHTML = '<p class="hint">Noch keine Schulen für eine Statistik vorhanden.</p>';
    return;
  }
  const rows = [...adminRows].sort((a, b) => b.vote_count - a.vote_count);
  const max = Math.max(1, ...rows.map(r => r.vote_count));

  chart.innerHTML = rows.map(r => `
    <button class="chart-row chart-row-btn" data-id="${r.entry_id}" data-schule="${escapeHtml(r.schule)}" type="button">
      <div class="bar-label">
        ${escapeHtml(r.schule)}
        <span class="bar-sub">Ø ${fmtAvg(r.avg_note)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.vote_count / max) * 100}%"></div></div>
      <div class="bar-count">${r.vote_count}</div>
    </button>
  `).join('');

  chart.querySelectorAll('.chart-row-btn').forEach(btn => {
    btn.addEventListener('click', () => openDetail(btn.dataset.id, btn.dataset.schule));
  });
}

async function openDetail(entryId, schuleName) {
  document.getElementById('modalTitle').textContent = schuleName;
  const body = document.getElementById('modalBody');
  body.innerHTML = '<p class="hint">Lädt …</p>';
  document.getElementById('detailModal').style.display = 'flex';

  const { data, error } = await sb.rpc('admin_vote_details', { p_entry_id: entryId });
  if (error) {
    console.error(error);
    body.innerHTML = '<p class="hint error-text">Details konnten nicht geladen werden.</p>';
    return;
  }
  if (!data || data.length === 0) {
    body.innerHTML = '<p class="hint">Noch keine Stimmen für diese Schule.</p>';
    return;
  }

  body.innerHTML = `
    <table class="entry-table">
      <thead><tr><th>Klasse</th><th>Note</th><th>Grund</th></tr></thead>
      <tbody>
        ${data.map(v => `
          <tr>
            <td class="num">${escapeHtml(v.klasse)}</td>
            <td class="num">${v.note}</td>
            <td class="reason-cell">${escapeHtml(v.grund)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

function closeDetail() {
  document.getElementById('detailModal').style.display = 'none';
}

/* ---------- Gesamtrendering ---------- */

async function refreshAdmin() {
  await fetchAdminStats();
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
    const schule = document.getElementById('inSchule').value.trim();
    if (!schule) return;
    addEntry(schule);
    ev.target.reset();
    document.getElementById('inSchule').focus();
  });

  document.getElementById('resetVotesBtn').addEventListener('click', resetVotes);

  document.getElementById('modalClose').addEventListener('click', closeDetail);
  document.getElementById('detailModal').addEventListener('click', ev => {
    if (ev.target.id === 'detailModal') closeDetail();
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') closeDetail();
  });

  sb.auth.onAuthStateChange(() => route());

  window.addEventListener('hashchange', route);
  await route();
  subscribeRealtime();
}

init();
