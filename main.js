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

// ... (rest of the JavaScript code from <script> in index.html) ... 