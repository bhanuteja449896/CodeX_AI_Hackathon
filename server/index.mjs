import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const distRoot = fileURLToPath(new URL('../dist', import.meta.url));

// ── Load .env ──────────────────────────────────────────────────────────────
function loadEnv() {
  const p = fileURLToPath(new URL('../.env', import.meta.url));
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && (!(m[1] in process.env) || process.env[m[1]] === ''))
      process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
}
loadEnv();

const PORT  = Number(process.env.PORT  || 3000);
const MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-mini-realtime-preview';
const KEY   = process.env.OPENAI_API_KEY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.woff2':'font/woff2',
};

const SYSTEM_PROMPT = `You are Sahaay, a warm and patient AI voice assistant that helps users book public clinic appointments.
Keep responses SHORT — one or two sentences maximum. Speak plainly and slowly.
You help elderly, rural, low-literacy, and multilingual users navigate the healthcare system.
Collect: type of appointment, preferred date, patient name, and phone number.
Before confirming, read back all details and ask for an explicit "yes". 
Never diagnose, prescribe, or give medical advice. Always offer a human handoff if asked.
This is a demo — any appointments booked are fictional.`;

// ── Parse JSON body ────────────────────────────────────────────────────────
async function parseBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { return {}; }
}

// ── POST /api/session ──────────────────────────────────────────────────────
// Creates an OpenAI Realtime session and returns a short-lived ephemeral
// client token. The browser then connects directly to OpenAI WebRTC.
//
// Flow:
//   Browser  →  POST /api/session              (gets token)
//   Browser  →  POST https://api.openai.com/v1/realtime?model=…  (SDP offer with token)
//   OpenAI   →  SDP answer  (browser sets remote description, audio starts)
async function handleSession(req, res) {
  if (!KEY) {
    res.writeHead(503, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'OPENAI_API_KEY not set in .env' }));
  }

  const { language = 'English' } = await parseBody(req);

  const body = {
    model: MODEL,
    modalities: ['audio', 'text'],
    instructions: `${SYSTEM_PROMPT}\nSpeak in ${language}.`,
    voice: 'alloy',
    input_audio_format:  'pcm16',
    output_audio_format: 'pcm16',
    input_audio_transcription: { model: 'whisper-1' },
    turn_detection: {
      type: 'server_vad',
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 600,
      create_response: true,
    },
    max_response_output_tokens: 256,
  };

  let r;
  try {
    r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
  } catch (e) {
    console.error('[session] network error:', e.message);
    res.writeHead(502, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Cannot reach OpenAI. Check your internet.' }));
  }

  const data = await r.json();
  if (!r.ok) {
    console.error('[session] OpenAI error:', JSON.stringify(data));
    res.writeHead(r.status, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: data?.error?.message || 'Session creation failed.' }));
  }

  console.log(`[session] created  model=${MODEL}  language=${language}`);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    token:      data.client_secret.value,
    expires_at: data.client_secret.expires_at,
    model:      MODEL,
  }));
}

// ── Static file server ─────────────────────────────────────────────────────
async function serveStatic(req, res) {
  if (!existsSync(distRoot)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Run "npm run build" first, or use "npm run dev" for the Vite dev server.');
  }
  const urlPath   = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const safe      = normalize(join(distRoot, urlPath));
  if (!safe.startsWith(distRoot)) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const data = await readFile(safe);
    res.writeHead(200, { 'content-type': MIME[extname(safe)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    // SPA fallback — serve index.html for client-side routes
    try {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(await readFile(join(distRoot, 'index.html')));
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found');
    }
  }
}

// ── HTTP server ────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  // CORS for dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    if (req.method === 'POST' && req.url === '/api/session') return await handleSession(req, res);
    if (req.method === 'GET')                                return await serveStatic(req, res);
    res.writeHead(405); res.end('Method not allowed');
  } catch (err) {
    console.error('[server] unhandled error:', err);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error.' }));
  }
});

server.listen(PORT, () => {
  console.log(`\n  Sahaay API  →  http://localhost:${PORT}/api/session`);
  console.log(KEY
    ? `  OpenAI key  ✓  model: ${MODEL}`
    : '  ⚠  OPENAI_API_KEY not set — add it to .env and restart');
  console.log('');
});
