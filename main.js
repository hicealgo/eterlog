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

let mode = 'single';
let notes = [];
let selectedNoteIndex = 0;
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

let baseDate = new Date();
const journal = document.getElementById('journal');
const todayStr = formatDate(new Date());
const MAX_VISIBLE_DAYS = 15;
const rendered = new Map();

if (localStorage.getItem('theme') === 'light') document.body.classList.add('light');

function hardResetToSingleMode() {
  mode = 'single';
  baseDate = new Date();
  journal.onscroll = null;
  journal.innerHTML = '';
  journal.scrollTop = 0;
  rendered.clear();
  renderSingle(formatDate(baseDate));
}

function toggleTheme() {
  document.body.classList.toggle('light');
  localStorage.setItem('theme', document.body.classList.contains('light')? 'light' : 'dark');
}
function updateToggleLabel() {
  const btn = document.getElementById('toggleModeBtn');
  if (mode === 'notes') {
    btn.style.display = 'none';
  } else {
    btn.style.display = 'inline-block';
    btn.textContent = (mode === 'single') ? '🔁 Continuous' : '🔁 Single Day';
  }
}

function formatDate(d) {
  const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return iso.toISOString().split('T')[0];
}
function getDayName(d) {
  return d.toLocaleDateString(undefined, {weekday:'long',timeZone:'UTC'});
}
function loadEntry(date) {
  if (auth.currentUser) {
    return db.collection("journals").doc(auth.currentUser.uid)
      .collection("entries").doc(date)
      .get().then(doc => doc.exists ? doc.data() : {});
  } else {
    return Promise.resolve(JSON.parse(localStorage.getItem('journal_' + date) || '{}'));
  }
}

