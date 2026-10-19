import { Hono, type Context } from 'hono';
import { createSession, destroySession, readSession, sameOriginMutation } from './session';
import { UploadError, deleteAttachment, downloadAttachment, uploadAttachment } from './uploads';
import { createResultCache } from './result-cache';

type Bindings = Env & { SESSION_SECRET?: string };
type Vars = { ownerId: string };
type Ctx = Context<{ Bindings: Bindings; Variables: Vars }>;

const DEMO_PASSWORD = 'local-demo-password';
const DEMO_USERS: Record<string, { id: string; email: string }> = {
  'alice@example.test': { id: 'usr_alice', email: 'alice@example.test' },
  'bob@example.test': { id: 'usr_bob', email: 'bob@example.test' },
};
const HANDLE = /^[a-z0-9_]{3,30}$/;

const app = new Hono<{ Bindings: Bindings; Variables: Vars }>();

const noStore = { 'Cache-Control': 'private, no-store' };

// Strict CSRF defense: every unsafe request needs an Origin equal to the request origin.
app.use('/api/*', async (c, next) => {
  if (!sameOriginMutation(c.req.raw)) return c.json({ error: 'forbidden origin' }, 403, noStore);
  await next();
  if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'private, no-store');
});

app.get('/api/health', (c) => c.json({ ok: true }));

async function readJson(c: Ctx): Promise<Record<string, unknown> | null> {
  try {
    const v = await c.req.json();
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

app.post('/api/login', async (c) => {
  if (c.env.ENVIRONMENT !== 'dev') return c.json({ error: 'demo login disabled' }, 403);
  const body = await readJson(c);
  if (!body) return c.json({ error: 'invalid json' }, 400);
  const { email, password } = body;
  const user = typeof email === 'string' ? Object.hasOwn(DEMO_USERS, email) && DEMO_USERS[email] : null;
  if (!user || password !== DEMO_PASSWORD) return c.json({ error: 'invalid credentials' }, 401);
  const { setCookie } = await createSession(c.env, user.id, c.req.raw);
  c.header('Set-Cookie', setCookie, { append: true });
  return c.json({ user: { id: user.id, email: user.email } });
});

const userFor = (ownerId: string) => Object.values(DEMO_USERS).find((u) => u.id === ownerId);

app.post('/api/logout', async (c) => {
  const setCookie = await destroySession(c.env, c.req.raw);
  return new Response(null, { status: 204, headers: { 'Set-Cookie': setCookie, ...noStore } });
});

app.use('/api/*', async (c, next) => {
  const session = await readSession(c.env, c.req.raw);
  const user = session && userFor(session.owner_id);
  if (!session || !user) return c.json({ error: 'unauthenticated' }, 401, noStore);
  c.set('ownerId', session.owner_id);
  await next();
});

app.get('/api/session', (c) => {
  const user = userFor(c.get('ownerId'))!;
  return c.json({ user: { id: user.id, email: user.email } });
});

// ---- profiles ----
interface ProfileRow {
  handle: string;
  display_name: string;
  bio: string;
  avatar_id: string | null;
  is_public: number;
  revision: number;
  nonce: string;
}
const loadProfile = (env: Bindings, ownerId: string) =>
  env.DB.prepare('SELECT handle, display_name, bio, avatar_id, is_public, revision, nonce FROM profiles WHERE owner_id = ?')
    .bind(ownerId).first<ProfileRow>();

function publicProfile(row: ProfileRow | null) {
  if (!row) return { profile: { handle: '', display_name: '', bio: '', avatar_id: null, is_public: false }, revision: 0 };
  return {
    profile: { handle: row.handle, display_name: row.display_name, bio: row.bio, avatar_id: row.avatar_id, is_public: row.is_public === 1 },
    revision: row.revision,
  };
}

app.get('/api/profile', async (c) => c.json(publicProfile(await loadProfile(c.env, c.get('ownerId')))));

app.put('/api/profile', async (c) => {
  const ownerId = c.get('ownerId');
  const b = await readJson(c);
  if (!b) return c.json({ error: 'invalid json' }, 400);
  const { handle, display_name, bio, avatar_id, is_public, revision } = b;
  if (typeof handle !== 'string' || !HANDLE.test(handle)) return c.json({ error: 'invalid handle' }, 400);
  if (typeof display_name !== 'string' || display_name.length < 1 || display_name.length > 80) return c.json({ error: 'invalid display_name' }, 400);
  if (typeof bio !== 'string' || bio.length > 500) return c.json({ error: 'invalid bio' }, 400);
  if (avatar_id !== null) return c.json({ error: 'invalid avatar_id' }, 400);
  if (typeof is_public !== 'boolean') return c.json({ error: 'invalid is_public' }, 400);
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return c.json({ error: 'invalid revision' }, 400);

  const nonce = crypto.randomUUID();
  try {
    let changes: number;
    if (revision === 0) {
      changes = (await c.env.DB.prepare(
        'INSERT INTO profiles (owner_id, handle, display_name, bio, avatar_id, is_public, revision, nonce) VALUES (?, ?, ?, ?, NULL, ?, 1, ?) ON CONFLICT(owner_id) DO NOTHING',
      ).bind(ownerId, handle, display_name, bio, is_public ? 1 : 0, nonce).run()).meta.changes;
    } else {
      changes = (await c.env.DB.prepare(
        'UPDATE profiles SET handle = ?, display_name = ?, bio = ?, avatar_id = NULL, is_public = ?, revision = revision + 1, nonce = ? WHERE owner_id = ? AND revision = ?',
      ).bind(handle, display_name, bio, is_public ? 1 : 0, nonce, ownerId, revision).run()).meta.changes;
    }
    if (changes !== 1) return c.json({ error: 'stale revision' }, 409);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ error: 'handle taken' }, 409);
    throw e;
  }
  return c.json(publicProfile(await loadProfile(c.env, ownerId)));
});

