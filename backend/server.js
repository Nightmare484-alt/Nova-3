// NOVA Backend — everything in one file

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ─────────────── PERSONALITY ─────────────── */
const SYSTEM_PROMPT = `You are NOVA (Neural Operations Virtual Assistant) — a private, futuristic AI companion and agent.
PERSONALITY: Friendly, warm, calm, confident, slightly futuristic, human-like. Concise for simple tasks.
NEVER say "I have received your message" or "As an AI language model".
Refer to yourself as NOVA when relevant.
BEHAVIOUR:
- Process the request. Do not restate it.
- When the user asks to open a site/app or search, USE THE PROVIDED TOOLS.
- When images/files are attached, analyse them and describe what matters.
- Never claim an action succeeded if a tool errored. Report honestly.
- If a capability is unavailable, say so plainly and offer the closest option.
- For risky actions (emails, purchases), ask for confirmation first.
FORMAT: Markdown supported. Keep replies scannable.
Do not expose internal reasoning. Only concise action summaries.
Your name is NOVA.`.trim();

/* ─────────────── TOOLS ─────────────── */
function calculator(input) {
  let expr = String(input ?? '').toLowerCase().trim();
  if (!expr) throw new Error('Empty expression.');
  expr = expr.replace(/\bof\b/g, '*').replace(/\bpercent\b/g, '%');
  expr = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/\bx\b/g, '*');
  expr = expr.replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)');
  expr = expr.replace(/\^/g, '**').replace(/[^0-9+\-*/().\s]/g, '');
  // eslint-disable-next-line no-new-func
  const value = Function(`"use strict"; return (${expr});`)();
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Not a finite number.');
  return value;
}

const WMO = { 0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',51:'Light drizzle',53:'Moderate drizzle',55:'Dense drizzle',61:'Slight rain',63:'Moderate rain',65:'Heavy rain',71:'Slight snow',73:'Moderate snow',75:'Heavy snow',80:'Rain showers',81:'Moderate showers',82:'Violent showers',95:'Thunderstorm',96:'Thunderstorm + hail',99:'Thunderstorm + heavy hail' };

async function getWeather(city) {
  if (!city) throw new Error('City required.');
  const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
  if (!geoRes.ok) throw new Error('Geocoding unavailable.');
  const geo = await geoRes.json();
  const place = geo?.results?.[0];
  if (!place) throw new Error(`Could not find "${city}".`);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather unavailable.');
  const data = await res.json();
  const c = data.current;
  return { location: [place.name, place.country].filter(Boolean).join(', '), temperature_c: c.temperature_2m, feels_like_c: c.apparent_temperature, humidity_pct: c.relative_humidity_2m, wind_kmh: c.wind_speed_10m, condition: WMO[c.weather_code] || `Code ${c.weather_code}`, observed_at: c.time };
}

async function getTime(timezone) {
  const tz = timezone || 'UTC';
  const now = new Date();
  let local;
  try {
    local = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(now);
  } catch { throw new Error(`Unknown timezone "${tz}".`); }
  return { timezone: tz, local_time: local, iso_utc: now.toISOString(), unix: Math.floor(now.getTime()/1000) };
}

const tools = {
  calculator: { declaration: { name:'calculator', description:'Evaluate a math expression. Example: "25% of 8500".', parameters:{ type:'object', properties:{ expression:{type:'string'} }, required:['expression'] } }, handler: async ({ expression }) => ({ result: calculator(expression) }) },
  get_weather: { declaration: { name:'get_weather', description:'Get current weather for a city.', parameters:{ type:'object', properties:{ city:{type:'string'} }, required:['city'] } }, handler: async ({ city }) => getWeather(city) },
  get_time: { declaration: { name:'get_time', description:'Current date/time. Optional IANA timezone.', parameters:{ type:'object', properties:{ timezone:{type:'string'} } } }, handler: async ({ timezone }) => getTime(timezone) },
  open_url: { client:true, declaration:{ name:'open_url', description:'Open a website in a new tab.', parameters:{ type:'object', properties:{ url:{type:'string'}, label:{type:'string'} }, required:['url'] } } },
  search_web: { client:true, declaration:{ name:'search_web', description:'Run a web search.', parameters:{ type:'object', properties:{ query:{type:'string'}, engine:{type:'string', enum:['google','bing','duckduckgo','youtube']} }, required:['query'] } } },
  open_app: { client:true, declaration:{ name:'open_app', description:'Open a mobile app via deep link (youtube, whatsapp, maps, gmail, instagram, chrome, spotify).', parameters:{ type:'object', properties:{ app:{type:'string'}, query:{type:'string'} }, required:['app'] } } },
  compose_email: { client:true, danger:true, declaration:{ name:'compose_email', description:'Open mail client with a draft. Requires confirmation.', parameters:{ type:'object', properties:{ to:{type:'string'}, subject:{type:'string'}, body:{type:'string'} }, required:['to','subject','body'] } } },
  open_map: { client:true, declaration:{ name:'open_map', description:'Open a location in Google Maps.', parameters:{ type:'object', properties:{ query:{type:'string'} }, required:['query'] } } }
};

function toolDeclarations() { return Object.values(tools).map(t => t.declaration); }

/* ─────────────── GEMINI ─────────────── */
let _client = null;
function client() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error('NOVA is not configured. Add GEMINI_API_KEY in Render env vars.'), { status:503, publicMessage:'NOVA is not configured.' });
  if (!_client) _client = new GoogleGenerativeAI(key);
  return _client;
}
function modelId() {
  const id = process.env.GEMINI_MODEL;
  if (!id) throw Object.assign(new Error('NOVA is not configured. Set GEMINI_MODEL in Render env vars.'), { status:503, publicMessage:'NOVA is not configured.' });
  return id;
}
function buildModel() {
  return client().getGenerativeModel({ model: modelId(), systemInstruction: SYSTEM_PROMPT, tools: [{ functionDeclarations: toolDeclarations() }], generationConfig:{ temperature:0.85, topP:0.95, maxOutputTokens:2048 } });
}

