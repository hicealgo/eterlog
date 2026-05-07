const firebaseConfig = {
  apiKey: "AIzaSyCgfQGnmF5ETN22ntKpDxSCuJ-KRvuq0q8",
  authDomain: "eterlog-54b08.firebaseapp.com",
  projectId: "eterlog-54b08",
  storageBucket: "eterlog-54b08.firebasestorage.app",
  messagingSenderId: "192406693378",
  appId: "1:192406693378:web:639f9a4188047de521a91b",
  measurementId: "G-RPV4SX0GJR"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let mode = 'single'; // 'single' | 'scroll' | 'notes' | 'wins'
let notes = [];
let selectedNoteIndex = 0;
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

let baseDate = new Date();
const journal = document.getElementById('journal');
const todayStr = formatDate(new Date());
const MAX_VISIBLE_DAYS = 15;
const rendered = new Map();

// =========================================
// THEME SYSTEM
// =========================================
const THEMES = ['dark', 'light', 'warm', 'forest', 'ocean', 'synthwave'];
const THEME_ICONS = { dark: '🌑', light: '☀️', warm: '🕯️', forest: '🌿', ocean: '🌊', synthwave: '🌃' };

function applyTheme(name) {
  if (!THEMES.includes(name)) name = 'dark';
  document.body.removeAttribute('data-theme');
  if (name !== 'dark') document.body.setAttribute('data-theme', name);
  localStorage.setItem('theme', name);
  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = THEME_ICONS[name] + ' Theme';
}

function toggleTheme() {
  const current = localStorage.getItem('theme') || 'dark';
  const idx = THEMES.indexOf(current);
  applyTheme(THEMES[(idx + 1) % THEMES.length]);
}

// Init theme — migrate old 'light' class approach
(function initTheme() {
  let saved = localStorage.getItem('theme') || 'dark';
  // old code saved 'light' directly which maps fine; 'dark' was absence of class
  applyTheme(saved);
})();

// =========================================
// ALL ENTRIES CACHE (shared by heatmap + wins)
// =========================================
let allEntriesCache = null;

async function loadAllEntries() {
  if (allEntriesCache) return allEntriesCache;
  const result = {};
  if (auth.currentUser) {
    try {
      const snapshot = await db.collection("journals").doc(auth.currentUser.uid)
        .collection("entries").get();
      snapshot.forEach(doc => { result[doc.id] = doc.data(); });
    } catch (e) {
      // Firebase rules don't allow collection listing — fall back to localStorage
      console.warn("Firebase list permission denied, falling back to localStorage. Update your Firestore rules to fix this.");
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('journal_')) {
          try { result[k.slice(8)] = JSON.parse(localStorage.getItem(k) || '{}'); } catch(e2) {}
        }
      }
    }
  } else {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('journal_')) {
        try { result[k.slice(8)] = JSON.parse(localStorage.getItem(k) || '{}'); } catch(e) {}
      }
    }
  }
  allEntriesCache = result;
  return result;
}

// =========================================
// DATE UTILITIES
// =========================================
function formatDate(d) {
  const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return iso.toISOString().split('T')[0];
}

function getDayName(d) {
  return d.toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
}

function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // back to Monday
  d.setDate(d.getDate() + diff);
  return formatDate(d);
}

// =========================================
// ENTRY CRUD
// =========================================
function loadEntry(date) {
  if (auth.currentUser) {
    return db.collection("journals").doc(auth.currentUser.uid)
      .collection("entries").doc(date)
      .get().then(doc => doc.exists ? doc.data() : {});
  }
  return Promise.resolve(JSON.parse(localStorage.getItem('journal_' + date) || '{}'));
}

function saveEntry(date, e) {
  allEntriesCache = null; // invalidate so heatmap/wins reflect new data
  if (auth.currentUser) {
    if (typeof e.then === "function") { console.error("❌ Saving a Promise"); return; }
    db.collection("journals").doc(auth.currentUser.uid).collection("entries").doc(date).set(e);
  } else {
    localStorage.setItem('journal_' + date, JSON.stringify(e));
  }
}

// =========================================
// WINS META (emoji marks)
// Saved to localStorage always (fast/offline), and Firebase when logged in.
// Requires this rule in Firestore: match /winsData/{userId} { allow read, write: if request.auth.uid == userId; }
// =========================================
let winsMeta = {};

