/* ==========================================================================
 * Professor — mobile-friendly static web app
 * Gemini Live API (WebSocket) se chalne wala AI study tutor.
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
function goMain()   { show('screen-main'); updateSessionUI(); }

/* ---------------- global state ---------------- */
let currentUser = null;      // firebase user ya demo user
let demoMode = false;
let apiKey = '';
let session = null;          // LiveSession instance
let micHandle = null;        // mic capture handle
let recording = false;
let docText = '';            // PDF se nikala hua text (Live context ke liye)
let docName = '';
let transcriptEl, diagramWrap, quizWrap;
let currentAiDiv = null;     // streaming AI message ka div
let collectingQuiz = false;
let quizBuffer = '';
let renderedDiagramCount = 0;
let vizRAF = null;

const LIVE_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const LIVE_MODEL = 'models/gemini-3.1-flash-live-preview';
const SYSTEM_PROMPT = 'You are a friendly study tutor. Explain clearly in simple words, ' +
  'ask Socratic questions to check understanding, and keep answers concise. ' +
  'If the user asks for a diagram, output a ```mermaid code block. ' +
  'The user speaks Roman Urdu / English mix — reply in the same mix.';

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
    stopSessionQuiet();
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
      const s = new LiveSession(k, {});
      await s.testOnly();
      st.textContent = '✅ Key theek hai — Live API se connect ho gaya!';
      toast('Key theek hai ✓', true);
    } catch (e) {
      st.textContent = '❌ ' + liveErrMsg(e);
    }
  });
}

function liveErrMsg(e) {
  const m = (e && e.message) || '';
  if (m.includes('timeout')) return 'Server ne jawab nahi diya — internet ya key check karein.';
  if (m.includes('400') || m.includes('invalid') || m.includes('API key')) return 'Key ghalat lag rahi hai — aistudio.google.com/apikey se nayi key lein.';
  if (m.includes('socket') || m.includes('closed')) return 'Connect nahi ho saka — internet check karein.';
  return 'Key test nakaam — key aur internet check karein.';
}

/* ==========================================================================
 * Audio helpers — PCM16 base64 encode/decode, 16kHz downsampling
 * ========================================================================== */
function base64FromInt16(int16) {
  // bytes par fromCharCode lagao (seedhe int16 values par nahi —
  // negative values ka byte order bigar jata hai)
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(s);
}
function int16FromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}
function floatTo16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const v = Math.max(-1, Math.min(1, float32[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}
function downsample(float32, inRate, outRate) {
  if (inRate === outRate) return float32;
  const ratio = inRate / outRate;
  const len = Math.floor(float32.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = float32[Math.floor(i * ratio)];
  return out;
}

/* ---------------- Audio OUT: server ki 24kHz audio chalana ---------------- */
class AudioOut {
  constructor() { this.ctx = null; this.queue = []; this.nextTime = 0; this.playing = false; }
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ sampleRate: 24000 });
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  enqueue(b64) {
    try {
      this.ensure();
      const i16 = int16FromBase64(b64);
      const f32 = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
      const buf = this.ctx.createBuffer(1, f32.length, 24000);
      buf.getChannelData(0).set(f32);
      this.queue.push(buf);
      this.schedule();
    } catch (e) { console.error('Audio decode fail:', e); }
  }
  schedule() {
    if (this.playing) return;
    this.playing = true;
    const playNext = () => {
      const buf = this.queue.shift();
      if (!buf) { this.playing = false; return; }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      const t = Math.max(this.ctx.currentTime, this.nextTime);
      try { src.start(t); } catch (e) { this.playing = false; return; }
      this.nextTime = t + buf.duration;
      src.onended = playNext;
    };
    playNext();
  }
  interrupt() { this.queue.length = 0; this.nextTime = 0; } // user ne beech me bola
}

/* ---------------- Audio IN: mic → 16kHz PCM16 ---------------- */
async function startMicCapture(onChunk, analyserOut) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  if (ctx.state === 'suspended') await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  src.connect(analyser);
  analyserOut.node = analyser;

  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const inRate = ctx.sampleRate;
  proc.onaudioprocess = (e) => {
    const ch = e.inputBuffer.getChannelData(0);
    const down = downsample(ch, inRate, 16000);
    onChunk(base64FromInt16(floatTo16(down)));
  };
  // onaudioprocess chalne ke liye graph destination se jurna zaroori hai —
  // gain 0 taake feedback/echo na ho.
  const zero = ctx.createGain();
  zero.gain.value = 0;
  src.connect(proc);
  proc.connect(zero);
  zero.connect(ctx.destination);

  return {
    stop() {
      try { proc.disconnect(); src.disconnect(); } catch (e) {}
      stream.getTracks().forEach(t => t.stop());
      ctx.close().catch(() => {});
    }
  };
}

/* ==========================================================================
 * LiveSession — Gemini Live API WebSocket client
 * ========================================================================== */
