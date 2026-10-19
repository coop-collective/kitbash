import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const O = 'http://localhost';
const hdr = (cookie?: string, extra: Record<string, string> = {}) => ({ origin: O, ...(cookie ? { cookie } : {}), ...extra });
async function login(email = 'alice@example.test') {
  const r = await SELF.fetch(`${O}/api/login`, { method: 'POST', headers: hdr(undefined, { 'content-type': 'application/json' }), body: JSON.stringify({ email, password: 'local-demo-password' }) });
  expect(r.status).toBe(200);
  const sc = r.headers.get('set-cookie')!;
  expect(sc).toMatch(/HttpOnly/); expect(sc).toMatch(/SameSite=Lax/);
  return sc.split(';')[0]!;
}
const profile = (cookie: string, body: object) => SELF.fetch(`${O}/api/profile`, { method: 'PUT', headers: hdr(cookie, { 'content-type': 'application/json' }), body: JSON.stringify(body) });
const p = (handle: string, revision: number, display_name = 'Name') => ({ handle, display_name, bio: '', avatar_id: null, is_public: false, revision });

describe('session', () => {
  it('rejects bad login, foreign origins; logout revokes', async () => {
    const bad = await SELF.fetch(`${O}/api/login`, { method: 'POST', headers: hdr(undefined, { 'content-type': 'application/json' }), body: JSON.stringify({ email: 'eve@example.test', password: 'local-demo-password' }) });
    expect(bad.status).toBe(401);
    for (const origin of [undefined, 'null', 'https://evil.test']) {
      const r = await SELF.fetch(`${O}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: '{}' });
      expect(r.status).toBe(403);
    }
    const c = await login();
    expect((await SELF.fetch(`${O}/api/session`, { headers: { cookie: c } })).status).toBe(200);
    expect((await SELF.fetch(`${O}/api/logout`, { method: 'POST', headers: hdr(c) })).status).toBe(204);
    expect((await SELF.fetch(`${O}/api/session`, { headers: { cookie: c } })).status).toBe(401);
    expect((await SELF.fetch(`${O}/api/session`)).status).toBe(401);
  });
});

describe('profile + report', () => {
  it('validates, enforces revisions, and keeps the report fresh and isolated', async () => {
    const a = await login(), b = await login('bob@example.test');
    const get = async (c: string) => (await SELF.fetch(`${O}/api/profile`, { headers: { cookie: c } })).json() as Promise<any>;
    expect((await get(a)).revision).toBe(0);
    for (const bad of [p('ab', 0), p('Upper', 0), p('x'.repeat(31), 0), p('okay', 0, ''), { ...p('okay', 0), bio: 'x'.repeat(501) }]) expect((await profile(a, bad)).status).toBe(400);
    const r1 = await profile(a, p('alice_1', 0, 'Alice')); expect(r1.status).toBe(200);
    expect((await r1.json() as any).revision).toBe(1);
    expect((await profile(a, p('alice_1', 0, 'Stale'))).status).toBe(409);
    expect((await get(a)).profile.display_name).toBe('Alice');
    await profile(b, p('bob_1', 0, 'Bob'));
    const rep = async (c: string) => (await SELF.fetch(`${O}/api/report`, { headers: { cookie: c } })).json() as Promise<any>;
    expect(await rep(a)).toEqual({ revision: 1, displayName: 'Alice', cacheTier: 'origin' });
    expect(['edge', 'kv']).toContain((await rep(a)).cacheTier);
    expect((await rep(b)).displayName).toBe('Bob');
    await profile(a, p('alice_1', 1, 'Alice 2'));
    expect(await rep(a)).toEqual({ revision: 2, displayName: 'Alice 2', cacheTier: 'origin' });
    expect((await SELF.fetch(`${O}/api/report`)).status).toBe(401);
  });
});

describe('uploads', () => {
  it('stores privately, isolates owners, bounds size, deletes', async () => {
    const a = await login(), b = await login('bob@example.test');
    const up = (c: string, body: BodyInit, type = 'application/octet-stream') => SELF.fetch(`${O}/api/uploads`, { method: 'POST', headers: hdr(c, { 'content-type': type }), body });
    const bytes = new Uint8Array([1, 2, 3, 250]);
    const r = await up(a, bytes); expect(r.status).toBe(201);
    const { id } = await r.json() as any;
    const g = await SELF.fetch(`${O}/api/uploads/${id}`, { headers: { cookie: a } });
    expect(new Uint8Array(await g.arrayBuffer())).toEqual(bytes);
    expect(g.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(g.headers.get('x-content-type-options')).toBe('nosniff');
    expect(g.headers.get('cache-control')).toMatch(/no-store/);
    expect((await SELF.fetch(`${O}/api/uploads/${id}`, { headers: { cookie: b } })).status).toBe(404);
    await SELF.fetch(`${O}/api/uploads/${id}`, { method: 'DELETE', headers: hdr(b) });
    expect((await SELF.fetch(`${O}/api/uploads/${id}`, { headers: { cookie: a } })).status).toBe(200);
    expect((await up(a, new Uint8Array(1048577))).status).toBe(413);
    expect((await up(a, new Uint8Array(1048576))).status).toBe(201);
    expect((await up(a, 'x', 'text/plain')).status).toBe(415);
    expect((await SELF.fetch(`${O}/api/uploads`, { method: 'POST', headers: { cookie: a, 'content-type': 'application/octet-stream' }, body: 'x' })).status).toBe(403);
    expect((await SELF.fetch(`${O}/api/uploads/${id}`, { method: 'DELETE', headers: hdr(a) })).status).toBe(204);
    expect((await SELF.fetch(`${O}/api/uploads/${id}`, { headers: { cookie: a } })).status).toBe(404);
    expect((await SELF.fetch(`${O}/api/uploads/${id}`)).status).toBe(401);
    void env;
  });
});
