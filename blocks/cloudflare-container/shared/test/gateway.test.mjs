import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateway } from '{{paths.lib|rel}}/cloudflare-container/gateway.ts';
const post = (headers = {}, body = 'hello', pathname = '{{kit.routePath}}') => new Request(`https://example.com${pathname}`, { method: 'POST', headers, body, duplex: 'half' });
test('forwards bounded input only to the authorized tenant, with no caller credentials', async () => {
  const response = await gateway(post({ authorization: 'Bearer test', cookie: 'private', 'x-tenant-id': 'evil' }), async () => ({ tenantId: 'verified' }), async (tenant, request) => {
    assert.equal(tenant, 'verified'); assert.equal(request.url, 'http://container.internal/hash');
    assert.equal(request.headers.get('authorization'), null); assert.equal(request.headers.get('cookie'), null);
    assert.equal(request.headers.get('x-tenant-id'), null); assert.equal(await request.text(), 'hello');
    return new Response('{"bytes":5}', { headers: { 'set-cookie': 'bad', 'x-internal': 'private' } });
  });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('x-internal'), null);
});
test('rejects untrusted routing, unauthenticated calls and declared oversize before forwarding', async () => {
  const forward = () => { throw Error('must not forward'); };
  for (const [request, session, status] of [
    [post(), null, 401], [post(), { tenantId: 5 }, 401], [post(), { tenantId: '../admin' }, 401],
    [post({}, 'x', '/health'), { tenantId: 'ok' }, 404],
    [post({}, 'x', '{{kit.routePath}}?port=22'), { tenantId: 'ok' }, 404],
    [post({ upgrade: 'websocket' }), { tenantId: 'ok' }, 400],
    [post({ 'content-length': '1048577' }), { tenantId: 'ok' }, 413],
    [new Request('https://example.com{{kit.routePath}}'), { tenantId: 'ok' }, 405],
  ]) assert.equal((await gateway(request, async () => session, forward)).status, status);
});
test('bounds actual chunked bytes even with no content-length', async () => {
  let forwarded = false;
  const response = await gateway(post({}, new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1_048_576)); c.enqueue(new Uint8Array(1)); c.close(); } })), async () => ({ tenantId: 'ok' }), async () => { forwarded = true; return new Response(); });
  assert.equal(response.status, 413); assert.equal(forwarded, false);
});
test('accepts the byte boundary and translates unavailable dependencies', async () => {
  const response = await gateway(post({}, new Uint8Array(1_048_576)), async () => ({ tenantId: 'ok' }), async (_tenant, req) => {
    assert.equal((await req.arrayBuffer()).byteLength, 1_048_576); return new Response('{}');
  });
  assert.equal(response.status, 200);
  assert.equal((await gateway(post(), async () => { throw Error(); }, async () => new Response())).status, 503);
  assert.equal((await gateway(post(), async () => ({ tenantId: 'ok' }), async () => { throw Error(); })).status, 503);
});
test('accepts fragmented uploads without retaining one allocation per chunk', async () => {
  let sent = 0;
  const stream = new ReadableStream({ pull(controller) {
    if (sent === 8192) { controller.close(); return; }
    controller.enqueue(Uint8Array.of(sent++ % 256));
  } });
  const response = await gateway(post({}, stream), async () => ({ tenantId: 'ok' }), async (_tenant, request) => {
    const received = new Uint8Array(await request.arrayBuffer());
    assert.equal(received.length, 8192);
    for (let i = 0; i < received.length; i++) assert.equal(received[i], i % 256);
    return new Response('{}');
  });
  assert.equal(response.status, 200);
});
