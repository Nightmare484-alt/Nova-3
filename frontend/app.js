/* NOVA frontend */

const state = {
  contents: [],
  attachments: [],
  busy: false,
  settings: loadSettings()
};

const $ = (s) => document.querySelector(s);
const els = {
  coreWrap: $('#core-wrap'),
  coreStateLabel: $('#core-state-label'),
  coreSub: $('#core-sub-label'),
  chatScroll: $('#chat-scroll'),
  form: $('#command-form'),
  prompt: $('#prompt'),
  btnSend: $('#btn-send'),
  btnMic: $('#btn-mic'),
  btnCamera: $('#btn-camera'),
  btnAttach: $('#btn-attach'),
  fileInput: $('#file-input'),
  attachments: $('#attachments'),
  toasts: $('#toasts'),
  modelLabel: $('#set-model-name'),
  cameraModal: $('#camera-modal'),
  cameraVideo: $('#camera-video'),
  btnCamSwitch: $('#btn-cam-switch'),
  btnCamCapture: $('#btn-cam-capture'),
  settingsModal: $('#settings-modal'),
  setVoice: $('#set-voice'),
  setAutospeak: $('#set-autospeak'),
  setMemory: $('#set-memory'),
  btnClearAll: $('#btn-clear-all'),
  confirmModal: $('#confirm-modal'),
  confirmText: $('#confirm-text'),
  confirmDetails: $('#confirm-details'),
  btnConfirmOk: $('#btn-confirm-ok'),
  btnConfirmCancel: $('#btn-confirm-cancel')
};

/* ─── Markdown ─── */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function renderMarkdown(src) {
  if (!src) return '';
  let text = String(src).replace(/\r\n/g, '\n');
  const blocks = [];
  text = text.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push({ lang: lang || '', code });
    return `\u0000B${blocks.length - 1}\u0000`;
  });
  const lines = text.split('\n');
  const html = [];
  let i = 0;
  const inline = (t) => {
    let out = t;
    const codes = [];
    out = out.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000C${codes.length - 1}\u0000`; });
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, l, u) =>
      `<a href="${escapeHtml(/^(https?:|mailto:|tel:|\/|#)/i.test(u) ? u : '#')}" target="_blank" rel="noopener noreferrer">${l}</a>`);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    out = out.replace(/\u0000C(\d+)\u0000/g, (_, n) => `<code>${escapeHtml(codes[+n])}</code>`);
    return out;
  };
  while (i < lines.length) {
    const line = lines[i];
    const bm = line.match(/^\u0000B(\d+)\u0000$/);
    if (bm) {
      const b = blocks[+bm[1]];
      html.push(`<pre><code class="${b.lang ? 'language-'+escapeHtml(b.lang) : ''}">${escapeHtml(b.code.replace(/\n$/, ''))}</code></pre>`);
      i++; continue;
    }
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { html.push(`<h${Math.min(h[1].length,6)}>${inline(escapeHtml(h[2]))}</h${Math.min(h[1].length,6)}>`); i++; continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { html.push('<hr/>'); i++; continue; }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++; }
      html.push(`<ul>${items.map((t) => `<li>${inline(escapeHtml(t))}</li>`).join('')}</ul>`); continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
      html.push(`<ol>${items.map((t) => `<li>${inline(escapeHtml(t))}</li>`).join('')}</ol>`); continue;
    }
    const para = [line]; i++;
    while (i < lines.length && lines[i].trim() &&
      !/^(#{1,6}\s|\s*[-*+]\s|\s*\d+\.\s|\s*>|\s*```)/.test(lines[i]) &&
      !/^\u0000B\d+\u0000$/.test(lines[i])) { para.push(lines[i]); i++; }
    html.push(`<p>${inline(escapeHtml(para.join('\n'))).replace(/\n/g, '<br/>')}</p>`);
  }
  return html.join('');
}

/* ─── Voice ─── */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;
let speaking = false;
const synth = window.speechSynthesis;
let selectedVoice = null;

