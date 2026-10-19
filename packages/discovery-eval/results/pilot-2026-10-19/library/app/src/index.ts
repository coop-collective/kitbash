import { Hono } from 'hono';
import { createSession, destroySession, readSession, sameOriginMutation } from './lib/session-cookie/session';
import { getProfile, saveProfile } from './lib/member-profiles/profiles';
import { uploadRoutes } from './lib/r2-private-uploads/routes';
import { MAX_UPLOAD_BYTES } from './lib/r2-private-uploads/uploads';

const USERS: Record<string, { id: string; email: string }> = {
  'alice@example.test': { id: 'user_alice', email: 'alice@example.test' },
  'bob@example.test': { id: 'user_bob', email: 'bob@example.test' },
};
const DEMO_PASSWORD = 'local-demo-password';
const REPORT_TTL = 300;

type Vars = { owner: string };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

const ownerOf = async (env: Env, req: Request) => (await readSession(env, req))?.owner_id ?? null;
const jsonBody = async (req: Request): Promise<unknown> => {
  if (req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return undefined;
  try { return JSON.parse(await req.text()); } catch { return undefined; }
};
const bad = (c: any, status: number, error: string) => c.json({ error }, status);

app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  if (!sameOriginMutation(c.req.raw)) return c.json({ error: 'same-origin Origin required' }, 403);
  await next();
});

app.get('/api/health', c => c.json({ ok: true }));

app.post('/api/login', async c => {
  if (c.env.ENVIRONMENT !== 'dev') return bad(c, 403, 'demo login disabled');
  const body = await jsonBody(c.req.raw) as any;
  if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') return bad(c, 400, 'invalid body');
  const user = Object.hasOwn(USERS, body.email) ? USERS[body.email] : undefined;
  if (!user || body.password !== DEMO_PASSWORD) return bad(c, 401, 'invalid credentials');
  const { setCookie } = await createSession(c.env, user.id, c.req.raw);
  c.header('Set-Cookie', setCookie);
  return c.json({ user });
});

app.get('/api/session', async c => {
  const owner = await ownerOf(c.env, c.req.raw);
  const user = Object.values(USERS).find(u => u.id === owner);
  return user ? c.json({ user }) : bad(c, 401, 'unauthorized');
});

app.post('/api/logout', async c => {
  if (!await ownerOf(c.env, c.req.raw)) return bad(c, 401, 'unauthorized');
  c.header('Set-Cookie', await destroySession(c.env, c.req.raw));
  return c.body(null, 204);
});

const requireOwner = async (c: any, next: () => Promise<void>) => {
  const owner = await ownerOf(c.env, c.req.raw);
  if (!owner) return c.json({ error: 'unauthorized' }, 401);
  c.set('owner', owner);
  await next();
};
app.use('/api/profile', requireOwner);
app.use('/api/report', requireOwner);

const EMPTY = { handle: '', display_name: '', bio: '', avatar_id: null, is_public: false };
const view = (p: any) => ({ handle: p.handle, display_name: p.display_name, bio: p.bio, avatar_id: p.avatar_id, is_public: p.is_public });

app.get('/api/profile', async c => {
  const p = await getProfile(c.env, c.get('owner'));
  return c.json({ profile: p ? view(p) : EMPTY, revision: p?.revision ?? 0 });
});

app.put('/api/profile', async c => {
  const raw = c.req.raw;
  if (Number(raw.headers.get('content-length')) > 8192) return bad(c, 413, 'body too large');
  const body = await jsonBody(raw);
  if (body === undefined) return bad(c, 400, 'invalid json');
  const r = await saveProfile(c.env, c.get('owner'), body);
  if (!r.ok) return bad(c, r.error === 'conflict' ? 409 : 400, r.error);
  return c.json({ profile: view(r.profile), revision: r.profile.revision });
});

app.use('/api/uploads', requireOwner);
app.use('/api/uploads/*', requireOwner);
app.use('/api/uploads', async (c, next) => {
  if (c.req.method === 'POST' && c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/octet-stream') return bad(c, 415, 'octet-stream required');
  await next();
});
app.route('/api/uploads', uploadRoutes<Env>((req, env) => ownerOf(env, req)));
void MAX_UPLOAD_BYTES;

const hex = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), b => b.toString(16).padStart(2, '0')).join('');

app.get('/api/report', async c => {
  const owner = c.get('owner');
  // Authoritative revision first; cache entries are keyed by tenant + revision.
  const p = await getProfile(c.env, owner);
  const revision = p?.revision ?? 0;
  const key = `report/v1/${await hex(owner)}/${revision}`;
  const edgeKey = new Request(`https://report-cache.invalid/${key}`);
  const valid = (v: any) => v && v.revision === revision && typeof v.displayName === 'string';
  try {
    const hit = await caches.default.match(edgeKey);
    if (hit) { const v: any = await hit.json(); if (valid(v)) return c.json({ revision, displayName: v.displayName, cacheTier: 'edge' }); }
  } catch {}
  try {
    const v: any = await c.env.RESULT_CACHE?.get(key, 'json');
    if (valid(v)) {
      try { await caches.default.put(edgeKey, Response.json(v, { headers: { 'Cache-Control': `max-age=${REPORT_TTL}` } })); } catch {}
      return c.json({ revision, displayName: (v as any).displayName, cacheTier: 'kv' });
    }
  } catch {}
  const report = { revision, displayName: p?.display_name ?? '' };
  try { await c.env.RESULT_CACHE?.put(key, JSON.stringify(report), { expirationTtl: REPORT_TTL }); } catch {}
  try { await caches.default.put(edgeKey, Response.json(report, { headers: { 'Cache-Control': `max-age=${REPORT_TTL}` } })); } catch {}
  return c.json({ ...report, cacheTier: 'origin' });
});

app.all('*', c => c.env.ASSETS.fetch(c.req.raw));
export default app;
