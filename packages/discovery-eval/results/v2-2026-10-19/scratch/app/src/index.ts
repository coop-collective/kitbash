import { Hono, type Context } from 'hono';

type AppEnv = Env & { SESSION_SECRET?: string; DEMO_PASSWORD?: string };
type Vars = { userId: string; email: string; sessionId: string };
type C = Context<{ Bindings: AppEnv; Variables: Vars }>;

const COOKIE = 'ks_session';
const SESSION_TTL_S = 60 * 60 * 24 * 7;
const MAX_UPLOAD = 1024 * 1024;
const DEMO_USERS: Record<string, string> = {
  'alice@example.test': 'user_alice',
  'bob@example.test': 'user_bob',
};
const DEV_SECRET = 'local-only-session-secret-at-least-32-characters';
const enc = new TextEncoder();

const app = new Hono<{ Bindings: AppEnv; Variables: Vars }>();

// ---- helpers ----

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};

async function hmacKey(env: AppEnv) {
  return crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET || DEV_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signToken(env: AppEnv, id: string) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(id));
  return `${id}.${b64url(sig)}`;
}

async function verifyToken(env: AppEnv, token: string): Promise<string | null> {
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const id = token.slice(0, dot);
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), unb64url(token.slice(dot + 1)), enc.encode(id));
    return ok ? id : null;
  } catch {
    return null;
  }
}

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get('Cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function cookieHeader(c: C, value: string, maxAge: number) {
  const secure = new URL(c.req.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function readJson(c: C): Promise<Record<string, unknown> | null> {
  try {
    const text = await c.req.text();
    if (text.length > 16 * 1024) return null;
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// ---- middleware ----

app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (!origin || origin !== new URL(c.req.url).origin) return c.json({ error: 'bad origin' }, 403);
  }
  await next();
});

const requireAuth = async (c: C, next: () => Promise<void>) => {
  const token = readCookie(c.req.raw, COOKIE);
  const id = token ? await verifyToken(c.env, token) : null;
  if (!id) return c.json({ error: 'unauthorized' }, 401);
  const row = await c.env.DB.prepare('SELECT user_id, email FROM sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?')
    .bind(id, Math.floor(Date.now() / 1000))
    .first<{ user_id: string; email: string }>();
  if (!row) return c.json({ error: 'unauthorized' }, 401);
  c.set('userId', row.user_id);
  c.set('email', row.email);
  c.set('sessionId', id);
  await next();
};

// ---- routes ----

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/login', async (c) => {
  if (c.env.ENVIRONMENT !== 'dev') return c.json({ error: 'demo login disabled' }, 403);
  const body = await readJson(c);
  if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') return c.json({ error: 'invalid body' }, 400);
  const userId = Object.hasOwn(DEMO_USERS, body.email) ? DEMO_USERS[body.email] : undefined;
  const expected = c.env.DEMO_PASSWORD || 'local-demo-password';
  if (!userId || body.password !== expected) return c.json({ error: 'invalid credentials' }, 401);
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, userId, body.email, now, now + SESSION_TTL_S)
    .run();
  c.header('Set-Cookie', cookieHeader(c, await signToken(c.env, id), SESSION_TTL_S));
  c.header('Cache-Control', 'no-store');
  return c.json({ user: { id: userId, email: body.email } });
});

app.get('/api/session', requireAuth, (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ user: { id: c.get('userId'), email: c.get('email') } });
});

app.post('/api/logout', async (c) => {
  const token = readCookie(c.req.raw, COOKIE);
  const id = token ? await verifyToken(c.env, token) : null;
  if (id) await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(Math.floor(Date.now() / 1000), id).run();
  c.header('Set-Cookie', cookieHeader(c, '', 0));
  return c.body(null, 204);
});

interface ProfileRow {
  handle: string;
  display_name: string;
  bio: string;
  avatar_id: string | null;
  is_public: number;
  revision: number;
}

async function loadProfile(env: AppEnv, userId: string) {
  const row = await env.DB.prepare('SELECT handle, display_name, bio, avatar_id, is_public, revision FROM profiles WHERE user_id = ?')
    .bind(userId)
    .first<ProfileRow>();
  if (!row) return { profile: { handle: '', display_name: '', bio: '', avatar_id: null, is_public: false }, revision: 0 };
  return {
    profile: { handle: row.handle, display_name: row.display_name, bio: row.bio, avatar_id: row.avatar_id, is_public: !!row.is_public },
    revision: row.revision,
  };
}

app.get('/api/profile', requireAuth, async (c) => {
  c.header('Cache-Control', 'private, no-store');
  return c.json(await loadProfile(c.env, c.get('userId')));
});