function initVoice() {
  if (SR) {
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    recognition.onstart = () => {
      listening = true;
      els.btnMic.classList.add('listening');
      setCoreState('listening', 'Listening', 'Speak now…');
    };
    recognition.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) els.prompt.value = interim;
      if (final) {
        els.prompt.value = final;
        recognition.stop();
        setTimeout(() => {
          const t = els.prompt.value.trim();
          if (t) { els.prompt.value = ''; sendMessage(t); }
        }, 120);
      }
    };
    recognition.onerror = (e) => {
      listening = false;
      els.btnMic.classList.remove('listening');
      const msg = e.error === 'not-allowed' ? 'Microphone access denied.'
        : e.error === 'no-speech' ? "I didn't catch that. Try again?"
        : 'Voice input failed.';
      toast(msg, 'err');
      if (els.coreWrap.dataset.state === 'listening') setCoreState('idle', 'Online', 'Ready when you are.');
    };
    recognition.onend = () => {
      listening = false;
      els.btnMic.classList.remove('listening');
      if (els.coreWrap.dataset.state === 'listening') setCoreState('idle', 'Online', 'Ready when you are.');
    };
  }
  if (synth) {
    const load = () => {
      const vs = synth.getVoices() || [];
      if (vs.length && !selectedVoice) {
        selectedVoice = vs.find((v) => /google (uk|us) english/i.test(v.name))
          || vs.find((v) => v.lang?.startsWith('en')) || vs[0];
      }
    };
    load();
    synth.onvoiceschanged = load;
  }
}

function speak(text) {
  if (!synth || !text) return;
  try { synth.cancel(); } catch {}
  const clean = String(text)
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_#>]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ').trim().slice(0, 4000);
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  if (selectedVoice) u.voice = selectedVoice;
  u.rate = 1.02; u.pitch = 1.0; u.volume = 1.0;
  u.onstart = () => { speaking = true; els.btnMic.classList.add('speaking'); setCoreState('speaking', 'Speaking', ''); };
  u.onend = () => { speaking = false; els.btnMic.classList.remove('speaking'); setCoreState('idle', 'Online', 'Ready when you are.'); };
  u.onerror = u.onend;
  synth.speak(u);
}

/* ─── Camera ─── */
let cameraStream = null;
let facingMode = 'environment';

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera not supported.');
  stopCamera();
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    return cameraStream;
  } catch (err) {
    if (err.name === 'NotAllowedError') throw new Error('Camera access denied. Allow it in browser settings.');
    if (err.name === 'NotFoundError') throw new Error('No camera found.');
    throw new Error(err.message || 'Camera unavailable.');
  }
}
function stopCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach((t) => t.stop()); cameraStream = null; }
}
async function flipCamera() {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  return startCamera();
}
function captureFromVideo(video, maxWidth = 1280) {
  if (!video?.videoWidth) throw new Error('Camera not ready.');
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(video, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.9);
}
async function readFile(file) {
  if (file.size > 15 * 1024 * 1024) throw new Error(`"${file.name}" is too large (max 15 MB).`);
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = () => rej(new Error(`Could not read ${file.name}.`));
    r.readAsDataURL(file);
  });
  const [meta, base64] = dataUrl.split(',');
  const mimeType = (meta.match(/data:(.*?);/) || [])[1] || file.type || 'application/octet-stream';
  return { name: file.name, size: file.size, mimeType, base64, dataUrl };
}