class LiveSession {
  constructor(key, handlers) {
    this.key = key;
    this.h = handlers || {};
    this.ws = null;
    this.audioOut = new AudioOut();
    this.ready = false;
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  connect(systemInstruction) {
    // Live session: setupComplete par resolve, socket khula rehta hai
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, val) => { if (!done) { done = true; clearTimeout(timer); fn(val); } };
      const timer = setTimeout(() => { try { this.ws.close(); } catch (e) {} finish(reject, new Error('timeout')); }, 25000);

      const ws = new WebSocket(LIVE_WS_URL + '?key=' + encodeURIComponent(this.key));
      this.ws = ws;
      ws.onopen = () => {
        this._send({
          setup: {
            model: LIVE_MODEL,
            responseModalities: ['AUDIO', 'TEXT'],
            systemInstruction: { parts: [{ text: systemInstruction }] }
          }
        });
      };
      ws.onmessage = (ev) => this._onMessage(ev.data, (ok, err) => ok ? finish(resolve) : finish(reject, err));
      ws.onerror = () => finish(reject, new Error('socket error'));
      ws.onclose = () => {
        this.ready = false;
        if (this.h.onClose) this.h.onClose();
      };
    });
  }

  async testOnly() {
    // Sirf key test: setupComplete milte hi band kar do
    await this.connect('You are a test. Reply with one word: ok.');
    this.close();
  }

  _onMessage(raw, setupCb) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.setupComplete) {
      this.ready = true;
      if (setupCb) setupCb(true);
      if (this.h.onReady) this.h.onReady();
      return;
    }
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.interrupted) { this.audioOut.interrupt(); return; } // user ne beech me bola
    const turn = sc.modelTurn;
    if (turn && Array.isArray(turn.parts)) {
      for (const p of turn.parts) {
        if (p.inlineData && p.inlineData.data) this.audioOut.enqueue(p.inlineData.data); // 24kHz audio
        else if (typeof p.text === 'string' && p.text) {
          if (this.h.onText) this.h.onText(p.text);
        }
      }
    }
    if (sc.turnComplete && this.h.onTurnComplete) this.h.onTurnComplete();
  }

  sendText(text) {
    this._send({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } });
  }
  sendAudioChunk(b64) {
    this._send({ realtimeInput: { audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } } });
  }
  close() {
    try { if (this.ws) this.ws.close(); } catch (e) {}
    this.ws = null;
    this.ready = false;
  }
}

/* ==========================================================================
 * Session controls — start/stop, status pill, mic toggle + visualizer
 * ========================================================================== */
function setStatus(state, label) {
  const pill = $('status-pill');
  pill.className = 'pill ' + (state === 'live' ? 'live' : state === 'connecting' ? 'connecting' : 'off');
  pill.textContent = label;
}

function updateSessionUI() {
  const live = session && session.ready;
  $('btn-session').textContent = live ? '⏹ Session stop' : '▶ Session start';
  $('btn-session').classList.toggle('primary', !live);
  $('btn-mic').disabled = !live;
  if (!live) {
    $('mic-hint').textContent = 'Mic ke liye pehle "Session start" dabayein';
    setMicRecording(false);
  } else {
    $('mic-hint').textContent = '🎤 dabayein aur bolein — tutor sun raha hai';
  }
}

async function startSession() {
  if (!apiKey) { toast('Pehle API key save karein'); goKey(); return; }
  setStatus('connecting', 'Connecting...');
  $('btn-session').disabled = true;
  addMsg('user', '— session start ho rahi hai… —');

  session = new LiveSession(apiKey, {
    onText: handleModelText,
    onTurnComplete: () => { currentAiDiv = null; if (collectingQuiz) finishQuiz(); },
    onClose: () => {
      setStatus('off', 'Disconnected');
      stopMicQuiet();
      updateSessionUI();
      $('btn-session').disabled = false;
    }
  });

  try {
    await session.connect(SYSTEM_PROMPT);
    setStatus('live', 'Live');
    addMsg('ai', 'Assalam-o-Alaikum! 👋 Me aap ka study tutor hun. ' +
      (docText ? 'Aap ki file parh li hai — us par sawal poochein ya kahein "quiz banao".' : 'Bolein, kya parhna hai?'));
    // document ka text context ke tor par bhejo
    if (docText) {
      session.sendText('Neeche ek document ka text hai. Isi document par tutor karo, ' +
        'is se bahar ki baatein sirf zaroorat par karo:\n\n' + docText.slice(0, 60000));
    }
    toast('Live session shuru! 🎙', true);
  } catch (e) {
    console.error('Session failed:', e);
    setStatus('off', 'Disconnected');
    session = null;
    toast('Session start nahi hui: ' + liveErrMsg(e));
  }
  $('btn-session').disabled = false;
  updateSessionUI();
}

function stopSession() {
  stopMicQuiet();
  if (session) { session.close(); session = null; }
  setStatus('off', 'Disconnected');
  updateSessionUI();
  addMsg('user', '— session khatam —');
}
function stopSessionQuiet() {
  stopMicQuiet();
  if (session) { try { session.close(); } catch (e) {} session = null; }
}