async function loadWinsMeta() {
  winsMeta = JSON.parse(localStorage.getItem('wins_meta') || '{}');
  if (auth.currentUser) {
    try {
      const doc = await db.collection("winsData").doc(auth.currentUser.uid).get();
      if (doc.exists) {
        // Firebase takes precedence — merge on top of localStorage
        winsMeta = { ...winsMeta, ...(doc.data().meta || {}) };
      }
    } catch (e) {
      console.warn("winsData: Firebase read failed (add rule). Using localStorage only.", e.message);
    }
  }
}

function saveWinsMeta() {
  localStorage.setItem('wins_meta', JSON.stringify(winsMeta));
  if (auth.currentUser) {
    db.collection("winsData").doc(auth.currentUser.uid)
      .set({ meta: winsMeta })
      .catch(e => console.warn("winsData: Firebase save failed (add rule).", e.message));
  }
}

// =========================================
// DAY RENDERING
// =========================================
async function createDay(date) {
  const entry = await loadEntry(date);
  const div = document.createElement('div');
  div.className = 'day-container';
  if (date === todayStr) div.classList.add('today');
  div.dataset.date = date;
  const dn = getDayName(new Date(date));
  div.innerHTML = `
    <h1>${date}</h1><h2>${dn}</h2>
    <div class="grid">
      ${['todo','done','misc'].map(f => `
        <div class="entry">
          <label>${f.toUpperCase()}</label>
          <textarea data-date="${date}" data-field="${f}">${entry[f] || ''}</textarea>
        </div>`).join('')}
    </div>`;
  return div;
}

function attachListeners(el = document) {
  el.querySelectorAll('textarea').forEach(t => {
    t.oninput = async () => {
      if (t.value.length > 5000) { t.value = t.value.slice(0, 5000); alert("⚠️ 5000 chars max"); }
      const d = t.dataset.date, f = t.dataset.field;
      const e = await loadEntry(d);
      e[f] = t.value;
      saveEntry(d, e);
    };
  });
}

// =========================================
// NAV / MODE LABEL HELPERS
// =========================================
function updateToggleLabel() {
  const btn = document.getElementById('toggleModeBtn');
  if (mode === 'notes' || mode === 'wins') {
    btn.style.display = 'none';
  } else {
    btn.style.display = 'inline-block';
    btn.textContent = mode === 'single' ? '🔁 Continuous' : '🔁 Single Day';
  }
}

function updateNavVisibility() {
  const hide = mode === 'notes' || mode === 'wins';
  document.getElementById('journal-nav').style.display = hide ? 'none' : 'flex';
  updateToggleLabel();
}

// =========================================
// SINGLE DAY MODE
// =========================================
function hardResetToSingleMode() {
  mode = 'single';
  baseDate = new Date();
  journal.onscroll = null;
  journal.innerHTML = '';
  journal.scrollTop = 0;
  rendered.clear();
  renderSingle(formatDate(baseDate));
}

async function renderSingle(date = formatDate(baseDate)) {
  for (const [d, el] of rendered.entries()) {
    el.style.display = (d === date) ? '' : 'none';
  }
  if (!rendered.has(date)) {
    const el = await createDay(date);
    if (el) { journal.appendChild(el); rendered.set(date, el); }
  }
  attachListeners();
  journal.scrollTop = 0;
  document.getElementById('date-picker').value = formatDate(baseDate);
}

// =========================================
// SCROLL / CONTINUOUS MODE
// =========================================
async function renderScroll() {
  const centerDateStr = formatDate(baseDate);
  const daysToShow = [];
  for (let i = -6; i <= 6; i++) {
    const d = new Date(baseDate); d.setDate(d.getDate() + i);
    daysToShow.push(formatDate(d));
  }
  daysToShow.sort();
  const elements = [];
  for (const dateStr of daysToShow) {
    let el = rendered.get(dateStr);
    if (!el) { el = await createDay(dateStr); if (el) rendered.set(dateStr, el); }
    if (el) { el.style.display = ''; elements.push([dateStr, el]); }
  }
  journal.innerHTML = '';
  for (const [, el] of elements) journal.appendChild(el);
  attachListeners();
  setupScroll();
  const targetEl = rendered.get(centerDateStr);
  if (targetEl) journal.scrollTop = targetEl.offsetTop - 100;
}

