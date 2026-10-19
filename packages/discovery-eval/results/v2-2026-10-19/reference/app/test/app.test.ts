import { describe, expect, it } from 'vitest';
import { SELF, env } from 'cloudflare:test';

const ORIGIN = 'http://localhost';
const post = (path: string, init: RequestInit & { cookie?: string } = {}) => {
  const { cookie, ...rest } = init;
  return SELF.fetch(ORIGIN + path, { ...rest, headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}), ...(rest.headers as object) } });
};
async function login(email: string) {
  const res = await post('/api/login', { method: 'POST', body: JSON.stringify({ email, password: 'local-demo-password' }), headers: { 'Content-Type': 'application/json' } });
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie')!;
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookie).toMatch(/SameSite=Lax/);
  return cookie.split(';')[0]!;
}
const json = (cookie: string, method: string, path: string, body?: unknown, origin = ORIGIN) =>
  SELF.fetch(ORIGIN + path, { method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const prof = (handle: string, name: string, revision: number) => ({ handle, display_name: name, bio: '', avatar_id: null, is_public: false, revision });

describe('auth', () => {
  it('rejects bad credentials and unsafe origins', async () => {
    const bad = await post('/api/login', { method: 'POST', body: JSON.stringify({ email: 'eve@example.test', password: 'local-demo-password' }) });
    expect(bad.status).toBe(401);
    for (const origin of [undefined, 'null', 'http://evil.test']) {
      const res = await SELF.fetch(ORIGIN + '/api/login', { method: 'POST', headers: origin ? { Origin: origin } : {}, body: JSON.stringify({ email: 'alice@example.test', password: 'local-demo-password' }) });
      expect(res.status).toBe(403);
    }
  });
  it('session, logout and replay revocation', async () => {
    const cookie = await login('alice@example.test');
    const s = await json(cookie, 'GET', '/api/session');
    expect((await s.json() as any).user.email).toBe('alice@example.test');
    expect((await json(cookie, 'POST', '/api/logout')).status).toBe(204);
    expect((await json(cookie, 'GET', '/api/session')).status).toBe(401);
    expect((await SELF.fetch(ORIGIN + '/api/session')).status).toBe(401);
  });
});

describe('profile', () => {
  it('optimistic concurrency and validation', async () => {
    const c = await login('alice@example.test');
    const first = await (await json(c, 'GET', '/api/profile')).json() as any;
    expect(first.revision).toBe(0);
    const saved = await json(c, 'PUT', '/api/profile', prof('alice_1', 'Alice', 0));
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as any).revision).toBe(1);
    const stale = await json(c, 'PUT', '/api/profile', prof('alice_1', 'Overwrite', 0));
    expect(stale.status).toBe(409);
    expect(((await (await json(c, 'GET', '/api/profile')).json()) as any).profile.display_name).toBe('Alice');
    expect((await json(c, 'PUT', '/api/profile', prof('Bad Handle', 'x', 1))).status).toBe(400);
    expect((await json(c, 'PUT', '/api/profile', prof('alice_1', '', 1))).status).toBe(400);
    expect((await json(c, 'PUT', '/api/profile', { ...prof('alice_1', 'x', 1), bio: 'b'.repeat(501) })).status).toBe(400);
  });
});

describe('uploads', () => {
  it('round trips, isolates owners, enforces limit', async () => {
    const a = await login('alice@example.test');
    const b = await login('bob@example.test');
    const bytes = new Uint8Array([1, 2, 3, 250, 0]);
    const up = await SELF.fetch(ORIGIN + '/api/uploads', { method: 'POST', headers: { Cookie: a, Origin: ORIGIN, 'Content-Type': 'application/octet-stream' }, body: bytes });
    expect(up.status).toBe(201);
    const { id } = await up.json() as { id: string };
    const get = await json(a, 'GET', `/api/uploads/${id}`);
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes);
    expect(get.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(get.headers.get('x-content-type-options')).toBe('nosniff');
    expect(get.headers.get('cache-control')).toMatch(/private/);
    expect((await json(b, 'GET', `/api/uploads/${id}`)).status).toBe(404);
    expect([204, 404]).toContain((await json(b, 'DELETE', `/api/uploads/${id}`)).status);
    expect((await json(a, 'GET', `/api/uploads/${id}`)).status).toBe(200);
    expect((await json(a, 'DELETE', `/api/uploads/${id}`)).status).toBe(204);
    expect((await json(a, 'GET', `/api/uploads/${id}`)).status).toBe(404);

    const max = await SELF.fetch(ORIGIN + '/api/uploads', { method: 'POST', headers: { Cookie: a, Origin: ORIGIN }, body: new Uint8Array(1024 * 1024) });
    expect(max.status).toBe(201);
    const big = await SELF.fetch(ORIGIN + '/api/uploads', { method: 'POST', headers: { Cookie: a, Origin: ORIGIN }, body: new Uint8Array(1024 * 1024 + 1) });
    expect(big.status).toBe(413);
    expect((await env.UPLOADS.list()).objects.length).toBe(1);
  });
});

describe('report', () => {
  it('is revision-fresh and cached', async () => {
    const a = await login('alice@example.test');
    const b = await login('bob@example.test');
    // D1 state is shared across tests in this file, so start from the current revision.
    const base = ((await (await json(a, 'GET', '/api/profile')).json()) as any).revision as number;
    expect((await json(a, 'PUT', '/api/profile', prof('alice_1', 'Alice One', base))).status).toBe(200);
    expect((await json(b, 'PUT', '/api/profile', prof('bob_r', 'Bob One', 0))).status).toBe(200);
    const r1 = await (await json(a, 'GET', '/api/report')).json() as any;
    expect(r1).toEqual({ revision: base + 1, displayName: 'Alice One', cacheTier: 'origin' });
    const r2 = await (await json(a, 'GET', '/api/report')).json() as any;
    expect(['edge', 'kv']).toContain(r2.cacheTier);
    expect(r2.displayName).toBe('Alice One');
    await json(a, 'PUT', '/api/profile', prof('alice_1', 'Alice Two', base + 1));
    const r3 = await (await json(a, 'GET', '/api/report')).json() as any;
    expect(r3).toEqual({ revision: base + 2, displayName: 'Alice Two', cacheTier: 'origin' });
    const rb = await (await json(b, 'GET', '/api/report')).json() as any;
    expect(rb.displayName).toBe('Bob One');
    expect((await SELF.fetch(ORIGIN + '/api/report')).status).toBe(401);
  });
});
