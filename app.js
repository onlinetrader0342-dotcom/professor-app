/* ==========================================================================
 * Professor — mobile-friendly static web app
 * Gemini text API (generateContent) + Web Speech API se chalne wala
 * AI study tutor (Voice Tutor mode).
 * Koi backend/server nahi: API key end-user ki (BYOK), sirf localStorage me.
 * ========================================================================== */
'use strict';

/* ---------------- helpers ---------------- */
const $ = (id) => document.getElementById(id);

function toast(msg, ok = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (ok ? ' ok' : '');
  el.textContent = msg;
  $('toast-wrap').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/* ---------------- theme (dark default + toggle) ---------------- */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('sc-theme', theme);
  $('btn-theme').textContent = theme === 'dark' ? '🌙' : '☀️';
  // mermaid diagrams ko theme ke mutabiq dobara initialize karo
  if (window.mermaid) {
    try {
      mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default' });
      renderedDiagramCount = 0; // agle render par naye ids
      renderDiagrams(true);
    } catch (e) { /* mermaid abhi load nahi hua to khair */ }
  }
}
function initTheme() {
  applyTheme(localStorage.getItem('sc-theme') || 'dark');
}

/* ---------------- screens ---------------- */
const SCREENS = ['screen-login', 'screen-key', 'screen-main'];
function show(id) {
  SCREENS.forEach(s => $(s).classList.toggle('hidden', s !== id));
}
function goLogin()  { show('screen-login'); }
function goKey()    { show('screen-key'); }
function goMain()   { show('screen-main'); setReady(); }

/* ---------------- global state ---------------- */
let currentUser = null;      // firebase user ya demo user
let demoMode = false;
let apiKey = '';
let docText = '';            // PDF se nikala hua text (tutor context ke liye)
let docName = '';
let transcriptEl, diagramWrap, quizWrap;
let chatHistory = [];        // [{role:'user'|'model', text}] — aakhri 10 turns bhejte hain
let recog = null;            // SpeechRecognition instance
let recogLang = 'ur-PK';
let recogRetried = false;
let listening = false;
let speakerOn = localStorage.getItem('sc-speaker') !== 'off';

const TEXT_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent';
const SYSTEM_PROMPT = 'You are a friendly study tutor. Explain clearly in simple words, ' +
  'ask Socratic questions to check understanding, and keep answers concise (short paragraphs). ' +
  'The user speaks Roman Urdu / English mix — reply in the same mix. ' +
  'If the user asks for a diagram, output a ```mermaid code block.';

/* ==========================================================================
 * Firebase Auth — email/password + Google sign-in (compat CDN)
 * Config placeholder ho to notice + demo mode.
 * ========================================================================== */
let auth = null;
let firebaseReady = false;

const AUTH_MSGS = {
  'auth/invalid-credential': 'Email ya password ghalat hai.',
  'auth/user-not-found': 'Is email ka account nahi mila — pehle "Naya account" banayein.',
  'auth/wrong-password': 'Password ghalat hai.',
  'auth/email-already-in-use': 'Is email par pehle se account hai — login karein.',
  'auth/weak-password': 'Password kam az kam 6 harf ka rakhein.',
  'auth/invalid-email': 'Email ka format theek nahi lag raha.',
  'auth/popup-closed-by-user': 'Google login band kar diya gaya.',
  'auth/network-request-failed': 'Internet ka masla lagta hai — dobara koshish karein.',
  'auth/operation-not-allowed': 'Yeh login tareeqa Firebase me on nahi — SETUP.md dekhein.',
};
function authMsg(code) { return AUTH_MSGS[code] || 'Kuch garbar hui — dobara koshish karein.'; }

function showFirebaseNotice() {
  const n = $('firebase-notice');
  n.classList.remove('hidden');
  n.innerHTML = '⚠️ <b>Firebase setup baqi hai</b> — login ke liye SETUP.md me diye gaye ' +
    'steps se apni config <code>firebase-config.js</code> me paste karein. ' +
    'Tab tak neeche <b>Demo mode</b> se app try kar sakte hain.';
  $('btn-demo').classList.remove('hidden');
  // login buttons disable kar do taake ghalat umeed na ho
  ['btn-login', 'btn-signup', 'btn-google'].forEach(id => { $(id).disabled = true; });
}

