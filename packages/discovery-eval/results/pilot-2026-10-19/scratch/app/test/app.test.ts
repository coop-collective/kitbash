import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

const O = 'http://localhost';
async function login(email = 'alice@example.test') {
  const r = await SELF.fetch(O + '/api/login', { method: 'POST', headers: { Origin: O, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'local-demo-password' }) });
  expect(r.status).toBe(200);
  return r.headers.get('Set-Cookie')!.split(';')[0];
}
const call = (cookie: string, path: string, init: RequestInit = {}) =>
  SELF.fetch(O + path, { ...init, headers: { Origin: O, Cookie: cookie, ...(init.headers as any) } });
const put = (cookie: string, body: any) =>
  call(cookie, '/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar_id: null, is_public: false, bio: '', ...body }) });

describe('auth', () => {
  it('rejects bad creds, bad origins, and revokes on logout', async () => {
    const bad = await SELF.fetch(O + '/api/login', { method: 'POST', headers: { Origin: O }, body: JSON.stringify({ email: 'eve@example.test', password: 'local-demo-password' }) });
    expect(bad.status).toBe(401);
    for (const origin of [undefined, 'null', 'http://evil.test']) {
      const r = await SELF.fetch(O + '/api/login', { method: 'POST', headers: origin ? { Origin: origin } : {}, body: '{}' });
      expect(r.status).toBe(403);
    }
    const res = await SELF.fetch(O + '/api/login', { method: 'POST', headers: { Origin: O }, body: JSON.stringify({ email: 'bob@example.test', password: 'local-demo-password' }) });
    const sc = res.headers.get('Set-Cookie')!;
    expect(sc).toMatch(/HttpOnly/); expect(sc).toMatch(/SameSite=Lax/);
    const cookie = sc.split(';')[0];
    expect((await call(cookie, '/api/session')).status).toBe(200);
    expect((await call(cookie + 'x', '/api/session')).status).toBe(401);
    expect((await call(cookie, '/api/logout', { method: 'POST' })).status).toBe(204);
    expect((await call(cookie, '/api/session')).status).toBe(401);
  });
});

describe('profile + report', () => {
  it('versions, conflicts and cache freshness', async () => {
    const a = await login(), b = await login('bob@example.test');
    expect(await (await call(a, '/api/profile')).json()).toMatchObject({ revision: 0 });
    const r1 = await put(a, { handle: 'alice_1', display_name: 'Alice', revision: 0 });
    expect(await r1.json()).toMatchObject({ revision: 1 });
    expect((await put(a, { handle: 'alice_1', display_name: 'Stale', revision: 0 })).status).toBe(409);
    expect((await put(a, { handle: 'Bad', display_name: 'x', revision: 1 })).status).toBe(400);
    expect(((await (await call(a, '/api/profile')).json()) as any).profile.display_name).toBe('Alice');
    expect(await (await call(a, '/api/report')).json()).toEqual({ revision: 1, displayName: 'Alice', cacheTier: 'origin' });
    expect(((await (await call(a, '/api/report')).json()) as any).cacheTier).toMatch(/edge|kv/);
    await put(a, { handle: 'alice_1', display_name: 'Alice2', revision: 1 });
    expect(await (await call(a, '/api/report')).json()).toEqual({ revision: 2, displayName: 'Alice2', cacheTier: 'origin' });
    expect(await (await call(b, '/api/report')).json()).toEqual({ revision: 0, displayName: '', cacheTier: 'origin' });
  });
});

describe('uploads', () => {
  it('stores privately, isolates owners, bounds size, deletes', async () => {
    const a = await login(), b = await login('bob@example.test');
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const up = await call(a, '/api/uploads', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    expect(up.status).toBe(201);
    const { id } = (await up.json()) as any;
    const g = await call(a, '/api/uploads/' + id);
    expect(new Uint8Array(await g.arrayBuffer())).toEqual(bytes);
    expect(g.headers.get('Content-Disposition')).toMatch(/^attachment/);
    expect(g.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(g.headers.get('Cache-Control')).toMatch(/private/);
    expect((await call(b, '/api/uploads/' + id)).status).toBe(404);
    expect((await call(b, '/api/uploads/' + id, { method: 'DELETE' })).status).toBe(404);
    const big = await call(a, '/api/uploads', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(1024 * 1024 + 1) });
    expect(big.status).toBe(413);
    const max = await call(a, '/api/uploads', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(1024 * 1024) });
    expect(max.status).toBe(201);
    expect((await call(a, '/api/uploads/' + id, { method: 'DELETE' })).status).toBe(204);
    expect((await call(a, '/api/uploads/' + id)).status).toBe(404);
  });
});
