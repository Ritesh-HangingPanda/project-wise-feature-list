// Small status server for the project-wise feature report.
// - Serves index.html and config.js
// - Public read:  GET /api/state, GET /api/history
// - Passkey write: POST /api/verify, PUT /api/status, POST /api/reset,
//                  POST /api/features, DELETE /api/features/:id
// No dependencies. Set PASSKEY (required) and optionally DATA_DIR, PORT, ALLOWED_ORIGIN.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://ritesh-hangingpanda.github.io';
const PASSKEY = process.env.PASSKEY;

if (!PASSKEY) {
  console.error('PASSKEY environment variable is required.');
  process.exit(1);
}

const STATUSES = ['Released', 'Ready to Release', 'Development', 'Not Done'];
const PROJECTS = ['HRM', 'MOH', 'SGS', 'Zain Attendance', 'Ithbat-MOIA', 'Dawami365'];
const MAX_BODY = 20 * 1024;
const MAX_HISTORY = 200;

const hash = s => crypto.createHash('sha256').update(String(s)).digest();
const PASS_HASH = hash(PASSKEY);
const passOk = p => crypto.timingSafeEqual(hash(p || ''), PASS_HASH);

// ---------- storage (JSON file, atomic write) ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
let state = { statuses: {}, features: [], history: [], updatedAt: null };
try { state = { ...state, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch (e) { /* first run */ }

function save(action, detail) {
  state.updatedAt = new Date().toISOString();
  state.history.unshift({ at: state.updatedAt, action, ...detail });
  state.history = state.history.slice(0, MAX_HISTORY);
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, DATA_FILE);
}

// ---------- failed-passkey rate limit (per IP) ----------
const fails = new Map();
const WINDOW = 10 * 60 * 1000, MAX_FAILS = 5;
function ip(req) { return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function blocked(req) {
  const f = fails.get(ip(req));
  return f && f.n >= MAX_FAILS && Date.now() - f.t < WINDOW;
}
function noteFail(req) {
  const k = ip(req), f = fails.get(k);
  if (!f || Date.now() - f.t >= WINDOW) fails.set(k, { n: 1, t: Date.now() });
  else f.n++;
}

// ---------- helpers ----------
function send(res, code, body, extra = {}) {
  const isObj = body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isObj ? 'application/json' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch (e) { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const validKey = k => typeof k === 'string' && k.includes('|') && PROJECTS.includes(k.split('|')[0]) && k.length < 200;

function authed(req, res) {
  if (blocked(req)) { send(res, 429, { error: 'Too many wrong passkeys. Try again in 10 minutes.' }); return false; }
  if (!passOk(req.headers['x-passkey'])) { noteFail(req); send(res, 401, { error: 'Wrong passkey' }); return false; }
  return true;
}

const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/config.js': 'config.js' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const origin = req.headers.origin;
  if (origin && (origin === ALLOWED_ORIGIN || origin.startsWith('http://localhost'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-passkey');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') return send(res, 204);

  try {
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const file = path.join(__dirname, STATIC[url.pathname]);
      return send(res, 200, fs.readFileSync(file), { 'Content-Type': TYPES[path.extname(file)] });
    }
    if (url.pathname === '/healthz') return send(res, 200, 'ok');

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return send(res, 200, { statuses: state.statuses, features: state.features, updatedAt: state.updatedAt });
    }
    if (req.method === 'GET' && url.pathname === '/api/history') {
      return send(res, 200, state.history.slice(0, 50));
    }
    if (req.method === 'POST' && url.pathname === '/api/verify') {
      if (!authed(req, res)) return;
      return send(res, 204);
    }
    if (req.method === 'PUT' && url.pathname === '/api/status') {
      if (!authed(req, res)) return;
      const { key, status } = await readBody(req);
      if (!validKey(key)) return send(res, 400, { error: 'Bad key' });
      const was = state.statuses[key] || null;
      if (status === null) delete state.statuses[key];
      else if (STATUSES.includes(status)) state.statuses[key] = status;
      else return send(res, 400, { error: 'Bad status' });
      save('status', { key, from: was, to: status });
      return send(res, 200, { ok: true, updatedAt: state.updatedAt });
    }
    if (req.method === 'POST' && url.pathname === '/api/reset') {
      if (!authed(req, res)) return;
      const n = Object.keys(state.statuses).length;
      state.statuses = {};
      save('reset', { count: n });
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/features') {
      if (!authed(req, res)) return;
      const b = await readBody(req);
      const name = clean(b.name, 80), category = clean(b.category, 60);
      if (!name || !category) return send(res, 400, { error: 'Name and category are required' });
      const statuses = {};
      for (const p of PROJECTS) {
        const v = b.statuses && b.statuses[p];
        statuses[p] = STATUSES.includes(v) ? v : 'Not Done';
      }
      if (state.features.some(f => f.name.toLowerCase() === name.toLowerCase())) return send(res, 409, { error: 'A feature with this name already exists' });
      const f = { id: crypto.randomBytes(6).toString('hex'), name, category, statuses };
      state.features.push(f);
      save('add-feature', { name, category });
      return send(res, 201, f);
    }
    const m = url.pathname.match(/^\/api\/features\/([0-9a-f]+)$/);
    if (req.method === 'DELETE' && m) {
      if (!authed(req, res)) return;
      const i = state.features.findIndex(f => f.id === m[1]);
      if (i < 0) return send(res, 404, { error: 'Not found' });
      const [f] = state.features.splice(i, 1);
      for (const k of Object.keys(state.statuses)) if (k.split('|').slice(1).join('|') === f.name) delete state.statuses[k];
      save('delete-feature', { name: f.name });
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    return send(res, e.message === 'too large' ? 413 : 400, { error: e.message });
  }
});

server.listen(PORT, () => console.log('Feature status server on :' + PORT));