function setupScroll() {
  let isLoading = false;
  journal.onscroll = async () => {
    if (isLoading) return;
    isLoading = true;
    const st = journal.scrollTop, sh = journal.scrollHeight,
          ch = journal.clientHeight, buf = 200;
    const firstDate = journal.firstChild?.dataset?.date;
    const lastDate = journal.lastChild?.dataset?.date;
    if (!firstDate || !lastDate) { isLoading = false; return; }
    const fd = new Date(firstDate), ld = new Date(lastDate);
    if (isNaN(fd.getTime()) || isNaN(ld.getTime())) { isLoading = false; return; }
    if (st < buf) {
      const prevHeight = journal.scrollHeight;
      for (let i = 1; i <= 3; i++) {
        const d = new Date(fd); d.setDate(fd.getDate() - i);
        const s = formatDate(d);
        if (!rendered.has(s)) {
          const el = await createDay(s);
          if (el) { journal.prepend(el); rendered.set(s, el); }
        }
      }
      journal.scrollTop += journal.scrollHeight - prevHeight;
    }
    if (st + ch > sh - buf) {
      for (let i = 1; i <= 3; i++) {
        const d = new Date(ld); d.setDate(ld.getDate() + i);
        const s = formatDate(d);
        if (!rendered.has(s)) {
          const el = await createDay(s);
          if (el) { journal.appendChild(el); rendered.set(s, el); }
        }
      }
    }
    while (journal.children.length > MAX_VISIBLE_DAYS) {
      const rm = journal.scrollTop > journal.scrollHeight / 2 ? journal.firstChild : journal.lastChild;
      rendered.delete(rm.dataset.date);
      journal.removeChild(rm);
    }
    attachListeners();
    const journalRect = journal.getBoundingClientRect();
    for (const [dateStr, el] of rendered.entries()) {
      const rect = el.getBoundingClientRect();
      if (rect.top >= journalRect.top && rect.bottom <= journalRect.bottom) {
        document.getElementById('date-picker').value = dateStr;
        break;
      }
    }
    isLoading = false;
  };
}

// =========================================
// NAVIGATION
// =========================================
function goToday() {
  baseDate = new Date();
  if (mode === 'single') renderSingle(formatDate(baseDate));
  else { rendered.clear(); renderScroll(); }
}

function changeDay(offset) {
  if (mode === 'single') {
    baseDate.setDate(baseDate.getDate() + offset);
    renderSingle(formatDate(baseDate));
  } else {
    journal.scrollBy({ top: offset * journal.clientHeight, behavior: 'smooth' });
  }
}

function toggleMode() {
  if (mode === 'single') { mode = 'scroll'; renderScroll(); }
  else { hardResetToSingleMode(); }
  updateToggleLabel();
}

function goToDate(dateStr) {
  if (!dateStr) return;
  const [y, m, d] = dateStr.split('-').map(Number);
  baseDate = new Date(y, m - 1, d);
  if (mode === 'single') renderSingle(formatDate(baseDate));
  else { rendered.clear(); renderScroll(); }
}

// =========================================
// NOTES MODE
// =========================================
function loadNotes() {
  if (auth.currentUser) {
    return db.collection("notes").doc(auth.currentUser.uid)
      .get().then(doc => { notes = doc.exists ? doc.data().bits || [] : []; });
  }
  notes = JSON.parse(localStorage.getItem("note_bits") || "[]");
  return Promise.resolve();
}

function saveNotes() {
  if (auth.currentUser) {
    db.collection("notes").doc(auth.currentUser.uid).set({ bits: notes });
  } else {
    localStorage.setItem("note_bits", JSON.stringify(notes));
  }
}

async function toggleNotesMode() {
  if (mode === 'notes') {
    mode = 'single';
    document.getElementById('toggleNotesBtn').textContent = '🗒️ Bits';
    journal.innerHTML = ''; journal.onscroll = null; rendered.clear();
    renderSingle(formatDate(baseDate));
  } else {
    if (mode === 'wins') updateWinsBtnStates();
    mode = 'notes';
    document.getElementById('toggleNotesBtn').textContent = '📅 Days';
    await loadNotes();
    if (notes.length === 0) { notes.push({ content: '' }); selectedNoteIndex = 0; saveNotes(); }
    renderNotesView();
  }
  updateNavVisibility();
}