// ---- uploads ----
app.post('/api/uploads', async (c) => {
  try {
    const { id } = await uploadAttachment(c.env, c.get('ownerId'), c.req.raw);
    return c.json({ id }, 201);
  } catch (e) {
    if (e instanceof UploadError) return c.json({ error: e.message }, e.status);
    throw e;
  }
});
app.get('/api/uploads/:id', (c) => downloadAttachment(c.env, c.get('ownerId'), c.req.param('id')));
app.delete('/api/uploads/:id', async (c) => {
  await deleteAttachment(c.env, c.get('ownerId'), c.req.param('id'));
  return new Response(null, { status: 204, headers: noStore });
});

// ---- cached report ----
interface ReportData { revision: number; displayName: string }
app.get('/api/report', async (c) => {
  const ownerId = c.get('ownerId');
  // Authoritative revision is read from D1 before any cache entry is chosen.
  const row = await loadProfile(c.env, ownerId);
  const data: ReportData = { revision: row?.revision ?? 0, displayName: row?.display_name ?? '' };
  const cache = createResultCache({
    origin: new URL(c.req.url).origin,
    context: c.executionCtx,
    kv: c.env.RESULT_CACHE,
  });
  const result = await cache.get<ReportData>({
    key: { scope: 'report', tenant: ownerId, version: `${data.revision}.${row?.nonce ?? 'none'}`, parts: [] },
    freshSeconds: 60,
    parse(v) {
      const r = v as ReportData;
      if (!r || typeof r.revision !== 'number' || typeof r.displayName !== 'string') throw new Error('bad report');
      return { revision: r.revision, displayName: r.displayName };
    },
    load: async () => data,
  });
  const cacheTier = result.tier === 'store' ? 'origin' : result.tier;
  return c.json({ revision: result.value.revision, displayName: result.value.displayName, cacheTier });
});

app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