function initFirebase() {
  if (typeof firebase === 'undefined') {
    $('firebase-notice').classList.remove('hidden');
    $('firebase-notice').textContent = '⚠️ Firebase library load nahi hui — internet check karke page reload karein.';
    $('btn-demo').classList.remove('hidden');
    return;
  }
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey || cfg.apiKey === 'PASTE_YOUR_API_KEY') {
    showFirebaseNotice();
    return;
  }
  try {
    firebase.initializeApp(cfg);
    auth = firebase.auth();
    firebaseReady = true;
    auth.onAuthStateChanged((u) => {
      if (u) {
        currentUser = u;
        updateUserChip();
        goKey();
      }
    });
  } catch (e) {
    console.error('Firebase init failed:', e);
    showFirebaseNotice();
  }
}

function updateUserChip() {
  const chip = $('user-chip');
  if (currentUser) {
    chip.textContent = demoMode ? 'Demo user' : (currentUser.email || 'Logged in');
    chip.classList.remove('hidden');
    $('btn-logout').classList.remove('hidden');
  } else {
    chip.classList.add('hidden');
    $('btn-logout').classList.add('hidden');
  }
}

function wireAuth() {
  const email = () => $('login-email').value.trim();
  const pass = () => $('login-pass').value;

  $('btn-login').addEventListener('click', async () => {
    if (!firebaseReady) return;
    $('auth-error').textContent = '';
    try {
      await auth.signInWithEmailAndPassword(email(), pass());
      // onAuthStateChanged agay le jayega
    } catch (e) { $('auth-error').textContent = authMsg(e.code); }
  });

  $('btn-signup').addEventListener('click', async () => {
    if (!firebaseReady) return;
    $('auth-error').textContent = '';
    try {
      await auth.createUserWithEmailAndPassword(email(), pass());
      toast('Account ban gaya — khush aamdeed! 🎉', true);
    } catch (e) { $('auth-error').textContent = authMsg(e.code); }
  });

  $('btn-google').addEventListener('click', async () => {
    if (!firebaseReady) return;
    $('auth-error').textContent = '';
    try {
      await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
    } catch (e) { $('auth-error').textContent = authMsg(e.code); }
  });

  $('btn-demo').addEventListener('click', () => {
    demoMode = true;
    currentUser = { email: 'demo@local' };
    updateUserChip();
    toast('Demo mode — login ke baghair try karein', true);
    goKey();
  });

  $('btn-logout').addEventListener('click', async () => {
    try { if (auth && !demoMode) await auth.signOut(); } catch (e) { /* khair */ }
    currentUser = null;
    demoMode = false;
    updateUserChip();
    stopSpeaking();
    stopListening();
    goLogin();
  });

  $('btn-back-login').addEventListener('click', () => goLogin());
}

/* ==========================================================================
 * API key screen — BYOK: key sirf localStorage me, kisi server ko nahi jati.
 * ========================================================================== */