function renderNotesView() {
  journal.innerHTML = '';
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;height:100%;';
  const sidebar = document.createElement('div');
  sidebar.style.cssText = 'width:120px;border-right:1px solid var(--accent);overflow-y:auto;position:relative;padding-bottom:36px;';
  const main = document.createElement('div');
  main.style.cssText = 'flex:1;padding:16px;';

  const storedIndex = parseInt(localStorage.getItem("note_selected_index"));
  if (!isNaN(storedIndex) && storedIndex < notes.length) selectedNoteIndex = storedIndex;

  function openTrash() {
    const trash = JSON.parse(localStorage.getItem("note_trash") || "[]");
    const out = trash.map((n, i) => `#${i}\n${n.content.slice(0, 300)}`).join("\n\n──────────────\n\n");
    document.getElementById("trash-content").textContent = out;
    document.getElementById("trash-modal").style.display = 'block';
  }
  function closeTrash() { document.getElementById("trash-modal").style.display = 'none'; }
  function emptyTrash() {
    if (!confirm("¿Vaciar papelera?")) return;
    localStorage.removeItem("note_trash"); closeTrash();
  }

  function renderSidebar() {
    sidebar.innerHTML = '';
    notes.forEach((n, i) => {
      const title = (n.content.split('\n')[0] || '').slice(0, 8)
        + ((n.content.split('\n')[0] || '').length > 8 ? '…' : '');
      const b = document.createElement('div');
      b.textContent = title || '(empty)';
      b.className = 'note-tab';
      const del = document.createElement('span');
      del.textContent = '×'; del.className = 'delete-btn';
      del.onclick = e => {
        e.stopPropagation();
        const removed = notes.splice(i, 1)[0];
        const trash = JSON.parse(localStorage.getItem("note_trash") || "[]");
        trash.unshift(removed);
        localStorage.setItem("note_trash", JSON.stringify(trash));
        if (selectedNoteIndex >= notes.length) selectedNoteIndex = notes.length - 1;
        saveNotes(); renderSidebar(); renderMain();
      };
      b.appendChild(del);
      b.style.cssText = `padding:4px;cursor:pointer;border-bottom:1px solid var(--accent);background:${i === selectedNoteIndex ? 'var(--highlight)' : ''};`;
      b.onclick = () => { selectedNoteIndex = i; localStorage.setItem("note_selected_index", i); renderSidebar(); renderMain(); };
      sidebar.appendChild(b);
    });
    const add = document.createElement('button');
    add.textContent = '+';
    add.style.cssText = 'width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--accent);cursor:pointer;font-family:inherit;';
    add.onclick = () => {
      if (notes.length >= 50) { alert("❌ 50 notes max"); return; }
      notes.unshift({ content: '' }); selectedNoteIndex = 0; saveNotes(); renderSidebar(); renderMain();
    };
    sidebar.appendChild(add);
    const trashBtn = document.createElement('button');
    trashBtn.textContent = '🗑 Trash';
    trashBtn.style.cssText = 'width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--accent);cursor:pointer;font-family:inherit;position:absolute;bottom:0;left:0;';
    trashBtn.onclick = openTrash;
    sidebar.appendChild(trashBtn);
  }

  function renderMain() {
    main.innerHTML = '';
    const note = notes[selectedNoteIndex];
    if (!note) return;
    const ta = document.createElement('textarea');
    ta.style.cssText = 'width:100%;height:100%;padding:8px;font-family:inherit;font-size:14px;box-sizing:border-box;';
    ta.style.background = getComputedStyle(document.body).getPropertyValue('--textarea').trim();
    ta.style.color = getComputedStyle(document.body).getPropertyValue('--fg').trim();
    ta.style.border = `1px solid ${getComputedStyle(document.body).getPropertyValue('--accent').trim()}`;
    ta.value = note.content;
    ta.oninput = () => {
      if (ta.value.length > 10000) { ta.value = ta.value.slice(0, 10000); alert("⚠️ max 10000 chars"); }
      note.content = ta.value; saveNotes(); renderSidebar();
    };
    main.appendChild(ta);
  }

  renderSidebar(); renderMain();
  container.appendChild(sidebar); container.appendChild(main);
  journal.appendChild(container);
  const emptyBtn = document.getElementById("emptyTrashBtn");
  const closeBtn = document.getElementById("closeTrashBtn");
  if (emptyBtn) emptyBtn.onclick = emptyTrash;
  if (closeBtn) closeBtn.onclick = closeTrash;
}

// =========================================
// HEATMAP
// =========================================
let heatmapVisible = false;
let heatmapYear = new Date().getFullYear();
const heatTooltip = document.getElementById('heat-tooltip');

function toggleHeatmap() {
  heatmapVisible = !heatmapVisible;
  document.getElementById('heatmap-overlay').style.display = heatmapVisible ? 'block' : 'none';
  document.body.classList.toggle('heatmap-open', heatmapVisible);
  document.getElementById('heatmapBtn').textContent = heatmapVisible ? '✕ Map' : '📊 Map';
  if (!heatmapVisible) heatTooltip.style.display = 'none';
  if (heatmapVisible) loadAndRenderHeatmap();
}

