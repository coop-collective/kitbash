import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createBrokerServer } from '../src/server.mjs';
import { createService } from '../src/service.mjs';

const token = 'fixture-mcp-capability-01234567890123456789';
const readerToken = 'fixture-reader-capability-01234567890123456789';
const sentinel = 'provider-secret-never-visible-to-the-agent';
const projectId = '11111111-1111-4111-8111-111111111111';
const base = { project: 'app', target: 'staging' };
const operation = (operation, name) => ({ ...base, operation, ...(name ? { name } : {}) });

async function fixture(t) {
  const secrets = new Map();
  const audit = [];
  let calls = 0;
  let fail = false;
  const policy = {
    version: 1,
    projects: { app: {
      projectId, projectSlug: 'app', domain: 'https://vault.example.test',
      secrets: { SESSION_SECRET: { generate: true, rotation: 'manual' }, APP_CLIENT_SECRET: { generate: false, rotation: 'provider' } },
      targets: { staging: { environment: 'staging', secretPath: '/app', github: {} } },
    } },
    principals: [
      { id: 'grok', tokenSha256: createHash('sha256').update(token).digest('hex'), grants: [{ project: 'app', targets: ['staging'], operations: ['setup', 'status', 'presence', 'generate', 'provision-github'] }] },
      { id: 'reader', tokenSha256: createHash('sha256').update(readerToken).digest('hex'), grants: [{ project: 'app', targets: ['staging'], operations: ['status', 'presence'] }] },
    ],
  };
  const row = (name, value) => ({ secretKey: name, secretValue: value, workspace: projectId, environment: 'staging', secretPath: '/app', type: 'shared' });
  const store = { data: { version: 1, entries: {} }, save: async () => {} };
  const service = createService(policy, store, {
    providers: async () => { calls++; return { infisical: async (endpoint, options) => {
      if (fail) throw new Error(sentinel);
      if (options.method === 'POST') {
        const name = endpoint.split('/').at(-1);
        secrets.set(name, options.body.secretValue);
        return { secret: row(name, options.body.secretValue), token: sentinel };
      }
      assert.equal(options.query.viewSecretValue, 'false');
      return { secrets: [...secrets].map(([name, value]) => row(name, value)), token: sentinel };
    } }; },
    scopeProvision: async () => {}, credentialsProvision: async () => ({}),
    githubProvision: async () => ({ status: 'configured', token: sentinel }),
  });
  const server = createBrokerServer(service, { audit: event => audit.push(event) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  const connect = async (bearer = token) => {
    const client = new Client({ name: 'gorkbot-fixture', version: '1.0.0' });
    t.after(() => client.close());
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${bearer}` } } }));
    return client;
  };
  return { connect, url, audit, secrets, store, calls: () => calls, fail: () => { fail = true; } };
}

test('remote connector discovers and runs secrets operations without plugin env or a local vault login', async t => {
  const f = await fixture(t);
  const client = await f.connect();
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(tool => tool.name), ['kitbash_secrets']);
  const results = [];
  const call = async input => {
    const result = await client.callTool({ name: 'kitbash_secrets', arguments: input });
    results.push(result);
    assert.equal(result.isError === true, false);
    return result.structuredContent;
  };
  assert.equal((await call(operation('presence', 'SESSION_SECRET'))).status, 'missing');
  assert.equal((await call(operation('generate', 'SESSION_SECRET'))).status, 'created');
  assert.equal((await call(operation('generate', 'SESSION_SECRET'))).status, 'already-exists');
  assert.equal((await call(operation('presence', 'SESSION_SECRET'))).status, 'present');
  assert.equal((await call(operation('setup'))).status, 'pending');
  assert.equal((await call(operation('provision-github'))).github.configured, true);
  const status = await call(operation('status'));
  assert.deepEqual(status.secrets, [{ name: 'SESSION_SECRET', status: 'present' }, { name: 'APP_CLIENT_SECRET', status: 'missing' }]);
  const visible = JSON.stringify({ listed, results, audit: f.audit, state: f.store.data });
  for (const secret of [token, readerToken, sentinel, ...f.secrets.values()]) assert.equal(visible.includes(secret), false);
});

test('discovery requires a valid capability and rejects browser origins before doing provider work', async t => {
  const f = await fixture(t);
  for (const headers of [ {}, { authorization: 'Bearer invalid' }, { authorization: `Bearer ${'x'.repeat(40)}` }, { authorization: `Bearer ${token}`, origin: 'https://untrusted.example.test' } ]) {
    const response = await fetch(f.url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: { code: 'forbidden' } });
  }
  for (const method of ['GET', 'DELETE']) {
    const response = await fetch(f.url, { method, headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 405);
  }
  assert.equal(f.calls(), 0);
});

test('MCP enforces scope on each request and never forwards invalid arguments or provider errors', async t => {
  const f = await fixture(t);
  const writer = await f.connect();
  const reader = await f.connect(readerToken);
  const cases = [
    [reader, operation('generate', 'SESSION_SECRET')],
    [writer, { ...operation('status'), target: 'production' }],
    [writer, operation('presence', 'UNREGISTERED_SECRET')],
    [writer, { ...operation('status'), [sentinel]: sentinel }],
    [writer, operation('generate', 'APP_CLIENT_SECRET')],
  ];
  for (const [client, input] of cases) {
    const response = await client.callTool({ name: 'kitbash_secrets', arguments: input });
    assert.equal(response.isError, true);
    assert.equal(JSON.stringify(response).includes(sentinel), false);
  }
  assert.equal(f.secrets.size, 0);
  f.fail();
  const failed = await writer.callTool({ name: 'kitbash_secrets', arguments: operation('status') });
  assert.equal(failed.isError, true);
  assert.deepEqual(JSON.parse(failed.content[0].text), { error: { code: 'provider_failed' } });
  assert.equal(JSON.stringify(f.audit).includes(sentinel), false);
});

test('2025 MCP clients can initialize and call tools over the same authenticated endpoint', async t => {
  const f = await fixture(t);
  async function post(body) {
    const response = await fetch(f.url, { method: 'POST', headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25',
    }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    const text = await response.text();
    return JSON.parse(text.startsWith('event:') ? text.split('\n').find(line => line.startsWith('data: ')).slice(6) : text);
  }
  const initialized = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy-grok', version: '1.0.0' } } });
  assert.equal(initialized.result.serverInfo.name, 'kitbash-secrets');
  const reply = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'kitbash_secrets', arguments: operation('status') } });
  assert.equal(reply.result.structuredContent.status, 'ready');
});
