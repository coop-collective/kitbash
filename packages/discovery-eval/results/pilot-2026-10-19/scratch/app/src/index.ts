import { Hono } from 'hono';
import type { Context } from 'hono';

type Vars = { user: { id: string; email: string }; sid: string };
type C = Context<{ Bindings: Env; Variables: Vars }>;

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

const COOKIE = 'ks_session';
const SESSION_TTL = 7 * 24 * 3600;
const MAX_UPLOAD = 1024 * 1024;
const DEMO_USERS: Record<string, string> = {
  'alice@example.test': 'user_alice',
  'bob@example.test': 'user_bob',
};
const DEMO_PASSWORD = 'local-demo-password';
const enc = new TextEncoder();

const hex = (b: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(b as ArrayBuffer)].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => {
  if (!/^([0-9a-f]{2})+$/.test(s)) return null;
  return new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));
};

async function hmacKey(env: Env) {
  return crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function sign(env: Env, sid: string) {
  return `${sid}.${hex(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(sid)))}`;
}
async function unsign(env: Env, value: string): Promise<string | null> {
  const [sid, mac, extra] = value.split('.');
  if (!sid || !mac || extra !== undefined) return null;
  const m = unhex(mac);
  if (!m) return null;
  return (await crypto.subtle.verify('HMAC', await hmacKey(env), m, enc.encode(sid))) ? sid : null;
}

const isLoopback = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
const readCookie = (header: string | null, name: string) => {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
};
const cookieStr = (value: string, maxAge: number, secure: boolean) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

app.use('*', async (c, next) => {
  await next();
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
});

app.use('/api/*', async (c, next) => {
  const m = c.req.method;
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    const origin = c.req.header('Origin');
    if (!origin || origin !== new URL(c.req.url).origin) return c.json({ error: 'forbidden origin' }, 403);
  }
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/login', async (c) => {
  if (c.env.ENVIRONMENT !== 'dev') return c.json({ error: 'demo login disabled' }, 403);
  const url = new URL(c.req.url);
  if (url.protocol !== 'https:' && !isLoopback(url.hostname)) return c.json({ error: 'https required' }, 403);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid json' }, 400); }
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const expected = c.env.DEMO_PASSWORD || DEMO_PASSWORD;
  const userId = Object.hasOwn(DEMO_USERS, email) ? DEMO_USERS[email] : undefined;
  if (!userId || password !== expected || password !== DEMO_PASSWORD) return c.json({ error: 'invalid credentials' }, 401);
  const sid = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare('INSERT INTO sessions (id,user_id,email,created_at,expires_at) VALUES (?,?,?,?,?)')
    .bind(sid, userId, email, now, now + SESSION_TTL).run();
  const res = c.json({ user: { id: userId, email } });
  res.headers.append('Set-Cookie', cookieStr(await sign(c.env, sid), SESSION_TTL, url.protocol === 'https:'));
  return res;
});

async function auth(c: C, next: () => Promise<void>) {
  const raw = readCookie(c.req.header('Cookie') ?? null, COOKIE);
  const sid = raw ? await unsign(c.env, raw) : null;
  if (sid) {
    const now = Math.floor(Date.now() / 1000);
    const row = await c.env.DB.prepare('SELECT user_id,email FROM sessions WHERE id=? AND revoked_at IS NULL AND expires_at>?')
      .bind(sid, now).first<{ user_id: string; email: string }>();
    if (row) {
      c.set('user', { id: row.user_id, email: row.email });
      c.set('sid', sid);
      c.header('Cache-Control', 'private, no-store');
      return next();
    }
  }
  return c.json({ error: 'unauthenticated' }, 401);
}
app.use('/api/session', auth);
app.use('/api/logout', auth);
app.use('/api/profile', auth);
app.use('/api/uploads', auth);
app.use('/api/uploads/*', auth);
app.use('/api/report', auth);

app.get('/api/session', (c) => c.json({ user: c.get('user') }));

app.post('/api/logout', async (c) => {
  await c.env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(Math.floor(Date.now() / 1000), c.get('sid')).run();
  const secure = new URL(c.req.url).protocol === 'https:';
  return new Response(null, { status: 204, headers: { 'Set-Cookie': cookieStr('', 0, secure).replace('Max-Age=0', 'Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT'), 'Cache-Control': 'private, no-store' } });
});

// ---- profile
type ProfileRow = { handle: string; display_name: string; bio: string; avatar_id: string | null; is_public: number; revision: number };
async function loadProfile(env: Env, userId: string) {
  const r = await env.DB.prepare('SELECT handle,display_name,bio,avatar_id,is_public,revision FROM profiles WHERE user_id=?')
    .bind(userId).first<ProfileRow>();
  if (!r) return { profile: { handle: '', display_name: '', bio: '', avatar_id: null, is_public: false }, revision: 0 };
  return {
    profile: { handle: r.handle, display_name: r.display_name, bio: r.bio, avatar_id: r.avatar_id, is_public: !!r.is_public },
    revision: r.revision,
  };
}