function shiftHeatmapYear(delta) {
  const currentYear = new Date().getFullYear();
  heatmapYear = Math.min(heatmapYear + delta, currentYear);
  document.getElementById('heatmap-next-year-btn').disabled = (heatmapYear >= currentYear);
  loadAndRenderHeatmap();
}

async function loadAndRenderHeatmap() {
  const currentYear = new Date().getFullYear();
  document.getElementById('heatmap-year-label').textContent = heatmapYear;
  document.getElementById('heatmap-next-year-btn').disabled = (heatmapYear >= currentYear);
  const content = document.querySelector('.heatmap-content');
  content.innerHTML = '<div style="padding:8px;color:var(--label);font-size:11px">Loading...</div>';
  const allEntries = await loadAllEntries();
  renderHeatmap(allEntries, content);
}

function computeStreak(activityMap) {
  const today = new Date();
  let streak = 0;
  const cur = new Date(today);
  while (true) {
    const ds = formatDate(cur);
    if (activityMap[ds] > 0) { streak++; cur.setDate(cur.getDate() - 1); }
    else break;
  }
  return streak;
}

function buildYearGrid(year) {
  const today = new Date();
  const isPastYear = year < today.getFullYear();

  const yearStart = new Date(year, 0, 1);
  const yearEnd = isPastYear ? new Date(year, 11, 31) : today;

  // Align start back to Monday
  const dow = yearStart.getDay();
  yearStart.setDate(yearStart.getDate() - (dow === 0 ? 6 : dow - 1));

  const weeks = [];
  let cursor = new Date(yearStart);
  while (cursor <= yearEnd) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const inYear = cursor.getFullYear() === year;
      const notFuture = cursor <= today;
      week.push((inYear && notFuture) ? formatDate(cursor) : null);
      cursor.setDate(cursor.getDate() + 1);
    }
    // only add week if it has at least one visible cell
    if (week.some(d => d !== null)) weeks.push(week);
  }
  return weeks;
}

function renderHeatmap(allEntries, container) {
  const activityMap = {};
  for (const [date, entry] of Object.entries(allEntries)) {
    const total = (entry.todo || '').length + (entry.done || '').length + (entry.misc || '').length;
    if (total > 0) activityMap[date] = total;
  }

  const streak = computeStreak(activityMap);
  const totalActiveDays = Object.keys(activityMap).length;
  const todayDateStr = formatDate(new Date());
  const weeks = buildYearGrid(heatmapYear);

  function getLevel(chars) {
    if (!chars) return 0;
    if (chars < 50) return 1;
    if (chars < 200) return 2;
    if (chars < 500) return 3;
    return 4;
  }

  container.innerHTML = '';

  // Streak / stats line
  const streakEl = document.createElement('div');
  streakEl.className = 'heatmap-streak';
  if (heatmapYear === new Date().getFullYear() && streak > 1) {
    streakEl.innerHTML = `<strong>🔥 ${streak}-day streak!</strong> &nbsp;·&nbsp; ${totalActiveDays} days with entries`;
  } else {
    streakEl.innerHTML = `${totalActiveDays} days with entries total`;
  }
  container.appendChild(streakEl);

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'overflow-x:auto;';

  // Month labels
  const monthsRow = document.createElement('div');
  monthsRow.className = 'heatmap-months';
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let lastMonth = null;
  weeks.forEach(week => {
    const label = document.createElement('div');
    label.className = 'heatmap-month-label';
    const firstDay = week.find(d => d);
    if (firstDay) {
      const m = parseInt(firstDay.split('-')[1]) - 1;
      if (m !== lastMonth) { label.textContent = monthNames[m]; lastMonth = m; }
    }
    monthsRow.appendChild(label);
  });
  wrapper.appendChild(monthsRow);

  const grid = document.createElement('div');
  grid.className = 'heatmap-grid';

  const dayLabels = document.createElement('div');
  dayLabels.className = 'heatmap-day-labels';
  ['M', '', 'W', '', 'F', '', 'S'].forEach(l => {
    const el = document.createElement('div');
    el.className = 'heatmap-day-label';
    el.textContent = l;
    dayLabels.appendChild(el);
  });
  grid.appendChild(dayLabels);

  const weeksContainer = document.createElement('div');
  weeksContainer.className = 'heatmap-weeks';

  weeks.forEach(week => {
    const col = document.createElement('div');
    col.className = 'heatmap-col';
    week.forEach(dateStr => {
      const cell = document.createElement('div');
      cell.className = 'heat-cell';
      if (dateStr) {
        const chars = activityMap[dateStr] || 0;
        const level = getLevel(chars);
        if (level > 0) cell.setAttribute('data-level', level);
        if (dateStr === todayDateStr) cell.classList.add('heat-cell--today');
        cell.style.cursor = 'pointer';

        // Custom tooltip (native title is too slow on tiny cells)
        const tipText = chars
          ? `${dateStr}  ·  ${chars} chars written`
          : `${dateStr}  ·  no entry`;
        cell.onmouseenter = e => {
          heatTooltip.textContent = tipText;
          heatTooltip.style.display = 'block';
          heatTooltip.style.left = (e.clientX + 14) + 'px';
          heatTooltip.style.top = (e.clientY - 36) + 'px';
        };
        cell.onmousemove = e => {
          heatTooltip.style.left = (e.clientX + 14) + 'px';
          heatTooltip.style.top = (e.clientY - 36) + 'px';
        };
        cell.onmouseleave = () => { heatTooltip.style.display = 'none'; };

        // Click navigates WITHOUT closing the map
        cell.onclick = () => { goToDate(dateStr); };
      } else {
        cell.classList.add('heat-cell--empty');
      }
      col.appendChild(cell);
    });
    weeksContainer.appendChild(col);
  });

  grid.appendChild(weeksContainer);
  wrapper.appendChild(grid);

  // Legend
  const legend = document.createElement('div');
  legend.className = 'heatmap-legend';
  legend.appendChild(Object.assign(document.createElement('span'), { textContent: 'Less' }));
  [0,1,2,3,4].forEach(l => {
    const cell = document.createElement('div');
    cell.className = 'heat-cell';
    if (l > 0) cell.setAttribute('data-level', l);
    legend.appendChild(cell);
  });
  legend.appendChild(Object.assign(document.createElement('span'), { textContent: 'More' }));
  wrapper.appendChild(legend);

  container.appendChild(wrapper);
}

