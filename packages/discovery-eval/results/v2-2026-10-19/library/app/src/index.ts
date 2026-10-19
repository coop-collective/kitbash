import { Hono } from 'hono';
import { createResultCache, type ResultKV } from './lib/result-cache';
import { createSession, destroySession, readSession, sameOriginMutation, type Session } from './lib/session-cookie/session';
import { uploadRoutes } from './lib/r2-private-uploads/routes';
import { loadProfile, saveProfile, validateProfile } from './profiles';

const DEMO_PASSWORD = 'local-demo-password';
const DEMO_USERS: Record<string, { id: string; email: string }> = {
  'alice@example.test': { id: 'user-alice', email: 'alice@example.test' },
  'bob@example.test': { id: 'user-bob', email: 'bob@example.test' },
};
const LOCAL_FALLBACK_SECRET = 'local-dev-fallback-session-secret-32-chars';

type Vars = { session: Session };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

/** Session secret from the environment; only dev may fall back to a fixed local value. */
function sessionEnv(env: Env): { DB: D1Database; SESSION_SECRET: string } {
  const secret = (env as { SESSION_SECRET?: string }).SESSION_SECRET;
  if (secret && secret.length >= 32) return { DB: env.DB, SESSION_SECRET: secret };
  if (env.ENVIRONMENT === 'dev') return { DB: env.DB, SESSION_SECRET: LOCAL_FALLBACK_SECRET };
  throw new Error('SESSION_SECRET is not configured');
}

const sessionOf = (env: Env, request: Request) => readSession(sessionEnv(env), request);

app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  if (!sameOriginMutation(c.req.raw)) return c.json({ error: 'same-origin Origin required' }, 403);
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/login', async (c) => {
  if (c.env.ENVIRONMENT !== 'dev') return c.json({ error: 'demo login disabled' }, 403);
  const body = await c.req.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
  const user = body && typeof body.email === 'string' && Object.hasOwn(DEMO_USERS, body.email) ? DEMO_USERS[body.email] : undefined;
  if (!user || typeof body?.password !== 'string' || body.password !== DEMO_PASSWORD) return c.json({ error: 'invalid credentials' }, 401);
  try {
    const { setCookie } = await createSession(sessionEnv(c.env), user.id, c.req.raw);
    c.header('Set-Cookie', setCookie);
    return c.json({ user });
  } catch {
    return c.json({ error: 'sessions require HTTPS or loopback HTTP' }, 400);
  }
});

app.post('/api/logout', async (c) => {
  c.header('Set-Cookie', await destroySession(sessionEnv(c.env), c.req.raw).catch(() => ''));
  return c.body(null, 204);
});

// Everything below requires a live, unrevoked session.
app.use('/api/*', async (c, next) => {
  const session = await sessionOf(c.env, c.req.raw);
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  c.set('session', session);
  await next();
});

const userById = (id: string) => Object.values(DEMO_USERS).find((u) => u.id === id);

app.get('/api/session', (c) => {
  const user = userById(c.get('session').owner_id);
  return user ? c.json({ user }) : c.json({ error: 'unauthorized' }, 401);
});

app.get('/api/profile', async (c) => {
  const { profile, revision } = await loadProfile(c.env.DB, c.get('session').owner_id);
  return c.json({ profile, revision });
});

app.put('/api/profile', async (c) => {
  const body = await c.req.json().catch(() => null);
  const input = validateProfile(body);
  if (typeof input === 'string') return c.json({ error: input }, 400);
  const ownerId = c.get('session').owner_id;
  const result = await saveProfile(c.env.DB, ownerId, input);
  if (!result.ok) {
    const current = await loadProfile(c.env.DB, ownerId);
    return c.json({ error: result.reason, profile: current.profile, revision: current.revision }, 409);
  }
  const { profile, revision } = await loadProfile(c.env.DB, ownerId);
  return c.json({ profile, revision });
});

app.get('/api/report', async (c) => {
  const ownerId = c.get('session').owner_id;
  // Authoritative revision first; it selects the cache entry, so an update can never serve an old report.
  const current = await loadProfile(c.env.DB, ownerId);
  const cache = createResultCache({
    origin: new URL(c.req.url).origin,
    context: c.executionCtx,
    kv: c.env.RESULT_CACHE as unknown as ResultKV,
  });
  const result = await cache.get({
    key: { scope: 'report', tenant: ownerId, version: `${current.revision}.${current.nonce}`, parts: [] },
    freshSeconds: 300,
    parse: (v) => {
      const r = v as { revision: number; displayName: string };
      if (typeof r?.revision !== 'number' || typeof r.displayName !== 'string') throw new Error('invalid report');
      return r;
    },
    load: async () => ({ revision: current.revision, displayName: current.profile.display_name }),
  });
  const cacheTier = result.tier === 'store' ? 'origin' : result.tier;
  return c.json({ revision: result.value.revision, displayName: result.value.displayName, cacheTier });
});

app.route('/api/uploads', uploadRoutes<Env>(async (request, env) => (await sessionOf(env, request))?.owner_id ?? null));

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
