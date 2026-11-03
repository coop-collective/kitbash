import { env, exports } from 'cloudflare:workers';
import { runInDurableObject, evictDurableObject } from 'cloudflare:test';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { openDelivery } from '../src/sealed-delivery.mjs';
import { createHash } from 'node:crypto';

const project = 'engine-box-runners';
const origin = 'https://broker.example.test';
const policy = JSON.parse(env.KIT_BROKER_POLICY);
const projectId = policy.projects[project].projectId;
const metadata = (name, environment = 'staging') => ({ secretKey: name, workspace: projectId, environment, secretPath: '/app', type: 'shared' });
const stub = target => env.BROKER_STATE.getByName(`${project}:${target}`);
const headers = { authorization: `Bearer ${env.TEST_TOKEN}`, 'content-type': 'application/json' };
const call = (operation, extra = {}) => exports.default.fetch(`${origin}/v1/operations`, { method: 'POST', headers, body: JSON.stringify({ operation, project, target: 'staging', ...extra }) });
const replies = [];
const reply = (origin, route, method, status, body) => replies.push({ origin, route, method, status, body });
const list = (rows = []) => reply('https://vault.example.test', /^\/api\/v4\/secrets\?/, 'GET', 200, { secrets: rows });

beforeEach(async () => {
  for (const name of [`${project}:staging`, `${project}:production`, 'cloudflare-app:staging',
    'registered:grok-bot:enginebox:staging', 'registered:grok-bot:enginebox:production']) {
    const instance = env.BROKER_STATE.getByName(name);
    await runInDurableObject(instance, async (_instance, state) => state.storage.deleteAll());
    await evictDurableObject(instance);
  }
  replies.length = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    // Validate real workerd Request options before returning a mocked provider
    // response. Mocking fetch alone used to hide unsupported redirect modes.
    new Request(input, options);
    const expected = replies.shift();
    if (!expected) throw new Error('Unexpected outbound request');
    const url = new URL(input);
    expect(url.origin).toBe(expected.origin);
    expect(url.pathname + url.search).toMatch(expected.route);
    expect(options.method).toBe(expected.method);
    expect(options.redirect).toBe('manual');
    return Response.json(expected.body, { status: expected.status });
  });
});
afterEach(() => { vi.restoreAllMocks(); expect(replies).toHaveLength(0); });

test('Worker requires the configured host and bearer; MCP discovery and tool calls work across RPC', async () => {
  expect((await exports.default.fetch(`${origin}/health`)).status).toBe(403);
  expect((await exports.default.fetch('https://wrong.example.test/health', { headers })).status).toBe(403);
  expect(await (await exports.default.fetch(`${origin}/health`, { headers })).json()).toEqual({ status: 'ready' });
  const client = new Client({ name: 'worker-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    fetch: (url, options) => exports.default.fetch(url, options), requestInit: { headers: { authorization: `Bearer ${env.TEST_TOKEN}` } },
  }));
  expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['kitbash_secrets', 'kitbash_register_secrets', 'kitbash_upload_secrets', 'kitbash_secret_deliveries']);
  list();
  const result = await client.callTool({ name: 'kitbash_secrets', arguments: { operation: 'status', project, target: 'staging' } });
  expect(result.structuredContent.status).toBe('ready');
  expect(JSON.stringify(result)).not.toContain(env.TEST_TOKEN);
  await client.close();
});