async function runChat(contents) {
  const model = buildModel();
  const working = JSON.parse(JSON.stringify(contents));
  const pendingClientCalls = [];
  let lastText = '';
  for (let step = 0; step < 6; step++) {
    let result;
    try { result = await model.generateContent({ contents: working }); }
    catch (err) { throw normaliseGeminiError(err); }
    const response = result.response;
    let calls = [], text = '';
    try { calls = response.functionCalls?.() || []; } catch {}
    try { text = response.text?.() || ''; } catch {}
    if (text) lastText = text;
    if (!calls.length) return { contents: working, text: text || lastText || 'Done.', pendingClientCalls: [] };
    working.push({ role:'model', parts: calls.map(c => ({ functionCall:{ name:c.name, args:c.args||{} } })) });
    const serverResponses = [];
    let hasPending = false;
    for (const call of calls) {
      const tool = tools[call.name];
      if (!tool) { serverResponses.push({ functionResponse:{ name:call.name, response:{ error:'Unknown tool.' } } }); continue; }
      if (tool.client) { pendingClientCalls.push({ name:call.name, args:call.args||{}, danger:!!tool.danger }); hasPending = true; continue; }
      try { const out = await tool.handler(call.args||{}); serverResponses.push({ functionResponse:{ name:call.name, response:out??{ok:true} } }); }
      catch (err) { serverResponses.push({ functionResponse:{ name:call.name, response:{ error:String(err?.message||err) } } }); }
    }
    if (serverResponses.length) working.push({ role:'user', parts: serverResponses });
    if (hasPending) return { contents: working, text, pendingClientCalls };
  }
  return { contents: working, text:'I looped on that. Could you rephrase?', pendingClientCalls: [] };
}