app.get('/api/profile', async (c) => c.json(await loadProfile(c.env, c.get('user').id)));

app.put('/api/profile', async (c) => {
  let b: any;
  try { b = await c.req.json(); } catch { return c.json({ error: 'invalid json' }, 400); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return c.json({ error: 'invalid body' }, 400);
  const { handle, display_name, bio, avatar_id, is_public, revision } = b;
  if (typeof handle !== 'string' || !/^[a-z0-9_]{3,30}$/.test(handle)) return c.json({ error: 'invalid handle' }, 400);
  if (typeof display_name !== 'string' || display_name.length < 1 || display_name.length > 80) return c.json({ error: 'invalid display_name' }, 400);
  if (typeof bio !== 'string' || bio.length > 500) return c.json({ error: 'invalid bio' }, 400);
  if (avatar_id !== null) return c.json({ error: 'invalid avatar_id' }, 400);
  if (typeof is_public !== 'boolean') return c.json({ error: 'invalid is_public' }, 400);
  if (!Number.isInteger(revision) || revision < 0) return c.json({ error: 'invalid revision' }, 400);
  const uid = c.get('user').id;
  let changes: number;
  if (revision === 0) {
    const r = await c.env.DB.prepare('INSERT OR IGNORE INTO profiles (user_id,handle,display_name,bio,avatar_id,is_public,revision) VALUES (?,?,?,?,NULL,?,1)')
      .bind(uid, handle, display_name, bio, is_public ? 1 : 0).run();
    changes = r.meta.changes;
  } else {
    const r = await c.env.DB.prepare('UPDATE profiles SET handle=?,display_name=?,bio=?,avatar_id=NULL,is_public=?,revision=revision+1 WHERE user_id=? AND revision=?')
      .bind(handle, display_name, bio, is_public ? 1 : 0, uid, revision).run();
    changes = r.meta.changes;
  }
  if (changes !== 1) return c.json({ error: 'revision conflict', ...(await loadProfile(c.env, uid)) }, 409);
  return c.json(await loadProfile(c.env, uid));
});

// ---- uploads
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const objKey = (uid: string, id: string) => `uploads/${uid}/${id}`;

app.post('/api/uploads', async (c) => {
  const ct = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (ct !== 'application/octet-stream') return c.json({ error: 'content-type must be application/octet-stream' }, 415);
  const cl = c.req.header('Content-Length');
  if (cl && Number(cl) > MAX_UPLOAD) return c.json({ error: 'too large' }, 413);
  const reader = c.req.raw.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_UPLOAD) { await reader.cancel().catch(() => {}); return c.json({ error: 'too large' }, 413); }
      chunks.push(value);
    }
  }
  const data = new Uint8Array(total);
  let o = 0;
  for (const ch of chunks) { data.set(ch, o); o += ch.byteLength; }
  const id = crypto.randomUUID();
  await c.env.UPLOADS.put(objKey(c.get('user').id, id), data, { httpMetadata: { contentType: 'application/octet-stream' } });
  return c.json({ id }, 201);
});

app.get('/api/uploads/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID_RE.test(id)) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.UPLOADS.get(objKey(c.get('user').id, id));
  if (!obj) return c.json({ error: 'not found' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${id}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Content-Length': String(obj.size),
    },
  });
});

app.delete('/api/uploads/:id', async (c) => {
  const id = c.req.param('id');
  const key = ID_RE.test(id) ? objKey(c.get('user').id, id) : null;
  if (!key || !(await c.env.UPLOADS.head(key))) return c.json({ error: 'not found' }, 404);
  await c.env.UPLOADS.delete(key);
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });
});

// ---- report
app.get('/api/report', async (c) => {
  const uid = c.get('user').id;
  const { profile, revision } = await loadProfile(c.env, uid);
  const keyName = `report/${encodeURIComponent(uid)}/${revision}`;
  const edgeReq = new Request(`https://report-cache.invalid/${keyName}`);
  const edge = caches.default;
  const hit = async () => {
    const e = await edge.match(edgeReq);
    if (e) { const d = await e.json<any>(); if (d.revision === revision) return { d, tier: 'edge' }; }
    const k = await c.env.RESULT_CACHE?.get(keyName, 'json') as any;
    if (k && k.revision === revision) {
      await edge.put(edgeReq, new Response(JSON.stringify(k), { headers: { 'Cache-Control': 'max-age=300' } })).catch(() => {});
      return { d: k, tier: 'kv' };
    }
    return null;
  };
  const found = await hit();
  if (found) return c.json({ revision, displayName: found.d.displayName, cacheTier: found.tier });
  const data = { revision, displayName: profile.display_name };
  await Promise.all([
    edge.put(edgeReq, new Response(JSON.stringify(data), { headers: { 'Cache-Control': 'max-age=300' } })).catch(() => {}),
    c.env.RESULT_CACHE?.put(keyName, JSON.stringify(data), { expirationTtl: 600 }).catch(() => {}),
  ]);
  return c.json({ ...data, cacheTier: 'origin' });
});

app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));
export default app;