function wireKeyScreen() {
  $('api-key-input').value = localStorage.getItem('sc-gemini-key') || '';

  $('btn-toggle-key').addEventListener('click', () => {
    const inp = $('api-key-input');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  $('btn-save-key').addEventListener('click', () => {
    const k = $('api-key-input').value.trim();
    if (!k) { toast('Pehle API key likhein'); return; }
    apiKey = k;
    localStorage.setItem('sc-gemini-key', k);
    toast('Key save ho gayi ✓', true);
    goMain();
  });

  $('btn-test-key').addEventListener('click', async () => {
    const k = $('api-key-input').value.trim();
    if (!k) { toast('Pehle API key likhein'); return; }
    const st = $('key-status');
    st.textContent = '⏳ Key test ho rahi hai...';
    try {
      await testKey(k);
      st.textContent = '✅ Key theek hai — tutor tayyar hai!';
      toast('Key theek hai ✓', true);
    } catch (e) {
      st.textContent = '❌ ' + apiErrMsg(e);
    }
  });
}

async function testKey(k) {
  const res = await fetch(TEXT_API_URL + '?key=' + encodeURIComponent(k), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with one word: ok' }] }] })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const cand = (j.candidates || [])[0];
  const txt = cand && cand.content && cand.content.parts
    ? cand.content.parts.map(p => p.text || '').join('').trim() : '';
  if (!/ok/i.test(txt)) throw new Error('unexpected reply');
}

function apiErrMsg(e) {
  const m = (e && e.message) || '';
  if (m.includes('400') || m.includes('API key')) return 'Key ghalat lag rahi hai — aistudio.google.com/apikey se nayi key lein.';
  if (m.includes('403')) return 'Is key par yeh model allowed nahi — AI Studio me nayi key banayein.';
  if (m.includes('429')) return 'Limit khatm ho gayi — thori der baad koshish karein.';
  if (m.includes('Failed to fetch') || m.includes('NetworkError')) return 'Internet ka masla lagta hai — dobara koshish karein.';
  return 'Jawab nahi mila — key aur internet check karein.';
}

/* ==========================================================================
 * Voice Tutor — Gemini text API (generateContent) + Web Speech API.
 * Koi WebSocket nahi. Mic: SpeechRecognition (ur-PK → en-US fallback).
 * Speaker: speechSynthesis (ur-PK voice preferred).
 * ========================================================================== */
function setStatus(state, label) {
  const pill = $('status-pill');
  pill.className = 'pill ' + state; // 'ready' | 'off'
  pill.textContent = label;
}

function setReady() {
  if (apiKey) {
    setStatus('ready', 'Tayyar ✓');
    $('btn-mic').disabled = false;
    $('mic-hint').textContent = '🎤 dabayein aur bolein, ya neeche likh kar bhejein';
  } else {
    setStatus('off', 'Key chahiye');
    $('btn-mic').disabled = true;
    $('mic-hint').textContent = 'Pehle API key save karein';
  }
}

async function callGemini() {
  const turns = [];
  turns.push({ role: 'user', parts: [{ text: SYSTEM_PROMPT }] });
  if (docText) {
    turns.push({ role: 'user', parts: [{ text: 'Neeche ek document ka text hai. Isi document par tutor karo, is se bahar ki baatein sirf zaroorat par karo:\n\n' + docText.slice(0, 60000) }] });
  }
  for (const t of chatHistory.slice(-10)) {
    turns.push({ role: t.role, parts: [{ text: t.text }] });
  }
  const res = await fetch(TEXT_API_URL + '?key=' + encodeURIComponent(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: turns,
      generationConfig: { temperature: 0.7 }
    })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const cand = (j.candidates || [])[0];
  if (!cand || !cand.content || !cand.content.parts) throw new Error('empty reply');
  return cand.content.parts.map(p => p.text || '').join('').trim();
}

async function askTutor(userText, mode) {
  if (!apiKey) { toast('Pehle API key save karein'); goKey(); return; }
  stopSpeaking();
  stopListening();
  addMsg('user', mode === 'quiz' ? '📝 Quiz ban raha hai…' : userText);
  chatHistory.push({ role: 'user', text: userText });
  const typing = addMsg('ai', '⏳ Soch raha hun…');
  try {
    const reply = await callGemini();
    typing.remove();
    chatHistory.push({ role: 'model', text: reply });
    if (mode === 'quiz') {
      renderQuiz(parseQuiz(reply));
      switchTab('quiz');
      addMsg('ai', 'Quiz tayyar hai! 📝 Quiz tab me dekhein.');
      speak('Quiz tayyar hai. Quiz tab me dekh lein.');
      toast('Quiz tayyar hai! 📝', true);
    } else {
      handleTutorReply(reply);
    }
  } catch (e) {
    console.error('Tutor failed:', e);
    typing.remove();
    addMsg('ai', '⚠️ ' + apiErrMsg(e));
    toast(apiErrMsg(e));
  }
}

function handleTutorReply(reply) {
  addMsg('ai', reply);
  renderDiagrams(false);
  speak(reply);
}

/* ---------------- Speaker (speechSynthesis) ---------------- */
function pickVoice() {
  try {
    const vs = speechSynthesis.getVoices() || [];
    return vs.find(v => v.lang && v.lang.toLowerCase().indexOf('ur') === 0) || null;
  } catch (e) { return null; }
}
function speak(text) {
  if (!speakerOn) return;
  if (!('speechSynthesis' in window)) return;
  stopSpeaking();
  const clean = text
    .replace(/```mermaid[\s\S]*?```/gi, ' (diagram banaya gaya hai) ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#`>]/g, '')
    .trim();
  if (!clean) return;
  try {
    const u = new SpeechSynthesisUtterance(clean);
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'ur-PK'; }
    u.rate = 1;
    speechSynthesis.speak(u);
  } catch (e) { console.error('Speak fail:', e); }
}
function stopSpeaking() {
  try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {}
}
function wireSpeaker() {
  const btn = $('btn-speaker');
  const paint = () => { btn.textContent = speakerOn ? '🔊' : '🔇'; };
  paint();
  btn.addEventListener('click', () => {
    speakerOn = !speakerOn;
    localStorage.setItem('sc-speaker', speakerOn ? 'on' : 'off');
    if (!speakerOn) stopSpeaking();
    paint();
    toast(speakerOn ? 'Tutor ki awaz on 🔊' : 'Tutor ki awaz off 🔇', true);
  });
}

/* ---------------- Mic: Web Speech API ---------------- */
function speechRecogCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}
function setListening(on) {
  listening = on;
  $('btn-mic').classList.toggle('recording', on);
  $('btn-mic').textContent = on ? '⏹' : '🎤';
  $('mic-hint').textContent = on ? '🔴 Sun raha hun… bolein' : '🎤 dabayein aur bolein, ya neeche likh kar bhejein';
}
function startListening() {
  const SR = speechRecogCtor();
  if (!SR) {
    toast('Is browser me mic wali sahulat nahi — neeche likh kar bhejein.');
    $('chat-input').focus();
    return;
  }
  if (listening) { stopListening(); return; }
  try {
    recog = new SR();
  } catch (e) {
    toast('Mic on nahi ho saka — neeche likh kar bhejein.');
    return;
  }
  recog.lang = recogLang;
  recog.interimResults = true;
  recog.continuous = false;
  recog.maxAlternatives = 1;
  recog.onresult = (ev) => {
    let interim = '', final = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    const inp = $('chat-input');
    if (final) {
      inp.value = final.trim();
      stopListening();
      const q = inp.value.trim();
      inp.value = '';
      if (q) askTutor(q);
    } else if (interim) {
      inp.value = interim;
    }
  };
  recog.onerror = (ev) => {
    const err = (ev && ev.error) || '';
    console.error('Speech recog error:', err);
    if ((err === 'no-speech' || err === 'audio-capture') && recogLang === 'ur-PK' && !recogRetried) {
      // ek dafa English me retry
      recogRetried = true;
      recogLang = 'en-US';
      stopListening();
      toast('Urdu samajh nahi ayi — English me dobara koshish karein 🎤');
      setTimeout(startListening, 400);
      return;
    }
    stopListening();
    if (err === 'not-allowed' || err === 'service-not-allowed') toast('Mic ki ijazat nahi mili — browser settings me allow karein.');
    else if (err === 'network') toast('Internet ka masla — dobara koshish karein.');
    else toast('Awaz samajh nahi ayi — neeche likh kar bhejein.');
  };
  recog.onend = () => { if (listening) setListening(false); };
  try {
    recog.start();
    setListening(true);
  } catch (e) {
    toast('Mic on nahi ho saka — neeche likh kar bhejein.');
  }
}
function stopListening() {
  if (recog) { try { recog.onend = null; recog.stop(); } catch (e) {} recog = null; }
  if (listening) setListening(false);
}

/* ---------------- chat input (text) ---------------- */
function wireChat() {
  $('btn-mic').addEventListener('click', () => {
    if (!apiKey) { toast('Pehle API key save karein'); goKey(); return; }
    startListening();
  });
  const send = () => {
    if (!apiKey) { toast('Pehle API key save karein'); goKey(); return; }
    const inp = $('chat-input');
    const q = inp.value.trim();
    if (!q) return;
    inp.value = '';
    askTutor(q);
  };
  $('btn-send').addEventListener('click', send);
  $('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
  });
  wireSpeaker();
}

/* ==========================================================================
 * Transcript + tabs (Transcript | Diagram | Quiz)
 * ========================================================================== */
function addMsg(role, text) {
  const ph = transcriptEl.querySelector('.placeholder');
  if (ph) ph.remove();
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = role === 'ai' ? '🤖 Tutor' : '🧑 Aap';
  div.appendChild(who);
  const body = document.createElement('span');
  body.textContent = text;
  div.appendChild(body);
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return div;
}

/* ---------------- Diagram tab: ```mermaid blocks ---------------- */
function extractMermaidBlocks() {
  const all = transcriptEl.innerText || '';
  const blocks = [];
  const re = /```mermaid\s*([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(all)) !== null) blocks.push(m[1].trim());
  return blocks;
}

async function renderDiagrams(force) {
  if (!window.mermaid) return;
  const blocks = extractMermaidBlocks();
  if (!force && blocks.length === renderedDiagramCount) return; // kuch naya nahi
  renderedDiagramCount = blocks.length;
  diagramWrap.innerHTML = '';
  if (!blocks.length) {
    diagramWrap.innerHTML = '<p class="muted placeholder">Diagram yahan nazar ayega — tutor se kahein "is ka diagram banao"</p>';
    return;
  }
  for (let i = 0; i < blocks.length; i++) {
    const box = document.createElement('div');
    box.className = 'mermaid-box';
    diagramWrap.appendChild(box);
    try {
      const { svg } = await mermaid.render('sc-mermaid-' + i + '-' + Date.now(), blocks[i]);
      box.innerHTML = svg;
    } catch (e) {
      box.innerHTML = '<p class="error">Diagram render nahi ho saka — code me ghalti ho sakti hai.</p>';
    }
  }
}

/* ---------------- Quiz tab ---------------- */
const QUIZ_PROMPT = 'Is document/topic par 3 quiz sawal banao. SAKHT format follow karo, koi izafi text nahi:\n' +
  'Q: <pehla sawal>\nA: <us ka jawab>\nQ: <doosra sawal>\nA: <us ka jawab>\nQ: <teesra sawal>\nA: <us ka jawab>';

function parseQuiz(text) {
  const items = [];
  let cur = null;
  const push = () => { if (cur && cur.q) items.push(cur); cur = null; };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[\s*>-]+/, '').trim();
    if (!line) continue;
    const qm = line.match(/^(?:\*\*)?(?:Q(?:uestion)?|Sawal)\s*\d*\s*[:.)\-]\s*(?:\*\*)?\s*(.+)$/i);
    const am = line.match(/^(?:\*\*)?(?:A(?:nswer)?|Jawab)\s*\d*\s*[:.)\-]\s*(?:\*\*)?\s*(.+)$/i);
    if (qm) { push(); cur = { q: qm[1].trim(), a: '' }; }
    else if (am && cur) { cur.a += (cur.a ? ' ' : '') + am[1].trim(); }
    else if (cur && line.length > 1) {
      // tolerant: bina label ke line pichli cheez se jor do
      if (!cur.a) cur.q += ' ' + line; else cur.a += ' ' + line;
    }
  }
  push();
  return items.slice(0, 10);
}

function renderQuiz(items) {
  quizWrap.innerHTML = '';
  if (!items.length) {
    quizWrap.innerHTML = '<p class="error">Quiz samajh nahi aya — dobara "Quiz banao" dabayein.</p>';
    return;
  }
  items.forEach((it, i) => {
    const card = document.createElement('div');
    card.className = 'quiz-card';
    card.innerHTML = '<div class="q">' + (i + 1) + '. </div>';
    card.querySelector('.q').appendChild(document.createTextNode(it.q));
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = 'Jawab dekhein';
    const ans = document.createElement('div');
    ans.className = 'a hidden';
    ans.textContent = it.a || '(jawab nahi mila)';
    btn.addEventListener('click', () => {
      const hidden = ans.classList.toggle('hidden');
      btn.textContent = hidden ? 'Jawab dekhein' : 'Jawab chhupayein';
    });
    card.appendChild(btn);
    card.appendChild(ans);
    quizWrap.appendChild(card);
  });
}

function wireQuiz() {
  $('btn-quiz').addEventListener('click', () => {
    if (!apiKey) { toast('Pehle API key save karein'); goKey(); return; }
    quizWrap.innerHTML = '<p class="muted">⏳ Quiz ban raha hai…</p>';
    askTutor(QUIZ_PROMPT, 'quiz');
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $('tab-transcript').classList.toggle('hidden', name !== 'transcript');
  $('tab-diagram').classList.toggle('hidden', name !== 'diagram');
  $('tab-quiz').classList.toggle('hidden', name !== 'quiz');
  if (name === 'diagram') renderDiagrams(true);
}
function wireTabs() {
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => switchTab(t.dataset.tab)));
}

/* ==========================================================================
 * Document viewer — drag&drop PDF, pdf.js render, text extract, state reset
 * ========================================================================== */
let pdfDoc = null, pdfPage = 1, pdfScale = 1.4;

function resetAllState() {
  // Nayi file = mukammal reset: guftagu, transcript, quiz, diagram sab saaf
  stopSpeaking();
  stopListening();
  chatHistory = [];
  setReady();
  transcriptEl.innerHTML = '<p class="muted placeholder">Abhi koi guftagu nahi — neeche likhein ya 🎤 dabayein 🎙</p>';
  diagramWrap.innerHTML = '<p class="muted placeholder">Diagram yahan nazar ayega — tutor se kahein "is ka diagram banao"</p>';
  quizWrap.innerHTML = '';
  renderedDiagramCount = 0;
  docText = ''; docName = '';
  $('doc-name').textContent = '';
  pdfDoc = null; pdfPage = 1;
  $('pdf-canvas').classList.add('hidden');
  $('pdf-toolbar').classList.add('hidden');
  $('dropzone').classList.remove('hidden');
}

async function handleFile(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    toast('Sirf PDF file chale gi');
    return;
  }
  if (typeof pdfjsLib === 'undefined') {
    toast('PDF library load nahi hui — internet check karke reload karein');
    return;
  }
  resetAllState();
  docName = file.name;
  $('doc-name').textContent = '📄 ' + docName;
  try {
    const buf = await file.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
    $('dropzone').classList.add('hidden');
    $('pdf-toolbar').classList.remove('hidden');
    $('pdf-canvas').classList.remove('hidden');
    await renderPdfPage(1);
    toast('PDF load ho gayi — text nikala ja raha hai…', true);
    docText = await extractPdfText(pdfDoc);
    if (!docText.trim()) toast('Is PDF se text nahi nikal saka (shayad scanned tasveer hai)');
    else toast('Tayyar! Neeche sawal likhein ya 🎤 dabayein 📖', true);
  } catch (e) {
    console.error('PDF fail:', e);
    toast('PDF kholne me masla hua — file check karein');
    resetAllState();
  }
}

async function renderPdfPage(n) {
  if (!pdfDoc) return;
  pdfPage = Math.max(1, Math.min(n, pdfDoc.numPages));
  const page = await pdfDoc.getPage(pdfPage);
  const viewport = page.getViewport({ scale: pdfScale });
  const canvas = $('pdf-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  $('page-info').textContent = pdfPage + ' / ' + pdfDoc.numPages;
}

async function extractPdfText(doc) {
  // pehle 30 pages tak, context limit me rakho
  const maxPages = Math.min(doc.numPages, 30);
  let out = '';
  for (let i = 1; i <= maxPages && out.length < 60000; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    out += tc.items.map(it => it.str).join(' ') + '\n';
  }
  return out;
}

function wireDocument() {
  const dz = $('dropzone');
  const fi = $('file-input');
  dz.addEventListener('click', () => fi.click());
  fi.addEventListener('change', () => handleFile(fi.files[0]));
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
  dz.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(f);
  });

  $('btn-prev').addEventListener('click', () => renderPdfPage(pdfPage - 1));
  $('btn-next').addEventListener('click', () => renderPdfPage(pdfPage + 1));
  $('btn-zoom-in').addEventListener('click', () => { pdfScale = Math.min(3, pdfScale * 1.2); renderPdfPage(pdfPage); });
  $('btn-zoom-out').addEventListener('click', () => { pdfScale = Math.max(0.5, pdfScale / 1.2); renderPdfPage(pdfPage); });
  $('btn-new-doc').addEventListener('click', () => { resetAllState(); fi.value = ''; });
}

/* ==========================================================================
 * Init
 * ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  transcriptEl = $('transcript');
  diagramWrap = $('diagram-wrap');
  quizWrap = $('quiz-wrap');

  // pdf.js worker
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  // mermaid init
  if (window.mermaid) {
    try { mermaid.initialize({ startOnLoad: false, theme: 'dark' }); } catch (e) {}
  }

  initTheme();
  $('btn-theme').addEventListener('click', () => {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  apiKey = localStorage.getItem('sc-gemini-key') || '';

  wireAuth();
  wireKeyScreen();
  wireChat();
  wireDocument();
  wireTabs();
  wireQuiz();
  initFirebase();
  goLogin();
});