async function analyseMedia({ base64, mimeType, prompt }) {
  const model = buildModel();
  try {
    const result = await model.generateContent({ contents:[{ role:'user', parts:[{ text: prompt || 'Describe what you see.' }, { inlineData:{ mimeType, data: base64 } }] }] });
    let t = ''; try { t = result.response.text?.() || ''; } catch {}
    return t || 'I looked, but could not extract anything useful.';
  } catch (err) { throw normaliseGeminiError(err); }
}

function normaliseGeminiError(err) {
  const raw = String(err?.message || err); const low = raw.toLowerCase();
  const mk = (s, m, c) => { const e = new Error(m); e.status=s; e.publicMessage=m; e.code=c; return e; };
  if (low.includes('api key') || low.includes('401') || low.includes('403')) return mk(401, 'AI core rejected the API key. Check GEMINI_API_KEY.', 'bad_api_key');
  if (low.includes('not found') || low.includes('404')) return mk(400, `Model "${process.env.GEMINI_MODEL||'?'}" not found. Set GEMINI_MODEL.`, 'bad_model');
  if (low.includes('quota') || low.includes('429')) return mk(429, 'Being rate-limited. Try again in a moment.', 'rate_limited');
  return mk(502, "I couldn't reach my AI core.", 'upstream_error');
}

/* ─────────────── SERVER ─────────────── */
const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit:'30mb' }));
app.use(express.urlencoded({ extended: true, limit:'30mb' }));
app.use('/api', rateLimit({ windowMs:60_000, limit:60, standardHeaders:'draft-7', legacyHeaders:false, message:{ error:'Too many requests.' } }));

const upload = multer({ storage: multer.memoryStorage(), limits:{ fileSize: 20*1024*1024 } });

app.use(express.static(path.join(__dirname, '..', 'frontend'), { extensions:['html'] }));

app.get('/api/health', (_req, res) => {
  res.json({ ok:true, service:'nova', model: process.env.GEMINI_MODEL||null, apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY), time: new Date().toISOString() });
});

app.post('/api/chat', async (req, res, next) => {
  try { const { contents } = req.body || {}; const out = await runChat(contents); res.json(out); }
  catch (err) { next(err); }
});

app.post('/api/analyze-image', async (req, res, next) => {
  try { const { base64, mimeType, prompt } = req.body || {}; res.json({ text: await analyseMedia({ base64, mimeType, prompt }) }); }
  catch (err) { next(err); }
});

app.post('/api/analyze-screen', async (req, res, next) => {
  try { const { base64, mimeType, prompt } = req.body || {}; res.json({ text: await analyseMedia({ base64, mimeType, prompt: prompt || "Analyze this screenshot and answer any implied question." }) }); }
  catch (err) { next(err); }
});

app.post('/api/upload', upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) throw Object.assign(new Error('No file.'), { status:400, publicMessage:'No file received.' });
    res.json({ name: req.file.originalname, size: req.file.size, mimeType: req.file.mimetype, base64: req.file.buffer.toString('base64') });
  } catch (err) { next(err); }
});

app.post('/api/tool/execute', async (req, res, next) => {
  try {
    const { name, args } = req.body || {};
    const tool = tools[name];
    if (!tool) throw Object.assign(new Error('Unknown tool.'), { status:404, publicMessage:'Unknown tool.' });
    if (tool.client) throw Object.assign(new Error('Client tool.'), { status:400, publicMessage:'That runs in the browser.' });
    res.json({ ok:true, result: await tool.handler(args||{}) });
  } catch (err) { next(err); }
});

app.get(/^(?!\/api).*/, (_req, res) => { res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')); });

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[NOVA ERROR]', err);
  res.status(status).json({ error: err.publicMessage || (status >= 500 ? "I couldn't reach my AI core." : 'Request could not be processed.'), code: err.code || 'error' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`\n  NOVA online → port ${PORT}`);
  console.log(`  Model       → ${process.env.GEMINI_MODEL || '(not set)'}`);
  console.log(`  Gemini key  → ${process.env.GEMINI_API_KEY ? 'configured ✓' : 'MISSING ✗'}\n`);
});