/* ─── Tools ─── */
const SEARCH_ENGINES = {
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  bing: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  duckduckgo: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  youtube: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`
};
const KNOWN_URLS = {
  youtube: 'https://www.youtube.com', google: 'https://www.google.com',
  gmail: 'https://mail.google.com', mail: 'https://mail.google.com',
  maps: 'https://maps.google.com', github: 'https://github.com',
  twitter: 'https://twitter.com', x: 'https://x.com',
  facebook: 'https://www.facebook.com', instagram: 'https://www.instagram.com',
  whatsapp: 'https://web.whatsapp.com', reddit: 'https://www.reddit.com',
  linkedin: 'https://www.linkedin.com', wikipedia: 'https://www.wikipedia.org',
  spotify: 'https://open.spotify.com', amazon: 'https://www.amazon.com'
};
const APP_LINKS = {
  youtube: { scheme: 'vnd.youtube://', web: 'https://www.youtube.com' },
  whatsapp: { scheme: 'whatsapp://send', web: 'https://web.whatsapp.com' },
  instagram: { scheme: 'instagram://app', web: 'https://www.instagram.com' },
  twitter: { scheme: 'twitter://timeline', web: 'https://x.com' },
  x: { scheme: 'twitter://timeline', web: 'https://x.com' },
  facebook: { scheme: 'fb://feed', web: 'https://www.facebook.com' },
  maps: { scheme: 'geo:0,0?q=', web: 'https://maps.google.com' },
  gmail: { scheme: 'googlegmail://', web: 'https://mail.google.com' },
  mail: { scheme: 'mailto:', web: 'https://mail.google.com' },
  chrome: { scheme: 'googlechrome://', web: 'https://www.google.com' },
  spotify: { scheme: 'spotify://', web: 'https://open.spotify.com' },
  telegram: { scheme: 'tg://resolve', web: 'https://web.telegram.org' }
};
function resolveUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const key = raw.toLowerCase().replace(/^www\./, '').replace(/\.(com|org|net|io).*$/, '');
  if (KNOWN_URLS[key]) return KNOWN_URLS[key];
  if (/^[\w-]+(\.[\w-]+)+/.test(raw)) return `https://${raw}`;
  return null;
}
function openInNewTab(url) {
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  document.body.appendChild(a); a.click(); a.remove();
}
function isMobile() { return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent); }
function tryDeepLink(scheme, webUrl) {
  if (!isMobile()) return Promise.resolve({ opened: 'web', url: webUrl });
  return new Promise((resolve) => {
    let hidden = false;
    const onVis = () => { if (document.hidden) hidden = true; };
    document.addEventListener('visibilitychange', onVis);
    const start = Date.now();
    try { window.location.href = scheme; } catch {}
    setTimeout(() => {
      document.removeEventListener('visibilitychange', onVis);
      const elapsed = Date.now() - start;
      if (hidden || elapsed > 1400) resolve({ opened: 'app' });
      else if (webUrl) { window.location.href = webUrl; resolve({ opened: 'web', url: webUrl }); }
      else resolve({ opened: 'failed' });
    }, 1200);
  });
}
function humanToolName(n) { return String(n || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

async function runTool(call) {
  const { name, args = {}, danger } = call || {};
  try {
    if (danger) {
      const ok = await askConfirm(`NOVA wants to run "${humanToolName(name)}". Proceed?`, JSON.stringify(args, null, 2));
      if (!ok) return { ok: false, summary: `Cancelled: ${humanToolName(name)}` };
    }
    switch (name) {
      case 'open_url': {
        const url = resolveUrl(args.url);
        if (!url) return { ok: false, summary: `I don't have a link for "${args.url}".` };
        openInNewTab(url);
        return { ok: true, summary: `Opened ${args.label || url}`, detail: url };
      }
      case 'search_web': {
        const fn = SEARCH_ENGINES[args.engine || 'google'] || SEARCH_ENGINES.google;
        const url = fn(args.query);
        openInNewTab(url);
        return { ok: true, summary: `Searched ${args.engine || 'google'} for "${args.query}"`, detail: url };
      }
      case 'open_app': {
        const key = String(args.app || '').toLowerCase().trim();
        const entry = APP_LINKS[key];
        if (!entry) {
          const web = KNOWN_URLS[key];
          if (web) { openInNewTab(web); return { ok: true, summary: `Opened ${key} in browser`, detail: web }; }
          return { ok: false, summary: `I don't have a route to "${args.app}".` };
        }
        const scheme = args.query ? `${entry.scheme}${encodeURIComponent(args.query)}` : entry.scheme;
        const r = await tryDeepLink(scheme, entry.web);
        if (r.opened === 'app') return { ok: true, summary: `Opened ${key} app` };
        return { ok: true, summary: `Opened ${key} in browser`, detail: r.url || entry.web };
      }
      case 'compose_email': {
        const url = `mailto:${encodeURIComponent(args.to || '')}?subject=${encodeURIComponent(args.subject || '')}&body=${encodeURIComponent(args.body || '')}`;
        window.location.href = url;
        return { ok: true, summary: `Draft opened for ${args.to}` };
      }
      case 'open_map': {
        const web = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(args.query)}`;
        const scheme = `geo:0,0?q=${encodeURIComponent(args.query)}`;
        const r = await tryDeepLink(scheme, web);
        return { ok: true, summary: `Opened Maps at "${args.query}"`, detail: r.opened === 'app' ? undefined : web };
      }
      default: return { ok: false, summary: `Unknown client tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, summary: `${humanToolName(name)} failed`, detail: String(err?.message || err) };
  }
}

/* ─── UI ─── */
function setCoreState(name, label, sub) {
  els.coreWrap.dataset.state = name;
  els.coreStateLabel.textContent = (label || name).toUpperCase();
  if (sub !== undefined) els.coreSub.textContent = sub;
}
function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`.trim();
  el.textContent = message;
  els.toasts.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 320);
  }, 3400);
}

let _confirmResolver = null;
function askConfirm(message, details) {
  els.confirmText.textContent = message || 'Proceed?';
  if (details) { els.confirmDetails.textContent = details; els.confirmDetails.hidden = false; }
  else els.confirmDetails.hidden = true;
  els.confirmModal.hidden = false;
  return new Promise((res) => { _confirmResolver = res; });
}
function closeConfirm(answer) {
  els.confirmModal.hidden = true;
  if (_confirmResolver) { _confirmResolver(answer); _confirmResolver = null; }
}
els.btnConfirmOk.addEventListener('click', () => closeConfirm(true));
els.btnConfirmCancel.addEventListener('click', () => closeConfirm(false));

/* ─── Chat render ─── */
function appendWelcome() {
  if (els.chatScroll.children.length) return;
  const w = document.createElement('div');
  w.className = 'welcome';
  w.innerHTML = `<h1>NOVA</h1><p>Your private AI companion. Ask, speak, or share what you see.</p><p class="hint">Try: "Nova, open YouTube." · "Nova, what can you do?"</p>`;
  els.chatScroll.appendChild(w);
}
function clearWelcome() { const w = els.chatScroll.querySelector('.welcome'); if (w) w.remove(); }

function addMessage(role, text, { html } = {}) {
  clearWelcome();
  const msg = document.createElement('div');
  msg.className = `msg ${role}`;
  msg.innerHTML = `<div class="msg-avatar">${role === 'user' ? 'YOU' : 'NV'}</div>
    <div class="msg-body"><div class="msg-name">${role === 'user' ? 'You' : 'NOVA'}</div><div class="bubble"></div></div>`;
  const b = msg.querySelector('.bubble');
  b.innerHTML = html || renderMarkdown(text || '');
  els.chatScroll.appendChild(msg);
  scrollChat();
  return msg;
}
function addTyping() {
  clearWelcome();
  const msg = document.createElement('div');
  msg.className = 'msg nova';
  msg.innerHTML = `<div class="msg-avatar">NV</div>
    <div class="msg-body"><div class="msg-name">Nova</div>
    <div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>`;
  els.chatScroll.appendChild(msg);
  scrollChat();
  return msg;
}
function addToolCard(name) {
  const msg = document.createElement('div');
  msg.className = 'msg nova';
  msg.innerHTML = `<div class="msg-avatar">NV</div>
    <div class="msg-body"><div class="msg-name">Nova · action</div>
    <div class="tool-card"><div class="tc-head"><span class="spinner"></span><span>${escapeHtml(humanToolName(name))}</span></div><div class="tc-detail">Working…</div></div></div>`;
  els.chatScroll.appendChild(msg);
  scrollChat();
  return msg;
}
function finishToolCard(msg, ok, summary, detail) {
  const card = msg.querySelector('.tool-card');
  card.classList.add(ok ? 'done' : 'err');
  card.querySelector('.tc-head').innerHTML = `<span>${ok ? '✓' : '✕'}</span><span>${escapeHtml(summary)}</span>`;
  const d = card.querySelector('.tc-detail');
  if (detail) d.textContent = detail;
  else d.remove();
}
function scrollChat() { requestAnimationFrame(() => { els.chatScroll.scrollTop = els.chatScroll.scrollHeight; }); }

/* ─── Settings ─── */
function loadSettings() {
  try { return { voice: true, autospeak: true, memory: true, ...JSON.parse(localStorage.getItem('nova.settings') || '{}') }; }
  catch { return { voice: true, autospeak: true, memory: true }; }
}
function saveSettings() { try { localStorage.setItem('nova.settings', JSON.stringify(state.settings)); } catch {} }
function applySettings() {
  els.setVoice.checked = state.settings.voice;
  els.setAutospeak.checked = state.settings.autospeak;
  els.setMemory.checked = state.settings.memory;
}
function persist() { if (state.settings.memory) try { localStorage.setItem('nova.contents', JSON.stringify(state.contents)); } catch {} }
function restore() {
  if (!state.settings.memory) return;
  try { const raw = localStorage.getItem('nova.contents'); if (raw) state.contents = JSON.parse(raw); } catch { state.contents = []; }
}

/* ─── Attachments ─── */
function clearAttachments() { state.attachments = []; els.attachments.hidden = true; els.attachments.innerHTML = ''; }
async function addAttachment(file) {
  try {
    const info = await readFile(file);
    const isImage = info.mimeType.startsWith('image/');
    const isText = /^text\/|json|javascript|xml|csv|markdown/.test(info.mimeType) || /\.(txt|md|json|js|ts|py|html|css|csv|log)$/i.test(info.name);
    const item = { name: info.name, size: info.size, mimeType: info.mimeType, base64: info.base64, dataUrl: isImage ? info.dataUrl : '', kind: isImage ? 'image' : (isText ? 'text' : 'file') };
    if (isText) { try { item.text = atob(info.base64).slice(0, 20000); } catch { item.text = ''; } }
    state.attachments.push(item);
    renderAttachments();
  } catch (err) { toast(err.message, 'err'); }
}
function renderAttachments() {
  if (!state.attachments.length) { els.attachments.hidden = true; els.attachments.innerHTML = ''; return; }
  els.attachments.hidden = false;
  els.attachments.innerHTML = '';
  state.attachments.forEach((a, i) => {
    const chip = document.createElement('div');
    chip.className = 'attach-chip';
    chip.innerHTML = `${a.kind === 'image' ? `<img src="${a.dataUrl}" alt="" />` : '📎'}<span class="nm">${escapeHtml(a.name)}</span><button title="Remove">×</button>`;
    chip.querySelector('button').addEventListener('click', () => { state.attachments.splice(i, 1); renderAttachments(); });
    els.attachments.appendChild(chip);
  });
}

/* ─── Chat flow ─── */
async function sendMessage(text, extraParts = []) {
  if (state.busy) return;
  const userText = (text ?? '').trim();
  if (!userText && !state.attachments.length && !extraParts.length) return;

  state.busy = true;
  els.btnSend.disabled = true;
  setCoreState('thinking', 'Thinking', 'Working on it…');

  const parts = [];
  if (userText) parts.push({ text: userText });
  for (const p of extraParts) parts.push(p);
  for (const a of state.attachments) {
    if (a.kind === 'image') parts.push({ inlineData: { mimeType: a.mimeType, data: a.base64 } });
    else if (a.kind === 'text') parts.push({ text: `File "${a.name}":\n\n${a.text}` });
    else parts.push({ text: `[Attached file: ${a.name} (${a.mimeType}, ${a.size} bytes)]` });
  }

  if (userText || state.attachments.length) {
    let displayHtml = '';
    if (userText) displayHtml += renderMarkdown(userText);
    for (const a of state.attachments) {
      if (a.kind === 'image') displayHtml += `<img src="${a.dataUrl}" alt="" />`;
      else displayHtml += `<p><em>📎 ${escapeHtml(a.name)}</em></p>`;
    }
    addMessage('user', '', { html: displayHtml });
  }

  state.contents.push({ role: 'user', parts });
  clearAttachments();
  const typing = addTyping();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: state.contents })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed.');

    state.contents = data.contents || state.contents;

    if (data.pendingClientCalls?.length) {
      typing.remove();
      if (data.text) addMessage('nova', data.text);
      for (const call of data.pendingClientCalls) {
        const card = addToolCard(call.name);
        setCoreState('executing', 'Executing', humanToolName(call.name) + '…');
        const result = await runTool(call);
        finishToolCard(card, result.ok, result.summary || humanToolName(call.name), result.detail);
        state.contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: call.name,
              response: result.ok
                ? { ok: true, summary: result.summary, detail: result.detail || null }
                : { ok: false, error: result.summary || 'failed' }
            }
          }]
        });
      }
      const typing2 = addTyping();
      const res2 = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: state.contents })
      });
      const data2 = await res2.json().catch(() => ({}));
      if (!res2.ok) throw new Error(data2.error || 'Follow-up failed.');
      state.contents = data2.contents || state.contents;
      typing2.remove();
      const finalText = data2.text || 'Done.';
      addMessage('nova', finalText);
      if (state.settings.voice && state.settings.autospeak) speak(finalText);
    } else {
      typing.remove();
      const replyText = data.text || 'Done.';
      addMessage('nova', replyText);
      if (state.settings.voice && state.settings.autospeak) speak(replyText);
    }

    persist();
    setCoreState('idle', 'Online', 'Ready when you are.');
  } catch (err) {
    typing.remove();
    addMessage('nova', `⚠️ ${err.message || "I couldn't complete that."}`);
    setCoreState('error', 'Error', err.message || 'Something went wrong.');
    toast(err.message || 'Request failed.', 'err');
    setTimeout(() => setCoreState('idle', 'Online', 'Ready when you are.'), 3200);
  } finally {
    state.busy = false;
    els.btnSend.disabled = false;
    els.prompt.focus();
  }
}

/* ─── Events ─── */
els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const t = els.prompt.value.trim();
  if (!t && !state.attachments.length) return;
  els.prompt.value = '';
  sendMessage(t);
});

els.btnMic.addEventListener('click', () => {
  if (speaking) { try { synth.cancel(); } catch {} return; }
  if (!SR) { toast('Voice input needs Chrome or Edge.', 'err'); return; }
  if (listening) recognition.stop();
  else { try { recognition.start(); } catch {} }
});

els.btnCamera.addEventListener('click', async () => {
  els.cameraModal.hidden = false;
  try {
    const stream = await startCamera();
    els.cameraVideo.srcObject = stream;
  } catch (err) { toast(err.message, 'err'); els.cameraModal.hidden = true; }
});
els.btnCamSwitch.addEventListener('click', async () => {
  try { const s = await flipCamera(); els.cameraVideo.srcObject = s; } catch (err) { toast(err.message, 'err'); }
});
els.btnCamCapture.addEventListener('click', () => {
  try {
    const dataUrl = captureFromVideo(els.cameraVideo);
    const [meta, base64] = dataUrl.split(',');
    const mimeType = (meta.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
    stopCamera();
    els.cameraModal.hidden = true;
    sendMessage('Nova, look at this.', [{ inlineData: { mimeType, data: base64 } }]);
  } catch (err) { toast(err.message, 'err'); }
});

els.btnAttach.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  for (const f of files) await addAttachment(f);
});

document.querySelectorAll('[data-close]').forEach((b) => {
  b.addEventListener('click', () => {
    const m = b.closest('.modal');
    if (m?.id === 'camera-modal') { stopCamera(); m.hidden = true; }
    else if (m) m.hidden = true;
  });
});

$('#btn-new-chat').addEventListener('click', () => {
  state.contents = []; state.attachments = [];
  els.chatScroll.innerHTML = '';
  persist(); appendWelcome();
  toast('New chat started.', 'ok');
});

$('#btn-settings').addEventListener('click', () => { els.settingsModal.hidden = false; });

els.setVoice.addEventListener('change', () => { state.settings.voice = els.setVoice.checked; saveSettings(); });
els.setAutospeak.addEventListener('change', () => { state.settings.autospeak = els.setAutospeak.checked; saveSettings(); });
els.setMemory.addEventListener('change', () => {
  state.settings.memory = els.setMemory.checked; saveSettings();
  if (!state.settings.memory) localStorage.removeItem('nova.contents');
});
els.btnClearAll.addEventListener('click', async () => {
  const ok = await askConfirm('Clear all NOVA data on this device?');
  if (!ok) return;
  localStorage.removeItem('nova.contents'); localStorage.removeItem('nova.settings');
  state.contents = []; state.settings = { voice: true, autospeak: true, memory: true };
  applySettings(); els.chatScroll.innerHTML = ''; appendWelcome();
  els.settingsModal.hidden = true;
  toast('All data cleared.', 'ok');
});

/* ─── Health ─── */
async function checkHealth() {
  try {
    const r = await fetch('/api/health');
    const d = await r.json();
    if (d.apiKeyConfigured && d.model) {
      if (els.modelLabel) els.modelLabel.textContent = d.model;
    } else {
      if (els.modelLabel) els.modelLabel.textContent = 'Not configured';
      toast('NOVA is not configured yet. Add env vars on Render.', 'err');
    }
  } catch {
    toast('Cannot reach NOVA backend.', 'err');
  }
}

/* ─── Init ─── */
applySettings();
restore();
appendWelcome();
initVoice();
checkHealth();

if (!localStorage.getItem('nova.greeted')) {
  localStorage.setItem('nova.greeted', '1');
  setTimeout(() => addMessage('nova', "Hey! I'm **NOVA**. Ask me anything, tap the mic, or attach a photo."), 400);
}
