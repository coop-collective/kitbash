import { expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

const ORIGIN = 'http://localhost';
const PASSWORD = 'local-demo-password';

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${ORIGIN}/api/login`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie')!;
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookie).toMatch(/SameSite=Lax/);
  return cookie.split(';')[0]!;
}

const call = (cookie: string, path: string, init: RequestInit = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, { ...init, headers: { cookie, origin: ORIGIN, ...(init.headers as object) } });

const putProfile = (cookie: string, body: object) =>
  call(cookie, '/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

it('rejects bad credentials and foreign origins', async () => {
  const bad = await SELF.fetch(`${ORIGIN}/api/login`, { method: 'POST', headers: { origin: ORIGIN }, body: JSON.stringify({ email: 'alice@example.test', password: 'nope' }) });
  expect(bad.status).toBe(401);
  for (const origin of [undefined, 'null', 'http://evil.test']) {
    const res = await SELF.fetch(`${ORIGIN}/api/login`, { method: 'POST', headers: origin ? { origin } : {}, body: JSON.stringify({ email: 'alice@example.test', password: PASSWORD }) });
    expect(res.status).toBe(403);
  }
  expect((await SELF.fetch(`${ORIGIN}/api/session`)).status).toBe(401);
});

it('logout revokes the session server-side', async () => {
  const cookie = await login('alice@example.test');
  const session = await call(cookie, '/api/session');
  expect(await session.json()).toMatchObject({ user: { email: 'alice@example.test' } });
  expect((await call(cookie, '/api/logout', { method: 'POST' })).status).toBe(204);
  expect((await call(cookie, '/api/session')).status).toBe(401);
});

it('profile: validation, revisions and stale conflicts', async () => {
  const cookie = await login('alice@example.test');
  const first = await (await call(cookie, '/api/profile')).json() as { revision: number };
  expect(first.revision).toBe(0);
  const base = { handle: 'alice_1', display_name: 'Alice', bio: '', avatar_id: null, is_public: false };
  expect((await putProfile(cookie, { ...base, handle: 'Bad Handle', revision: 0 })).status).toBe(400);
  expect((await putProfile(cookie, { ...base, bio: 'x'.repeat(501), revision: 0 })).status).toBe(400);
  const saved = await putProfile(cookie, { ...base, revision: 0 });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ revision: 1, profile: { display_name: 'Alice' } });
  const stale = await putProfile(cookie, { ...base, display_name: 'Stale', revision: 0 });
  expect(stale.status).toBe(409);
  const now = await (await call(cookie, '/api/profile')).json() as { profile: { display_name: string }; revision: number };
  expect(now).toMatchObject({ revision: 1, profile: { display_name: 'Alice' } });
});

it('uploads are private, bounded and owner-scoped', async () => {
  const alice = await login('alice@example.test');
  const bob = await login('bob@example.test');
  const bytes = new Uint8Array([1, 2, 3, 250, 0, 7]);
  const up = await call(alice, '/api/uploads', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes });
  expect(up.status).toBe(201);
  const { id } = await up.json() as { id: string };
  const got = await call(alice, `/api/uploads/${id}`);
  expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
  expect(got.headers.get('content-disposition')).toMatch(/^attachment/);
  expect(got.headers.get('x-content-type-options')).toBe('nosniff');
  expect(got.headers.get('cache-control')).toMatch(/no-store/);
  expect((await call(bob, `/api/uploads/${id}`)).status).toBe(404);
  await call(bob, `/api/uploads/${id}`, { method: 'DELETE' });
  expect((await call(alice, `/api/uploads/${id}`)).status).toBe(200);
  const big = await call(alice, '/api/uploads', { method: 'POST', body: new Uint8Array(1024 * 1024 + 1) });
  expect(big.status).toBe(413);
  const exact = await call(alice, '/api/uploads', { method: 'POST', body: new Uint8Array(1024 * 1024) });
  expect(exact.status).toBe(201);
  expect((await call(alice, `/api/uploads/${id}`, { method: 'DELETE' })).status).toBe(204);
  expect((await call(alice, `/api/uploads/${id}`)).status).toBe(404);
  expect((await SELF.fetch(`${ORIGIN}/api/uploads/${id}`)).status).toBe(401);
});

it('report is revision-fresh, cached, and tenant-isolated', async () => {
  const alice = await login('alice@example.test');
  const bob = await login('bob@example.test');
  const base = { avatar_id: null, is_public: false, bio: '' };
  // Storage is shared across tests in this file, so start from the current revision.
  const rev = async (cookie: string) => ((await (await call(cookie, '/api/profile')).json()) as { revision: number }).revision;
  const aliceStart = await rev(alice);
  expect((await putProfile(alice, { ...base, handle: 'alice_r', display_name: 'Alice One', revision: aliceStart })).status).toBe(200);
  expect((await putProfile(bob, { ...base, handle: 'bob_r', display_name: 'Bob One', revision: await rev(bob) })).status).toBe(200);
  const r1 = await (await call(alice, '/api/report')).json() as { cacheTier: string; displayName: string; revision: number };
  expect(r1).toMatchObject({ cacheTier: 'origin', displayName: 'Alice One', revision: aliceStart + 1 });
  const r2 = await (await call(alice, '/api/report')).json() as { cacheTier: string };
  expect(['edge', 'kv']).toContain(r2.cacheTier);
  await putProfile(alice, { ...base, handle: 'alice_r', display_name: 'Alice Two', revision: aliceStart + 1 });
  const r3 = await (await call(alice, '/api/report')).json();
  expect(r3).toMatchObject({ cacheTier: 'origin', displayName: 'Alice Two', revision: aliceStart + 2 });
  expect(await (await call(bob, '/api/report')).json()).toMatchObject({ displayName: 'Bob One' });
  expect((await SELF.fetch(`${ORIGIN}/api/report`)).status).toBe(401);
});

it('serves the UI with the automation hooks', async () => {
  const html = await (await SELF.fetch(`${ORIGIN}/`)).text();
  for (const id of ['login-email', 'login-password', 'login-submit', 'profile-handle', 'profile-display-name', 'profile-bio', 'profile-save', 'profile-status', 'upload-file', 'upload-submit', 'upload-download', 'report-refresh', 'report-status', 'logout']) {
    expect(html).toContain(`data-testid="${id}"`);
  }
});