// =========================================
// WINS / TODO / MISC VIEWS
// =========================================
let winsField = 'done';
let winsViewStyle = localStorage.getItem('wins_view_style') || 'chips';
let lastWinsEntries = null;

const EMOJIS = ['🔥', '⚡', '💪', '💡', '🎯'];
const FIELD_CONFIG = {
  done: { label: '🏆 YOUR WINS',   empty: 'No done items yet.\n\nGo write some! ✊' },
  todo: { label: '📋 TODO ITEMS',  empty: 'No todo items found.' },
  misc: { label: '🌀 MISC ITEMS',  empty: 'No misc items found.' },
};
const WINS_BTN_LABELS = { done: '🏆 Wins', todo: '📋 Todo', misc: '🌀 Misc' };

function cycleEmoji(key) {
  const current = winsMeta[key]?.emoji || null;
  const idx = EMOJIS.indexOf(current);
  const next = idx < EMOJIS.length - 1 ? EMOJIS[idx + 1] : null;
  if (!winsMeta[key]) winsMeta[key] = {};
  winsMeta[key].emoji = next;
  saveWinsMeta();
  return next;
}

function updateWinsBtnStates() {
  ['done', 'todo', 'misc'].forEach(f => {
    const btn = document.getElementById(`wins-${f}-btn`);
    if (!btn) return;
    btn.textContent = WINS_BTN_LABELS[f];
    btn.classList.toggle('wins-btn-active', mode === 'wins' && winsField === f);
  });
}

async function enterWinsMode(field) {
  if (mode === 'wins' && winsField === field) {
    // clicking the active button exits
    mode = 'single';
    updateWinsBtnStates();
    journal.innerHTML = ''; journal.onscroll = null; rendered.clear();
    renderSingle(formatDate(baseDate));
    updateNavVisibility();
    return;
  }
  if (mode === 'notes') document.getElementById('toggleNotesBtn').textContent = '🗒️ Bits';
  mode = 'wins';
  winsField = field;
  updateWinsBtnStates();
  updateNavVisibility();
  journal.innerHTML = '<div style="padding:2em;text-align:center;color:var(--label);font-size:12px">Loading...</div>';
  journal.onscroll = null;
  await loadWinsMeta();
  lastWinsEntries = await loadAllEntries();
  renderWinsView(lastWinsEntries, field);
}

function buildWeekMap(allEntries, field) {
  const weekMap = {};
  let total = 0;
  for (const [date, entry] of Object.entries(allEntries)) {
    if (!entry[field]) continue;
    const lines = entry[field].split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (!lines.length) continue;
    const ws = getWeekStart(date);
    if (!weekMap[ws]) weekMap[ws] = [];
    lines.forEach((text, lineIdx) => {
      weekMap[ws].push({ date, lineIdx, text, key: `${field}_${date}_${lineIdx}` });
      total++;
    });
  }
  return { weekMap, total };
}

