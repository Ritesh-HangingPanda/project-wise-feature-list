// Cloudflare Worker version of the status server (free plan, data kept in Workers KV).
// Same API as server.js. Bindings: STATE (KV namespace). Secret: PASSKEY. Optional var: ALLOWED_ORIGIN.
//   GET  /api/state, GET /api/history              public
//   POST /api/verify, PUT /api/status, POST /api/reset,
//   POST /api/features, DELETE /api/features/:id   need the x-passkey header

const STATUSES = ['Released', 'Ready to Release', 'Development', 'Not Done'];
const PROJECTS = ['HRM', 'MOH', 'SGS', 'Zain Attendance', 'Ithbat-MOIA', 'Dawami365'];
const MAX_BODY = 20 * 1024;
const MAX_HISTORY = 200;
const MAX_FAILS = 5;
const WINDOW_SECONDS = 600;
const enc = new TextEncoder();

async function sha(s) { return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(s)))); }
async function passOk(given, secret) {
  const a = await sha(given || ''), b = await sha(secret);
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const validKey = k => typeof k === 'string' && k.includes('|') && PROJECTS.includes(k.split('|')[0]) && k.length < 200;
const rid = () => [...crypto.getRandomValues(new Uint8Array(6))].map(x => x.toString(16).padStart(2, '0')).join('');

async function load(env) {
  const raw = await env.STATE.get('state');
  const base = { statuses: {}, features: [], history: [], updatedAt: null };
  return raw ? { ...base, ...JSON.parse(raw) } : base;
}
async function save(env, state, action, detail) {
  state.updatedAt = new Date().toISOString();
  state.history = [{ at: state.updatedAt, action, ...detail }, ...state.history].slice(0, MAX_HISTORY);
  await env.STATE.put('state', JSON.stringify(state));
}

export default {
  async fetch(request, env) {
    if (!env.PASSKEY) return json({ error: 'Server is missing the PASSKEY secret' }, 500, request, env);
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request, env) });
    try {
      return await route(request, env, url);
    } catch (e) {
      return json({ error: e.message === 'too large' ? 'Body too large' : e.message === 'bad json' ? 'Bad JSON' : 'Server error' }, e.message === 'too large' ? 413 : 400, request, env);
    }
  },
};

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const allow = env.ALLOWED_ORIGIN || 'https://ritesh-hangingpanda.github.io';
  return origin && (origin === allow || origin.startsWith('http://localhost')) ? origin : null;
}
function cors(request, env) {
  const o = allowedOrigin(request, env);
  return o ? {
    'Access-Control-Allow-Origin': o, Vary: 'Origin',
    'Access-Control-Allow-Headers': 'content-type, x-passkey',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  } : {};
}
function json(body, status, request, env) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(request, env) },
  });
}
async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error('too large');
  try { return text ? JSON.parse(text) : {}; } catch (e) { throw new Error('bad json'); }
}

async function authed(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const fk = 'fail:' + ip;
  const n = parseInt((await env.STATE.get(fk)) || '0', 10);
  if (n >= MAX_FAILS) return json({ error: 'Too many wrong passkeys. Try again in 10 minutes.' }, 429, request, env);
  if (!(await passOk(request.headers.get('x-passkey'), env.PASSKEY))) {
    await env.STATE.put(fk, String(n + 1), { expirationTtl: WINDOW_SECONDS });
    return json({ error: 'Wrong passkey' }, 401, request, env);
  }
  return null;
}

async function route(request, env, url) {
  const m = request.method, p = url.pathname;
  if (m === 'GET' && p === '/api/state') {
    const s = await load(env);
    return json({ statuses: s.statuses, features: s.features, updatedAt: s.updatedAt }, 200, request, env);
  }
  if (m === 'GET' && p === '/api/history') return json((await load(env)).history.slice(0, 50), 200, request, env);
  if (m === 'GET' && p === '/healthz') return new Response('ok');

  if (m === 'POST' && p === '/api/verify') {
    const bad = await authed(request, env); if (bad) return bad;
    return new Response(null, { status: 204, headers: cors(request, env) });
  }
  if (m === 'PUT' && p === '/api/status') {
    const bad = await authed(request, env); if (bad) return bad;
    const { key, status } = await readBody(request);
    if (!validKey(key)) return json({ error: 'Bad key' }, 400, request, env);
    const s = await load(env), was = s.statuses[key] || null;
    if (status === null) delete s.statuses[key];
    else if (STATUSES.includes(status)) s.statuses[key] = status;
    else return json({ error: 'Bad status' }, 400, request, env);
    await save(env, s, 'status', { key, from: was, to: status });
    return json({ ok: true, updatedAt: s.updatedAt }, 200, request, env);
  }
  if (m === 'POST' && p === '/api/reset') {
    const bad = await authed(request, env); if (bad) return bad;
    const s = await load(env), n = Object.keys(s.statuses).length;
    s.statuses = {};
    await save(env, s, 'reset', { count: n });
    return json({ ok: true }, 200, request, env);
  }
  if (m === 'POST' && p === '/api/features') {
    const bad = await authed(request, env); if (bad) return bad;
    const b = await readBody(request);
    const name = clean(b.name, 80), category = clean(b.category, 60);
    if (!name || !category) return json({ error: 'Name and category are required' }, 400, request, env);
    const statuses = {};
    for (const pr of PROJECTS) statuses[pr] = b.statuses && STATUSES.includes(b.statuses[pr]) ? b.statuses[pr] : 'Not Done';
    const s = await load(env);
    if (s.features.some(f => f.name.toLowerCase() === name.toLowerCase())) return json({ error: 'A feature with this name already exists' }, 409, request, env);
    const f = { id: rid(), name, category, statuses };
    s.features.push(f);
    await save(env, s, 'add-feature', { name, category });
    return json(f, 201, request, env);
  }
  const dm = p.match(/^\/api\/features\/([0-9a-f]+)$/);
  if (m === 'DELETE' && dm) {
    const bad = await authed(request, env); if (bad) return bad;
    const s = await load(env), i = s.features.findIndex(f => f.id === dm[1]);
    if (i < 0) return json({ error: 'Not found' }, 404, request, env);
    const [f] = s.features.splice(i, 1);
    for (const k of Object.keys(s.statuses)) if (k.split('|').slice(1).join('|') === f.name) delete s.statuses[k];
    await save(env, s, 'delete-feature', { name: f.name });
    return json({ ok: true }, 200, request, env);
  }
  return json({ error: 'Not found' }, 404, request, env);
}