test('MCP self-registration persists, isolates targets, and enables generation without policy edits', async () => {
  const client = new Client({ name: 'registration-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    fetch: (url, options) => exports.default.fetch(url, options), requestInit: { headers: { authorization: `Bearer ${env.TEST_TOKEN}` } },
  }));
  try {
    const name = 'ENGINEBOX_GITHUB_RUNNERS_WEBHOOK_SECRET';
    const registration = { project: 'enginebox', target: 'staging', secrets: [{ name, generate: true }] };
    const register = input => client.callTool({ name: 'kitbash_register_secrets', arguments: input });
    expect((await call('status', { project: 'enginebox' })).status).toBe(403);
    const result = await register(registration);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.status).toBe('registered');
    const binding = result.structuredContent.bindings[0];
    expect(binding.binding).toBe(name);
    const registeredStub = env.BROKER_STATE.getByName('registered:grok-bot:enginebox:staging');
    await evictDurableObject(registeredStub);
    expect((await register(registration)).structuredContent.status).toBe('already-registered');
    const scope = policy.principals[0].registration;
    const endpoint = `/client/v4/accounts/${scope.accountId}/secrets_store/stores/${scope.storeId}/secrets`;
    const rows = [];
    const names = () => reply('https://api.cloudflare.com', new RegExp(endpoint + '\\?'), 'GET', 200, { success: true, result: [...rows] });
    names();
    expect((await (await call('status', { project: 'enginebox' })).json()).secrets).toEqual([{ name, status: 'missing' }]);
    names();
    expect((await (await call('presence', { project: 'enginebox', name })).json()).status).toBe('missing');
    names();
    rows.push({ id: 'd'.repeat(32), store_id: scope.storeId, name: binding.secret_name, status: 'active' });
    reply('https://api.cloudflare.com', endpoint, 'POST', 200, { success: true, result: rows });
    names();
    expect((await (await call('generate', { project: 'enginebox', name })).json()).status).toBe('created');
    await evictDurableObject(registeredStub);
    names();
    expect((await (await call('generate', { project: 'enginebox', name })).json()).status).toBe('already-exists');
    const production = await register({ ...registration, target: 'production' });
    expect(production.structuredContent.bindings[0].secret_name).not.toBe(binding.secret_name);
    const addition = await register({ ...registration, secrets: [{ name: 'ENGINEBOX_CLIENT_SECRET', generate: false }] });
    expect(addition.structuredContent.secrets).toHaveLength(2);
    expect((await call('generate', { project: 'enginebox', name: 'ENGINEBOX_CLIENT_SECRET' })).status).toBe(403);
    const persisted = await runInDurableObject(registeredStub, async (_instance, state) => [...await state.storage.list()]);
    for (const secret of [env.TEST_TOKEN, env.KIT_BROKER_SECRETS_API_TOKEN]) expect(JSON.stringify(persisted)).not.toContain(secret);
    expect(JSON.stringify(persisted)).toContain(name);
  } finally { await client.close(); }
});

test('registration rejects secret values, authority changes, static aliases, and unprivileged callers', async () => {
  const client = new Client({ name: 'registration-denials', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    fetch: (url, options) => exports.default.fetch(url, options), requestInit: { headers: { authorization: `Bearer ${env.TEST_TOKEN}` } },
  }));
  const sentinel = 'untrusted-value-must-not-appear';
  const input = { project: 'enginebox', target: 'staging', secrets: [{ name: 'SESSION_SECRET', generate: true }] };
  try {
    for (const invalid of [
      { ...input, accountId: sentinel }, { ...input, target: 'local' }, { ...input, project },
      { ...input, secrets: [{ name: 'KIT_BROKER_TOKEN_SHA256', generate: true }] },
      { ...input, secrets: [{ ...input.secrets[0], value: sentinel }] },
    ]) {
      const response = await client.callTool({ name: 'kitbash_register_secrets', arguments: invalid });
      expect(response.isError).toBe(true);
      expect(JSON.stringify(response)).not.toContain(sentinel);
    }
    const registered = await client.callTool({ name: 'kitbash_register_secrets', arguments: input });
    expect(registered.structuredContent.status).toBe('registered');
    const changed = await client.callTool({ name: 'kitbash_register_secrets', arguments: { ...input, secrets: [{ ...input.secrets[0], bytes: 64 }] } });
    expect(JSON.parse(changed.content[0].text)).toEqual({ error: { code: 'conflict' } });
    const other = new Client({ name: 'reader', version: '1' });
    await other.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      fetch: (url, options) => exports.default.fetch(url, options), requestInit: { headers: { authorization: `Bearer ${env.TEST_READER_TOKEN}` } },
    }));
    try {
      const denied = await other.callTool({ name: 'kitbash_register_secrets', arguments: input });
      expect(JSON.parse(denied.content[0].text)).toEqual({ error: { code: 'forbidden' } });
    } finally { await other.close(); }
    expect((await call('provision-github-app', { project: 'enginebox' })).status).toBe(403);
  } finally { await client.close(); }
});

test('concurrent registration additions survive eviction without losing names', async () => {
  const registeredStub = env.BROKER_STATE.getByName('registered:grok-bot:enginebox:staging');
  const input = { project: 'enginebox', target: 'staging', secrets: [] };
  const results = await Promise.all(['FIRST_SECRET', 'SECOND_SECRET'].map(name =>
    registeredStub.register({ ...input, secrets: [{ name, generate: true }] }, env.TEST_TOKEN)));
  try { for (const result of results) expect(result.value.status).toBe('registered'); }
  finally { for (const result of results) result[Symbol.dispose]?.(); }
  await evictDurableObject(registeredStub);
  const result = await registeredStub.register(input, env.TEST_TOKEN);
  try { expect(result.value.secrets.map(row => row.name).sort()).toEqual(['FIRST_SECRET', 'SECOND_SECRET']); }
  finally { result[Symbol.dispose]?.(); }
});