function renderWinsView(allEntries, field) {
  const config = FIELD_CONFIG[field];
  const { weekMap, total } = buildWeekMap(allEntries, field);
  journal.innerHTML = '';

  const markedCount = () => Object.values(winsMeta).filter(m => m?.emoji).length;

  // Header
  const header = document.createElement('div');
  header.className = 'wins-header';

  const titleRow = document.createElement('div');
  titleRow.className = 'wins-title-row';
  const titleEl = document.createElement('div');
  titleEl.className = 'wins-title';
  titleEl.textContent = config.label;

  const toggles = document.createElement('div');
  toggles.className = 'wins-view-toggles';
  ['chips', 'blocks'].forEach(style => {
    const btn = document.createElement('button');
    btn.className = 'wins-view-btn' + (winsViewStyle === style ? ' active' : '');
    btn.textContent = style === 'chips' ? '≡ Chips' : '▦ Blocks';
    btn.onclick = () => {
      if (winsViewStyle === style) return;
      winsViewStyle = style;
      localStorage.setItem('wins_view_style', style);
      renderWinsView(lastWinsEntries, winsField);
    };
    toggles.appendChild(btn);
  });

  titleRow.appendChild(titleEl);
  titleRow.appendChild(toggles);

  const statsEl = document.createElement('div');
  statsEl.className = 'wins-stats';
  const updateStats = () => { statsEl.textContent = `${total} items · ${markedCount()} marked`; };
  updateStats();

  header.appendChild(titleRow);
  header.appendChild(statsEl);
  journal.appendChild(header);

  if (Object.keys(weekMap).length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:2em;text-align:center;color:var(--label);font-size:13px;white-space:pre-line;';
    empty.textContent = config.empty;
    journal.appendChild(empty);
    return;
  }

  if (winsViewStyle === 'blocks') {
    renderBlockView(weekMap, updateStats);
  } else {
    renderChipsView(weekMap, updateStats);
  }
}

function renderChipsView(weekMap, updateStats) {
  const sortedWeeks = Object.keys(weekMap).sort((a, b) => b.localeCompare(a));
  const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  for (const weekStart of sortedWeeks) {
    const items = weekMap[weekStart];
    items.sort((a, b) => a.date.localeCompare(b.date));

    const ws = new Date(weekStart + 'T00:00:00');
    const we = new Date(ws); we.setDate(ws.getDate() + 6);
    const weekLabel = `${mn[ws.getMonth()]} ${ws.getDate()} – ${mn[we.getMonth()]} ${we.getDate()}, ${we.getFullYear()}`;

    const section = document.createElement('div');
    section.className = 'wins-week';

    const label = document.createElement('div');
    label.className = 'wins-week-label';
    label.innerHTML = `WEEK OF ${weekLabel.toUpperCase()} <span class="wins-week-count">${items.length}</span>`;
    section.appendChild(label);

    const row = document.createElement('div');
    row.className = 'wins-row';

    for (const item of items) {
      const meta = winsMeta[item.key] || {};
      const emoji = meta.emoji || null;
      const chip = document.createElement('div');
      chip.className = 'win-chip' + (emoji ? ' win-chip--marked' : '');
      const truncated = item.text.length > 26 ? item.text.slice(0, 24) + '…' : item.text;
      chip.textContent = (emoji ? emoji + ' ' : '') + truncated;

      // Show tooltip via the shared heat-tooltip div
      const tip = document.getElementById('heat-tooltip');
      chip.onmouseenter = e => {
        tip.innerHTML = `<span style="color:var(--label);font-size:9px">${item.date}</span><br>${item.text}<br><span style="color:var(--label);font-size:9px">click to cycle emoji</span>`;
        tip.style.display = 'block';
        tip.style.left = (e.clientX + 14) + 'px';
        tip.style.top = (e.clientY - 60) + 'px';
      };
      chip.onmousemove = e => { tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY - 60) + 'px'; };
      chip.onmouseleave = () => { tip.style.display = 'none'; };

      chip.onclick = () => {
        tip.style.display = 'none';
        const nextEmoji = cycleEmoji(item.key);
        chip.className = 'win-chip' + (nextEmoji ? ' win-chip--marked' : '');
        chip.textContent = (nextEmoji ? nextEmoji + ' ' : '') + truncated;
        updateStats();
      };

      row.appendChild(chip);
    }

    section.appendChild(row);
    journal.appendChild(section);
  }
}