function saveEntry(date, e) {
  if (auth.currentUser) {
    if (typeof e.then === "function") {
      console.error("❌ Trying to save a Promise instead of an object:", e);
      return;
    }
    db.collection("journals").doc(auth.currentUser.uid)
      .collection("entries").doc(date).set(e);
  } else {
    localStorage.setItem('journal_' + date, JSON.stringify(e));
  }
}

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
      ${['todo','done','misc'].map(f=>`
        <div class="entry">
          <label>${f.toUpperCase()}</label>
          <textarea data-date="${date}" data-field="${f}">${entry[f]||''}</textarea>
        </div>`).join('')}
    </div>`;
  return div;
}

function attachListeners(el=document) {
  el.querySelectorAll('textarea').forEach(t=>{
    t.oninput = async () => {
      if (t.value.length > 5000) {
        t.value = t.value.slice(0, 5000);
        alert("⚠️ 5000 chars max");
      }
      const d = t.dataset.date;
      const f = t.dataset.field;
      const e = await loadEntry(d);
      e[f] = t.value;
      saveEntry(d, e);
    };
  });
}

async function renderSingle(date = formatDate(baseDate)) {
  for (const [d, el] of rendered.entries()) {
    el.style.display = (d === date) ? '' : 'none';
  }
  if (!rendered.has(date)) {
    const el = await createDay(date);
    if (el) {
      journal.appendChild(el);
      rendered.set(date, el);
    }
  }
  attachListeners();
  journal.scrollTop = 0;
  document.getElementById('date-picker').value = formatDate(baseDate);
}

function goToday() {
  baseDate = new Date();
  if (mode === 'single') {
    renderSingle(formatDate(baseDate));
  } else {
    rendered.clear();
    renderScroll();
  }
}

function changeDay(offset) {
  if (mode === 'single') {
    baseDate = new Date(baseDate.getTime());
    baseDate.setDate(baseDate.getDate() + offset);
    renderSingle(formatDate(baseDate));
  } else {
    journal.scrollBy({
      top: offset * journal.clientHeight,
      behavior: 'smooth'
    });
  }
}

function toggleMode() {
  if (mode === 'single') {
    mode = 'scroll';
    renderScroll();
  } else {
    hardResetToSingleMode();
  }
  updateToggleLabel();
}

async function renderScroll() {
  const centerDateStr = formatDate(baseDate);
  const daysToShow = [];
  for (let i = -6; i <= 6; i++) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + i);
    daysToShow.push(formatDate(d));
  }
  daysToShow.sort();
  const elements = [];
  for (const dateStr of daysToShow) {
    let el = rendered.get(dateStr);
    if (!el) {
      el = await createDay(dateStr);
      if (el) rendered.set(dateStr, el);
    }
    if (el) {
      el.style.display = '';
      elements.push([dateStr, el]);
    }
  }
  journal.innerHTML = '';
  for (const [_, el] of elements) {
    journal.appendChild(el);
  }
  attachListeners();
  setupScroll();
  const targetEl = rendered.get(centerDateStr);
  if (targetEl) {
    journal.scrollTop = targetEl.offsetTop - 100;
  }
}

function scrollToDate(targetDateStr) {
  const el = document.querySelector(`.day-container[data-date="${targetDateStr}"]`);
  if (el) {
    journal.scrollTo({ top: el.offsetTop - 100, behavior: 'instant' });
  } else {
    setTimeout(() => scrollToDate(targetDateStr), 50);
  }
}

function setupScroll() {
  let isLoading = false;
  journal.onscroll = async () => {
    if (isLoading) return;
    isLoading = true;
    const st = journal.scrollTop, sh = journal.scrollHeight,
          ch = journal.clientHeight, buf = 200;
    const fd = new Date(journal.firstChild?.dataset.date),
          ld = new Date(journal.lastChild?.dataset.date);
    if (st < buf) {
      const prevHeight = journal.scrollHeight;
      for (let i = 1; i <= 3; i++) {
        const d = new Date(fd);
        d.setDate(fd.getDate() - i);
        const s = formatDate(d);
        if (!rendered.has(s)) {
          const el = await createDay(s);
          if (el) {
            journal.prepend(el);
            rendered.set(s, el);
          }
        }
      }
      const heightDiff = journal.scrollHeight - prevHeight;
      journal.scrollTop += heightDiff;
    }
    if (st + ch > sh - buf) {
      for (let i = 1; i <= 3; i++) {
        const d = new Date(ld);
        d.setDate(ld.getDate() + i);
        const s = formatDate(d);
        if (!rendered.has(s)) {
          const el = await createDay(s);
          if (el) {
            journal.appendChild(el);
            rendered.set(s, el);
          }
        }
      }
    }
    while (journal.children.length > MAX_VISIBLE_DAYS) {
      const rm = journal.scrollTop > journal.scrollHeight / 2
        ? journal.firstChild
        : journal.lastChild;
      rendered.delete(rm.dataset.date);
      journal.removeChild(rm);
    }
    attachListeners();
    const journalRect = journal.getBoundingClientRect();
    for (const [dateStr, el] of rendered.entries()) {
      const rect = el.getBoundingClientRect();
      const fullyVisible = rect.top >= journalRect.top && rect.bottom <= journalRect.bottom;
      if (fullyVisible) {
        document.getElementById('date-picker').value = dateStr;
        break;
      }
    }
    isLoading = false;
  };
}

function downloadAll(){
  const out={};
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i);
    if(k.startsWith('journal_')){
      out[k.slice(8)] = loadEntry(k.slice(8));
    }
  }
  const b=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(b);
  a.download='journal_all.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function goToDate(dateStr) {
  if (!dateStr) return;
  const [y, m, d] = dateStr.split('-').map(Number);
  baseDate = new Date(y, m - 1, d);
  if (mode === 'single') {
    renderSingle(formatDate(baseDate));
  } else {
    rendered.clear();
    renderScroll();
  }
}

updateToggleLabel();

function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider)
    .then(userCred => {
      const user = userCred.user;
      console.log("✅ Logged in as:", user.email);
      document.getElementById("user-info").textContent = `👤 ${user.email}`;
      document.getElementById("login-btn").style.display = "none";
      document.getElementById("logout-btn").style.display = "inline-block";
      journal.innerHTML = '';
      baseDate = new Date();
      renderSingle(formatDate(baseDate));
    })
    .catch(error => {
      console.error("Login error:", error);
    });
}

function signOut() {
  auth.signOut().then(() => {
    console.log("Signed out.");
    document.getElementById("login-btn").style.display = "inline-block";
    document.getElementById("logout-btn").style.display = "none";
    document.getElementById("user-info").textContent = '';
    journal.innerHTML = '';
    baseDate = new Date();
    renderSingle(formatDate(baseDate));
  }).catch(error => {
    console.error("Sign out error:", error);
  });
}

auth.onAuthStateChanged(user => {
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

function loadNotes() {
  if (auth.currentUser) {
    return db.collection("notes").doc(auth.currentUser.uid)
      .get().then(doc => {
        notes = doc.exists ? doc.data().bits || [] : [];
      });
  } else {
    notes = JSON.parse(localStorage.getItem("note_bits") || "[]");
    return Promise.resolve();
  }
}

function saveNotes() {
  if (auth.currentUser) {
    db.collection("notes").doc(auth.currentUser.uid)
      .set({ bits: notes });
  } else {
    localStorage.setItem("note_bits", JSON.stringify(notes));
  }
}

async function toggleNotesMode() {
  if (mode === 'notes') {
    mode = 'single';
    document.getElementById('toggleNotesBtn').textContent = '🗒️ Bits';
    journal.innerHTML = '';
    rendered.clear();
    renderSingle(formatDate(baseDate));
  } else {
    mode = 'notes';
    document.getElementById('toggleNotesBtn').textContent = '📅 Days Mode';
    await loadNotes();
    if (notes.length === 0) {
      notes.push({ content: '' });
      selectedNoteIndex = 0;
      saveNotes();
    }
    renderNotesView();
  }
  updateToggleLabel();
  const navBtns = document.querySelectorAll(".nav-buttons button");
  navBtns.forEach(btn => {
    const text = btn.textContent;
    if (text.includes('Prev') || text.includes('Today') || text.includes('Next')) {
      btn.style.display = (mode === 'notes') ? 'none' : 'inline-block';
    }
  });
}

function renderNotesView() {
  journal.innerHTML = '';
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.height = '100%';
  const sidebar = document.createElement('div');
  sidebar.style.width = '120px';
  sidebar.style.borderRight = '1px solid var(--accent)';
  sidebar.style.overflowY = 'auto';
  const main = document.createElement('div');
  main.style.flex = '1';
  main.style.padding = '16px';
  const storedIndex = parseInt(localStorage.getItem("note_selected_index"));
  if (!isNaN(storedIndex) && storedIndex < notes.length) {
    selectedNoteIndex = storedIndex;
  }
  function openTrash() {
    const trash = JSON.parse(localStorage.getItem("note_trash") || "[]");
    const out = trash.map((n, i) =>
      `#${i}\n${n.content.slice(0, 300)}`
    ).join("\n\n──────────────\n\n");
    document.getElementById("trash-content").textContent = out;
    document.getElementById("trash-modal").style.display = 'block';
  }
  function closeTrash() {
    document.getElementById("trash-modal").style.display = 'none';
  }
  function emptyTrash() {
    if (!confirm("¿Vaciar papelera?")) return;
    localStorage.removeItem("note_trash");
    closeTrash();
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
      del.textContent = '×';
      del.className = 'delete-btn';
      del.onclick = (e) => {
        e.stopPropagation();
        const removed = notes.splice(i, 1)[0];
        const trash = JSON.parse(localStorage.getItem("note_trash") || "[]");
        trash.unshift(removed);
        localStorage.setItem("note_trash", JSON.stringify(trash));
        if (selectedNoteIndex >= notes.length) selectedNoteIndex = notes.length - 1;
        saveNotes();
        renderSidebar();
        renderMain();
      };
      b.appendChild(del);
      b.style.padding = '4px';
      b.style.cursor = 'pointer';
      b.style.borderBottom = '1px solid var(--accent)';
      b.style.background = i === selectedNoteIndex ? 'var(--highlight)' : '';
      b.onclick = () => {
        selectedNoteIndex = i;
        localStorage.setItem("note_selected_index", i);
        renderSidebar();
        renderMain();
      };
      sidebar.appendChild(b);
    });
    const add = document.createElement('button');
    add.textContent = '+';
    add.style.width = '100%';
    add.style.background = 'var(--bg)';
    add.style.color = 'var(--fg)';
    add.style.border = '1px solid var(--accent)';
    add.style.cursor = 'pointer';
    add.onclick = () => {
      if (notes.length >= 50) {
        alert("❌ 50 notes max");
        return;
      }
      notes.unshift({ content: '' });
      selectedNoteIndex = 0;
      saveNotes();
      renderSidebar();
      renderMain();
    };
    sidebar.appendChild(add);
    const trashBtn = document.createElement('button');
    trashBtn.textContent = '🗑 Trash';
    trashBtn.style.width = '100%';
    trashBtn.style.background = 'var(--bg)';
    trashBtn.style.color = 'var(--fg)';
    trashBtn.style.border = '1px solid var(--accent)';
    trashBtn.style.cursor = 'pointer';
    trashBtn.onclick = openTrash;
    trashBtn.style.position = 'absolute';
    trashBtn.style.bottom = '0';
    trashBtn.style.left = '0';
    trashBtn.style.width = '100%';
    sidebar.style.position = 'relative';
    sidebar.style.paddingBottom = '36px';
    sidebar.appendChild(trashBtn);
  }
  function renderMain() {
    main.innerHTML = '';
    const note = notes[selectedNoteIndex];
    if (!note) return;
    const ta = document.createElement('textarea');
    ta.style.width = '100%';
    ta.style.height = '100%';
    ta.value = note.content;
    ta.style.background = getComputedStyle(document.body).getPropertyValue('--textarea').trim();
    ta.style.color = getComputedStyle(document.body).getPropertyValue('--fg').trim();
    ta.style.border = `1px solid ${getComputedStyle(document.body).getPropertyValue('--accent').trim()}`;
    ta.style.padding = '8px';
    ta.style.fontFamily = 'inherit';
    ta.style.fontSize = '14px';
    ta.oninput = () => {
      if (ta.value.length > 10000) {
        ta.value = ta.value.slice(0, 10000);
        alert("⚠️ max 10000 chars");
      }
      note.content = ta.value;
      saveNotes();
      renderSidebar();
    };
    main.appendChild(ta);
  }
  renderSidebar();
  renderMain();
  container.appendChild(sidebar);
  container.appendChild(main);
  journal.appendChild(container);
  const emptyBtn = document.getElementById("emptyTrashBtn");
  const closeBtn = document.getElementById("closeTrashBtn");
  if (emptyBtn) emptyBtn.onclick = emptyTrash;
  if (closeBtn) closeBtn.onclick = closeTrash;
} 