test('uncertain generation persists across eviction and remains isolated by target', async () => {
  list();
  reply('https://vault.example.test', '/api/v4/secrets/SESSION_SECRET', 'POST', 500, { secret: 'provider-secret' });
  const failed = await call('generate', { name: 'SESSION_SECRET' });
  expect(failed.status).toBe(502);
  await failed.text();
  await evictDurableObject(stub('staging'));
  list();
  expect(await (await call('generate', { name: 'SESSION_SECRET' })).json()).toEqual({ error: { code: 'conflict' } });
  const checkpoint = await runInDurableObject(stub('staging'), async (_instance, state) => state.storage.get('checkpoints'));
  expect(JSON.stringify(checkpoint)).toContain('pending');
  expect(JSON.stringify(checkpoint)).not.toContain('provider-secret');
  list();
  reply('https://vault.example.test', '/api/v4/secrets/SESSION_SECRET', 'POST', 200, { secret: metadata('SESSION_SECRET', 'production') });
  list([metadata('SESSION_SECRET', 'production')]);
  expect((await (await call('generate', { name: 'SESSION_SECRET', target: 'production' })).json()).status).toBe('created');
});

test('GitHub browser capabilities survive eviction; credential conversion stays inside the broker and cannot replay', async () => {
  reply('https://vault.example.test', `/api/v1/projects/${projectId}/environments/slug/staging`, 'GET', 200, { environment: { id: 'env-staging', projectId, slug: 'staging' } });
  reply('https://vault.example.test', /^\/api\/v2\/folders\?/, 'GET', 200, { folders: [{ name: 'app', envId: 'env-staging' }] });
  list();
  const pending = await (await call('provision-github-app')).json();
  expect(pending.approvalUrl).toMatch(/\/github-app\/engine-box-runners\/staging\/start\//);
  await evictDurableObject(stub('staging'));
  const preview = await exports.default.fetch(pending.approvalUrl);
  expect(preview.status).toBe(200);
  await preview.text();
  const page = await exports.default.fetch(pending.approvalUrl, { method: 'POST', headers: { origin } });
  expect(page.status).toBe(200);
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const html = await page.text();
  const state = /\?state=([A-Za-z0-9_-]+)/.exec(html)[1];
  const callback = `${origin}/github-app/${project}/staging/callback?state=${state}&code=test-code`;
  await evictDurableObject(stub('staging'));
  list();
  reply('https://api.github.com', '/app-manifests/test-code/conversions', 'POST', 200, {
    id: 42, client_id: 'client-id', client_secret: 'private-client-secret', webhook_secret: 'private-webhook-secret', pem: env.TEST_PEM,
    owner: { login: 'your-org', type: 'Organization' }, permissions: { metadata: 'read', contents: 'read' }, events: ['push'],
  });
  const names = Object.values(policy.projects[project].targets.staging.githubApp.secrets);
  reply('https://vault.example.test', '/api/v4/secrets/batch', 'POST', 200, { secrets: names.map(name => metadata(name)) });
  list(names.map(name => metadata(name)));
  const result = await exports.default.fetch(callback, { headers: { cookie }, redirect: 'manual' });
  expect(result.status).toBe(303);
  const storage = await runInDurableObject(stub('staging'), async (_instance, state) => [...await state.storage.list()]);
  for (const secret of [env.TEST_PEM, 'private-client-secret', 'private-webhook-secret', 'test-code']) expect(JSON.stringify(storage)).not.toContain(secret);
  await evictDurableObject(stub('staging'));
  expect((await exports.default.fetch(callback, { headers: { cookie }, redirect: 'manual' })).status).toBe(403);
});

test('Cloudflare storage operates through the Worker and durable coordinator without an Infisical request', async () => {
  const scope = policy.projects['cloudflare-app'];
  const endpoint = `/client/v4/accounts/${scope.accountId}/secrets_store/stores/${scope.storeId}/secrets`;
  const row = { id: 'c'.repeat(32), store_id: scope.storeId, name: 'CLOUDFLARE_APP_STAGING_SESSION_SECRET', status: 'active' };
  reply('https://api.cloudflare.com', new RegExp(endpoint + '\\?'), 'GET', 200, { success: true, result: [] });
  reply('https://api.cloudflare.com', endpoint, 'POST', 200, { success: true, result: [{ ...row, status: 'pending' }] });
  reply('https://api.cloudflare.com', new RegExp(endpoint + '\\?'), 'GET', 200, { success: true, result: [row] });
  const result = await call('generate', { project: 'cloudflare-app', name: 'SESSION_SECRET' });
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ operation: 'generate', project: 'cloudflare-app', target: 'staging', name: 'SESSION_SECRET', status: 'created' });
  const cloudflareStub = env.BROKER_STATE.getByName('cloudflare-app:staging');
  const saved = await runInDurableObject(cloudflareStub, async (_instance, state) => state.storage.get('checkpoints'));
  expect(JSON.stringify(saved)).not.toContain(env.KIT_BROKER_SECRETS_API_TOKEN);
});

