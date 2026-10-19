import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateway } from '../src/gateway.ts';
const post = (path = '/hash', headers = {}) => new Request(`https://example.com${path}`, { method: 'POST', headers, body: 'hello' });
test('forwards only allowed payload to authenticated tenant, never supplied identity or credentials', async () => {
  let called = 0;
  const response = await gateway(post('/hash', { authorization: 'Bearer test', 'x-tenant-id': 'attacker', cookie: 'private' }), async () => ({ tenantId: 'verified' }), async (tenant, request) => {
    called++; assert.equal(tenant, 'verified'); assert.equal(request.url, 'http://container.internal/hash');
    assert.equal(request.headers.get('authorization'), null); assert.equal(request.headers.get('cookie'), null); assert.equal(request.headers.get('x-tenant-id'), null);
    assert.equal(await request.text(), 'hello'); return new Response('hashed');
  });
  assert.equal(called, 1); assert.equal(await response.text(), 'hashed');
});
test('rejects unauthorized, unexpected paths, upgrade and oversized declared body without a container', async () => {
  const forward = () => { throw new Error('must not call'); };
  for (const [request, session, status] of [
    [post(), null, 401], [post(), {}, 401], [post(), { tenantId: 123 }, 401], [post('/health'), { tenantId: 'ok' }, 404],
    [post('/hash?port=22'), { tenantId: 'ok' }, 404],
    [post('/hash', { upgrade: 'websocket' }), { tenantId: 'ok' }, 400],
    [post('/hash', { 'content-length': '1048577' }), { tenantId: 'ok' }, 413],
  ]) assert.equal((await gateway(request, async () => session, forward)).status, status);
});
test('auth and container failures become explicit 503 responses', async () => {
  assert.equal((await gateway(post(), async () => { throw Error(); }, async () => new Response())).status, 503);
  assert.equal((await gateway(post(), async () => ({ tenantId: 'ok' }), async () => { throw Error(); })).status, 503);
});
