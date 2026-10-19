import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

const BASE = 'http://localhost';
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  SELF.fetch(BASE + path, { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function login(email: string) {
  const r = await post('/api/login', { email, password: 'local-demo-password' });
  expect(r.status).toBe(200);
  const cookie = r.headers.get('Set-Cookie')!;
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Lax');
  return cookie.split(';')[0];
}

const authed = (cookie: string, path: string, init: RequestInit = {}) =>
  SELF.fetch(BASE + path, { ...init, headers: { Origin: BASE, Cookie: cookie, ...(init.headers as object) } });

const profileBody = (revision: number, name = 'Alice') => ({ handle: 'alice_1', display_name: name, bio: 'hi', avatar_id: null, is_public: false, revision });

describe('session', () => {
  it('rejects bad credentials, foreign origins and revoked sessions', async () => {
    expect((await post('/api/login', { email: 'eve@example.test', password: 'local-demo-password' })).status).toBe(401);
    expect((await post('/api/login', { email: 'alice@example.test', password: 'nope' })).status).toBe(401);
    expect((await post('/api/login', { email: 'alice@example.test', password: 'local-demo-password' }, { Origin: 'http://evil.test' })).status).toBe(403);
    expect((await post('/api/login', { email: 'alice@example.test', password: 'local-demo-password' }, { Origin: 'null' })).status).toBe(403);
    const cookie = await login('alice@example.test');
    expect((await authed(cookie, '/api/session')).status).toBe(200);
    expect((await authed(cookie, '/api/logout', { method: 'POST' })).status).toBe(204);
    expect((await authed(cookie, '/api/session')).status).toBe(401);
    expect((await SELF.fetch(BASE + '/api/session', { headers: { Cookie: cookie.replace(/.$/, 'x') } })).status).toBe(401);
  });
});

describe('profile', () => {
  it('enforces bounds and optimistic concurrency', async () => {
    const cookie = await login('bob@example.test');
    const put = (b: unknown) => authed(cookie, '/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    expect(((await (await authed(cookie, '/api/profile')).json()) as any).revision).toBe(0);
    expect((await put({ ...profileBody(0), handle: 'Bad Handle' })).status).toBe(400);
    const ok = (await (await put(profileBody(0, 'First'))).json()) as any;
    expect(ok.revision).toBe(1);
    expect((await put(profileBody(0, 'Stale'))).status).toBe(409);
    const cur = (await (await authed(cookie, '/api/profile')).json()) as any;
    expect(cur.profile.display_name).toBe('First');
  });
});

describe('uploads', () => {
  it('round-trips, isolates owners, bounds size', async () => {
    const a = await login('alice@example.test');
    const b = await login('bob@example.test');
    const bytes = new Uint8Array([0, 1, 2, 255, 254]);
    const up = await authed(a, '/api/uploads', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    expect(up.status).toBe(201);
    const { id } = (await up.json()) as { id: string };
    const dl = await authed(a, `/api/uploads/${id}`);
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(bytes);
    expect(dl.headers.get('Content-Disposition')).toContain('attachment');
    expect(dl.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect((await authed(b, `/api/uploads/${id}`)).status).toBe(404);
    await authed(b, `/api/uploads/${id}`, { method: 'DELETE' });
    expect((await authed(a, `/api/uploads/${id}`)).status).toBe(200);
    expect((await authed(a, '/api/uploads/missing')).status).toBe(404);
    const big = await authed(a, '/api/uploads', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(1024 * 1024 + 1) });
    expect(big.status).toBe(413);
    expect((await authed(a, `/api/uploads/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await authed(a, `/api/uploads/${id}`)).status).toBe(404);
  });
});

describe('report', () => {
  it('is origin first, cached after, and fresh after update', async () => {
    const a = await login('alice@example.test');
    const put = (b: unknown) => authed(a, '/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    const rev = ((await (await authed(a, '/api/profile')).json()) as any).revision as number;
    expect((await put(profileBody(rev, 'Report One'))).status).toBe(200);
    const r1 = (await (await authed(a, '/api/report')).json()) as any;
    expect(r1).toMatchObject({ revision: rev + 1, displayName: 'Report One', cacheTier: 'origin' });
    const r2 = (await (await authed(a, '/api/report')).json()) as any;
    expect(['edge', 'kv']).toContain(r2.cacheTier);
    await put(profileBody(rev + 1, 'Report Two'));
    const r3 = (await (await authed(a, '/api/report')).json()) as any;
    expect(r3).toMatchObject({ revision: rev + 2, displayName: 'Report Two', cacheTier: 'origin' });
    const b = await login('bob@example.test');
    const rb = (await (await authed(b, '/api/report')).json()) as any;
    expect(rb.displayName).not.toBe('Report Two');
  });
});