test('generic MCP upload and encrypted controller delivery work across Worker RPC and eviction', async () => {
  const integration = JSON.parse(env.KIT_BROKER_INTEGRATIONS)['enginebox-runners'];
  const registeredStub = env.BROKER_STATE.getByName('registered:grok-bot:enginebox:production');
  const registered = await registeredStub.register({ project: 'enginebox', target: 'production', secrets: Object.entries(integration.names).map(([field, name]) => ({ name, generate: field === 'webhookSecret' })) }, env.TEST_TOKEN);
  const bindings = registered.value.bindings;
  registered[Symbol.dispose]?.();
  const scope = policy.principals[0].registration;
  const endpoint = `/client/v4/accounts/${scope.accountId}/secrets_store/stores/${scope.storeId}/secrets`;
  const rows = bindings.map((binding, i) => ({ id: String(i + 1).repeat(32), store_id: scope.storeId, name: binding.secret_name, status: 'active' }));
  const webhook = 'fixture-webhook-never-return-to-mcp-0123456789';
  const clientSecret = 'fixture-client-never-return-to-mcp';
  const names = count => reply('https://api.cloudflare.com', new RegExp(endpoint + '\\?'), 'GET', 200, { success: true, result: count === 1 ? [rows[2]] : rows });
  const client = new Client({ name: 'import-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    fetch: (url, options) => exports.default.fetch(url, options), requestInit: { headers: { authorization: `Bearer ${env.TEST_TOKEN}` } },
  }));
  try {
    names(1);
    const started = await client.callTool({ name: 'kitbash_upload_secrets', arguments: { operation: 'begin', project: 'enginebox', target: 'production',
      names: ['APP_CLIENT_SECRET', 'APP_PRIVATE_KEY'], delivery: 'enginebox-runners', metadata: { clientId: 'Iv1.fixture' } } });
    expect(started.isError).not.toBe(true);
    const uploadUrl = started.structuredContent.uploadUrl;
    await evictDurableObject(registeredStub);
    expect((await exports.default.fetch(`${origin}/import/enginebox-runners/` + 'x'.repeat(43))).status).toBe(410);
    expect((await exports.default.fetch(uploadUrl)).status).toBe(403);
    expect((await exports.default.fetch(uploadUrl, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    await runInDurableObject(registeredStub, instance => { instance.env.KIT_DELIVERY_AAAAAAAAAAAAAAAA = { get: async () => webhook }; });
    names(1);
    reply('https://api.github.com', '/app', 'GET', 200, { id: 42, client_id: 'Iv1.fixture', slug: 'enginebox-runners', owner: { login: 'your-org' } });
    reply('https://api.cloudflare.com', endpoint, 'POST', 200, { success: true, result: rows.slice(0, 2) });
    names(3);
    const saved = await exports.default.fetch(uploadUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secrets: { APP_CLIENT_SECRET: clientSecret, APP_PRIVATE_KEY: env.TEST_PEM } }) });
    expect(saved.status).toBe(200);
    const text = await saved.text();
    expect(JSON.parse(text).status).toBe('stored');
    await evictDurableObject(registeredStub);
    const deliveryUrl = `${origin}/v1/deliveries/enginebox-runners`;
    expect((await exports.default.fetch(deliveryUrl, { headers })).status).toBe(403);
    const deliveryHeaders = { authorization: `Bearer ${env.TEST_DELIVERY_TOKEN}` };
    names(3);
    const result = await (await exports.default.fetch(deliveryUrl, { headers: deliveryHeaders })).json();
    expect(result.status).toBe('ready');
    const payload = await openDelivery(result.envelope, JSON.parse(env.TEST_DELIVERY_KEY), { integration: 'enginebox-runners', target: 'production' });
    expect(payload.secrets.APP_WEBHOOK_SECRET).toBe(webhook);
    const state = await runInDurableObject(registeredStub, async (_instance, ctx) => [...await ctx.storage.list()]);
    for (const value of [clientSecret, webhook, env.TEST_PEM, env.TEST_DELIVERY_TOKEN]) expect(JSON.stringify({ state, result, text })).not.toContain(value);
    const ack = await exports.default.fetch(deliveryUrl, { method: 'POST', headers: { ...deliveryHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ deliveryId: result.envelope.context.deliveryId }) });
    expect((await ack.json()).status).toBe('delivered');
    const after = await runInDurableObject(registeredStub, async (_instance, ctx) => ctx.storage.get('imports'));
    expect(after['enginebox-runners'].envelope).toBeUndefined();
  } finally { await client.close(); }
});