function renderBlockView(weekMap, updateStats) {
  // Chronological order left→right so it reads like a timeline
  const sortedWeeks = Object.keys(weekMap).sort((a, b) => a.localeCompare(b));
  const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const tip = document.getElementById('heat-tooltip');

  const container = document.createElement('div');
  container.className = 'wins-block-container';

  let prevYear = null;

  for (const weekStart of sortedWeeks) {
    const items = weekMap[weekStart];
    items.sort((a, b) => a.date.localeCompare(b.date));

    const ws = new Date(weekStart + 'T00:00:00');
    const year = ws.getFullYear();

    // Year separator column when year changes
    if (prevYear !== null && year !== prevYear) {
      const sep = document.createElement('div');
      sep.className = 'wins-year-sep';
      const sepLabel = document.createElement('div');
      sepLabel.className = 'wins-year-sep-label';
      sepLabel.textContent = year;
      const sepLine = document.createElement('div');
      sepLine.className = 'wins-year-sep-line';
      sep.appendChild(sepLabel);
      sep.appendChild(sepLine);
      container.appendChild(sep);
    }
    prevYear = year;

    const weekLabel = `${mn[ws.getMonth()]} ${ws.getDate()}`;

    const col = document.createElement('div');
    col.className = 'wins-block-col';

    const lbl = document.createElement('div');
    lbl.className = 'wins-block-col-label';
    lbl.textContent = weekLabel;
    col.appendChild(lbl);

    for (const item of items) {
      const meta = winsMeta[item.key] || {};
      const emoji = meta.emoji || null;

      const block = document.createElement('div');
      block.className = 'win-block' + (emoji ? ' win-block--marked' : '');
      block.textContent = emoji || '';

      block.onmouseenter = e => {
        tip.innerHTML = `<span style="color:var(--label);font-size:9px">${item.date}</span><br>${item.text}<br><span style="color:var(--label);font-size:9px">click to cycle emoji</span>`;
        tip.style.display = 'block';
        tip.style.left = (e.clientX + 14) + 'px';
        tip.style.top = (e.clientY - 60) + 'px';
      };
      block.onmousemove = e => { tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY - 60) + 'px'; };
      block.onmouseleave = () => { tip.style.display = 'none'; };

      block.onclick = () => {
        tip.style.display = 'none';
        const nextEmoji = cycleEmoji(item.key);
        block.textContent = nextEmoji || '';
        block.className = 'win-block' + (nextEmoji ? ' win-block--marked' : '');
        updateStats();
      };

      col.appendChild(block);
    }

    container.appendChild(col);
  }

  journal.appendChild(container);
}

// =========================================
// DOWNLOAD
// =========================================
function downloadAll() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('journal_')) out[k.slice(8)] = JSON.parse(localStorage.getItem(k) || '{}');
  }
  const b = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = 'journal_all.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// =========================================
// AUTH
// =========================================
function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider)
    .then(userCred => {
      const user = userCred.user;
      document.getElementById("user-info").textContent = `👤 ${user.email}`;
      document.getElementById("login-btn").style.display = "none";
      document.getElementById("logout-btn").style.display = "inline-block";
      allEntriesCache = null;
      journal.innerHTML = '';
      baseDate = new Date();
      renderSingle(formatDate(baseDate));
    })
    .catch(error => console.error("Login error:", error));
}

function signOut() {
  auth.signOut().then(() => {
    document.getElementById("login-btn").style.display = "inline-block";
    document.getElementById("logout-btn").style.display = "none";
    document.getElementById("user-info").textContent = '';
    allEntriesCache = null;
    journal.innerHTML = '';
    baseDate = new Date();
    renderSingle(formatDate(baseDate));
  }).catch(error => console.error("Sign out error:", error));
}

auth.onAuthStateChanged(user => {
  allEntriesCache = null;
  if (user) {
    document.getElementById("login-btn").style.display = "none";
    document.getElementById("logout-btn").style.display = "inline-block";
    document.getElementById("user-info").textContent = `👤 ${user.email}`;
    baseDate = new Date();
    renderSingle(formatDate(baseDate));
  } else {
    document.getElementById("login-btn").style.display = "inline-block";
    document.getElementById("logout-btn").style.display = "none";
    document.getElementById("user-info").textContent = '';
    baseDate = new Date();
    renderSingle(formatDate(baseDate));
    if (mode === 'notes') loadNotes().then(renderNotesView);
  }
});

updateToggleLabel();