app.put('/api/profile', requireAuth, async (c) => {
  const b = await readJson(c);
  if (!b) return c.json({ error: 'invalid body' }, 400);
  const { handle, display_name, bio, avatar_id, is_public, revision } = b;
  if (typeof handle !== 'string' || !/^[a-z0-9_]{3,30}$/.test(handle)) return c.json({ error: 'invalid handle' }, 400);
  if (typeof display_name !== 'string' || display_name.length < 1 || display_name.length > 80) return c.json({ error: 'invalid display_name' }, 400);
  if (typeof bio !== 'string' || bio.length > 500) return c.json({ error: 'invalid bio' }, 400);
  if (avatar_id !== null && avatar_id !== undefined) return c.json({ error: 'invalid avatar_id' }, 400);
  if (typeof is_public !== 'boolean') return c.json({ error: 'invalid is_public' }, 400);
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return c.json({ error: 'invalid revision' }, 400);

  const userId = c.get('userId');
  let changed: number;
  if (revision === 0) {
    const r = await c.env.DB.prepare(
      'INSERT INTO profiles (user_id, handle, display_name, bio, avatar_id, is_public, revision) VALUES (?, ?, ?, ?, NULL, ?, 1) ON CONFLICT(user_id) DO NOTHING',
    ).bind(userId, handle, display_name, bio, is_public ? 1 : 0).run();
    changed = r.meta.changes;
  } else {
    const r = await c.env.DB.prepare(
      'UPDATE profiles SET handle = ?, display_name = ?, bio = ?, avatar_id = NULL, is_public = ?, revision = revision + 1 WHERE user_id = ? AND revision = ?',
    ).bind(handle, display_name, bio, is_public ? 1 : 0, userId, revision).run();
    changed = r.meta.changes;
  }
  c.header('Cache-Control', 'private, no-store');
  if (!changed) return c.json({ error: 'revision conflict', ...(await loadProfile(c.env, userId)) }, 409);
  return c.json(await loadProfile(c.env, userId));
});

async function readBounded(req: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const ch of chunks) {
    out.set(ch, off);
    off += ch.byteLength;
  }
  return out;
}

app.post('/api/uploads', requireAuth, async (c) => {
  const data = await readBounded(c.req.raw, MAX_UPLOAD);
  if (!data) return c.json({ error: 'too large' }, 413);
  const id = crypto.randomUUID();
  const userId = c.get('userId');
  const key = `uploads/${userId}/${id}`;
  await c.env.UPLOADS.put(key, data, { httpMetadata: { contentType: 'application/octet-stream' } });
  await c.env.DB.prepare('INSERT INTO uploads (id, owner_id, object_key, size, content_type, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, userId, key, data.byteLength, 'application/octet-stream', Math.floor(Date.now() / 1000))
    .run();
  return c.json({ id }, 201);
});

const findUpload = (c: C) =>
  c.env.DB.prepare('SELECT object_key FROM uploads WHERE id = ? AND owner_id = ?')
    .bind(c.req.param('id'), c.get('userId'))
    .first<{ object_key: string }>();

app.get('/api/uploads/:id', requireAuth, async (c) => {
  const row = await findUpload(c);
  const obj = row ? await c.env.UPLOADS.get(row.object_key) : null;
  if (!obj) return c.json({ error: 'not found' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(obj.size),
      'Content-Disposition': 'attachment; filename="download.bin"',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
});

app.delete('/api/uploads/:id', requireAuth, async (c) => {
  const row = await findUpload(c);
  if (row) {
    await c.env.UPLOADS.delete(row.object_key);
    await c.env.DB.prepare('DELETE FROM uploads WHERE id = ? AND owner_id = ?').bind(c.req.param('id'), c.get('userId')).run();
  }
  return c.body(null, 204);
});

interface Report {
  revision: number;
  displayName: string;
}

app.get('/api/report', requireAuth, async (c) => {
  const userId = c.get('userId');
  const { profile, revision } = await loadProfile(c.env, userId);
  const key = `report:${userId}:${revision}`;
  const cacheUrl = `https://report-cache.invalid/${encodeURIComponent(userId)}/${revision}`;
  const edge = caches.default;
  const headers = { 'Cache-Control': 'private, no-store' };

  const hit = await edge.match(cacheUrl);
  if (hit) {
    const r = (await hit.json()) as Report;
    if (r.revision === revision) return c.json({ ...r, cacheTier: 'edge' }, 200, headers);
  }
  const kv = await c.env.RESULT_CACHE?.get<Report>(key, 'json');
  if (kv && kv.revision === revision) {
    c.executionCtx.waitUntil(edge.put(cacheUrl, Response.json(kv, { headers: { 'Cache-Control': 'max-age=60' } })));
    return c.json({ revision: kv.revision, displayName: kv.displayName, cacheTier: 'kv' }, 200, headers);
  }

  const report: Report = { revision, displayName: profile.display_name };
  await edge.put(cacheUrl, Response.json(report, { headers: { 'Cache-Control': 'max-age=60' } }));
  await c.env.RESULT_CACHE?.put(key, JSON.stringify(report), { expirationTtl: 300 });
  return c.json({ ...report, cacheTier: 'origin' }, 200, headers);
});

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));
export default app;