test('generic uploads enforce scope and size, survive eviction, serialize retries and reject values in MCP arguments', async () => {
  const registeredStub = env.BROKER_STATE.getByName('registered:grok-bot:enginebox:staging');
  const registered = await registeredStub.register({ project: 'enginebox', target: 'staging', secrets: [{ name: 'SERVICE_TOKEN', generate: false }] }, env.TEST_TOKEN);
  const binding = registered.value.bindings[0]; registered[Symbol.dispose]?.();
  const scope = policy.principals[0].registration;
  const endpoint = `/client/v4/accounts/${scope.accountId}/secrets_store/stores/${scope.storeId}/secrets`;
  const row = { id: 'c'.repeat(32), store_id: scope.storeId, name: binding.secret_name, status: 'active' };
  const list = rows => reply('https://api.cloudflare.com', new RegExp(endpoint + '\\?'), 'GET', 200, { success: true, result: rows });
  const client = new Client({ name: 'generic-upload-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    fetch: (url, options) => exports.default.fetch(url, options), requestInit: { headers: { authorization: `Bearer ${env.TEST_TOKEN}` } },
  }));
  try {
    const input = { operation: 'begin', project: 'enginebox', target: 'staging', names: ['SERVICE_TOKEN'] };
    const sentinel = 'do-not-echo-upload-fixture';
    const rejected = await client.callTool({ name: 'kitbash_upload_secrets', arguments: { ...input, value: sentinel } });
    expect(rejected.isError).toBe(true); expect(JSON.stringify(rejected)).not.toContain(sentinel);
    list([]);
    const ticket = (await client.callTool({ name: 'kitbash_upload_secrets', arguments: input })).structuredContent;
    const helper = await (await exports.default.fetch(ticket.helperUrl)).text();
    expect(createHash('sha256').update(helper).digest('hex')).toBe(ticket.helperSha256);
    expect(helper).toContain('def upload(');
    await evictDurableObject(registeredStub);
    const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secrets: { SERVICE_TOKEN: sentinel } }) };
    expect((await exports.default.fetch(ticket.uploadUrl.replace('/staging/', '/production/'), options)).status).toBe(403);
    expect((await exports.default.fetch(ticket.uploadUrl.slice(0, -43) + 'z'.repeat(43), options)).status).toBe(403);
    expect((await exports.default.fetch(ticket.uploadUrl, { ...options, body: JSON.stringify({ secrets: { UNREGISTERED: sentinel } }) })).status).toBe(400);
    expect((await exports.default.fetch(ticket.uploadUrl, { ...options, body: ' '.repeat(262145) })).status).toBe(400);
    list([]); reply('https://api.cloudflare.com', endpoint, 'POST', 200, { success: true, result: [row] }); list([row]);
    const saved = await Promise.all([exports.default.fetch(ticket.uploadUrl, options), exports.default.fetch(ticket.uploadUrl, options)]);
    for (const response of saved) { expect(response.status).toBe(200); expect((await response.json()).status).toBe('stored'); }
    await evictDurableObject(registeredStub);
    const status = await client.callTool({ name: 'kitbash_upload_secrets', arguments: { operation: 'status', project: 'enginebox', target: 'staging', uploadId: ticket.uploadId } });
    expect(status.structuredContent.status).toBe('stored');
    const state = await runInDurableObject(registeredStub, async (_instance, ctx) => [...await ctx.storage.list()]);
    expect(JSON.stringify(state)).not.toContain(sentinel);
    list([row]); expect((await client.callTool({ name: 'kitbash_upload_secrets', arguments: input })).isError).toBe(true);
  } finally { await client.close(); }
});