function wireSession() {
  $('btn-session').addEventListener('click', () => {
    if (session && session.ready) stopSession();
    else startSession();
  });
  $('btn-mic').addEventListener('click', toggleMic);
}

/* ---------------- mic toggle + visualizer ---------------- */
function setMicRecording(on) {
  recording = on;
  $('btn-mic').classList.toggle('recording', on);
  $('btn-mic').textContent = on ? '⏹' : '🎤';
  if (on) startVisualizer(); else stopVisualizer();
}

async function toggleMic() {
  if (!session || !session.ready) { toast('Pehle session start karein'); return; }
  if (recording) { stopMicQuiet(); setMicRecording(false); $('mic-hint').textContent = 'Mic band — dobara 🎤 dabayein'; return; }
  try {
    const analyserBox = {};
    micHandle = await startMicCapture(
      (b64) => { if (session && session.ready) session.sendAudioChunk(b64); },
      analyserBox
    );
    window._vizAnalyser = analyserBox.node;
    setMicRecording(true);
    $('mic-hint').textContent = '🔴 Recording… bolein, tutor sun raha hai';
    addMsg('user', '🎤 (awaz bheji ja rahi hai…)');
  } catch (e) {
    console.error('Mic failed:', e);
    if (e && e.name === 'NotAllowedError') toast('Mic ki ijazat nahi mili — browser settings me allow karein.');
    else if (e && e.name === 'NotFoundError') toast('Koi mic nahi mila — device check karein.');
    else toast('Mic on nahi ho saka — dobara koshish karein.');
  }
}
function stopMicQuiet() {
  if (micHandle) { try { micHandle.stop(); } catch (e) {} micHandle = null; }
  window._vizAnalyser = null;
  if (recording) setMicRecording(false);
}

function startVisualizer() {
  const cv = $('visualizer');
  const ctx2d = cv.getContext('2d');
  const draw = () => {
    vizRAF = requestAnimationFrame(draw);
    const W = cv.width, H = cv.height;
    ctx2d.clearRect(0, 0, W, H);
    const an = window._vizAnalyser;
    const bars = 32;
    const bw = W / bars;
    let data = null;
    if (an) {
      data = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(data);
    }
    const dark = document.documentElement.getAttribute('data-theme') !== 'light';
    for (let i = 0; i < bars; i++) {
      const v = data ? data[Math.floor(i * data.length / bars)] / 255 : 0.04;
      const h = Math.max(3, v * H);
      ctx2d.fillStyle = recording ? '#f31260' : (dark ? '#3a4358' : '#c9d2e0');
      const x = i * bw + 1;
      ctx2d.fillRect(x, (H - h) / 2, bw - 2, h);
    }
  };
  draw();
}
function stopVisualizer() {
  if (vizRAF) cancelAnimationFrame(vizRAF);
  vizRAF = null;
  // flat line dikhao
  const cv = $('visualizer');
  const ctx2d = cv.getContext('2d');
  ctx2d.clearRect(0, 0, cv.width, cv.height);
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

// model ka streaming text — musalsal chunks ek hi bubble me jurein
function handleModelText(chunk) {
  if (!currentAiDiv) currentAiDiv = addMsg('ai', '');
  const body = currentAiDiv.querySelector('span:last-child');
  body.textContent += chunk;
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  if (collectingQuiz) quizBuffer += chunk;
  renderDiagrams(false);
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

function finishQuiz() {
  collectingQuiz = false;
  renderQuiz(parseQuiz(quizBuffer));
  quizBuffer = '';
  // quiz tab par le jao taake user dekhe
  switchTab('quiz');
  toast('Quiz tayyar hai! 📝', true);
}

function wireQuiz() {
  $('btn-quiz').addEventListener('click', () => {
    if (!session || !session.ready) { toast('Pehle "Session start" dabayein'); return; }
    collectingQuiz = true;
    quizBuffer = '';
    quizWrap.innerHTML = '<p class="muted">⏳ Quiz ban raha hai…</p>';
    session.sendText(QUIZ_PROMPT);
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
  // Nayi file = mukammal reset: session, transcript, quiz, diagram sab saaf
  stopSessionQuiet();
  setStatus('off', 'Disconnected');
  updateSessionUI();
  transcriptEl.innerHTML = '<p class="muted placeholder">Abhi koi guftagu nahi — session start karke bolein 🎙</p>';
  diagramWrap.innerHTML = '<p class="muted placeholder">Diagram yahan nazar ayega — tutor se kahein "is ka diagram banao"</p>';
  quizWrap.innerHTML = '';
  currentAiDiv = null;
  collectingQuiz = false; quizBuffer = '';
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
    else toast('Tayyar! Session start karke parhna shuru karein 📖', true);
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
  wireSession();
  wireDocument();
  wireTabs();
  wireQuiz();
  initFirebase();
  goLogin();
  updateSessionUI();
});
