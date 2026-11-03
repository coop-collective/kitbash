import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createService } from '../src/service.mjs';
import { createBrokerServer } from '../src/server.mjs';
import { validateConfig, validateOperation } from '../src/config.mjs';
import { openState } from '../src/state.mjs';
import { issueClient } from '../src/issue-client.mjs';
import { BrokerError } from '../src/errors.mjs';
import { ensureScope } from '../src/scope.mjs';
import { ensureCloudflareCredentials } from '../src/credentials.mjs';
import { makeProviders, requestJson } from '../src/api.mjs';

const TOKEN = 'fixture-broker-capability-01234567890123456789';
const SECRET = 'fixture-provider-secret-never-returned-0123456789';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const ENV_ID = '22222222-2222-4222-8222-222222222222';
const config = () => ({ version: 1, projects: { app: {
  projectId: PROJECT, projectSlug: 'app', domain: 'https://vault.example.test',
  targets: { local: { environment: 'dev', secretPath: '/app' }, staging: { environment: 'staging', secretPath: '/app' } },
  secrets: { JWT_SESSION_SECRET: { generate: true, rotation: 'migration-required' } },
} }, principals: [{ id: 'agent', tokenSha256: createHash('sha256').update(TOKEN).digest('hex'),
  grants: [{ project: 'app', targets: ['local', 'staging'], operations: ['setup', 'status', 'generate', 'provision-github', 'provision-worker-sync'] }],
}] });
const memory = () => ({ data: { version: 1, entries: {} }, save: async () => {} });
const operation = (operation = 'generate', extra = {}) => ({ operation, project: 'app', target: 'local', ...(operation === 'generate' ? { name: 'JWT_SESSION_SECRET' } : {}), ...extra });
const row = (name, value = SECRET, environment = 'dev', secretPath = '/app') => ({ secretKey: name, secretValue: value, workspace: PROJECT, environment, type: 'shared', secretPath });
function vault() {
  const rows = [];
  const calls = [];
  return { rows, calls, async api(endpoint, options = {}) {
    calls.push({ endpoint, ...options });
    if (options.method === 'POST') {
      const record = row(endpoint.split('/').at(-1), options.body.secretValue, options.body.environment, options.body.secretPath);
      rows.push(record);
      return { secret: record, debug: SECRET };
    }
    assert.equal(options.query.viewSecretValue, 'false');
    assert.equal(options.query.includeImports, 'false');
    assert.equal(options.query.recursive, 'false');
    return { secrets: rows, token: SECRET };
  } };
}

test('generation is strong, create-only, serialized, and never returns or persists values', async () => {
  const storage = memory();
  const provider = vault();
  const service = createService(config(), storage, { providers: async () => ({ infisical: provider.api }) });
  const results = await Promise.all([service.execute(operation(), TOKEN), service.execute(operation(), TOKEN)]);
  assert.deepEqual(results.map(r => r.status), ['created', 'already-exists']);
  assert.equal(provider.rows.length, 1);
  const generated = provider.rows[0].secretValue;
  assert.equal(Buffer.from(generated, 'base64url').length, 32);
  assert.equal(JSON.stringify({ results, storage: storage.data }).includes(generated), false);
  assert.equal(JSON.stringify(results).includes(SECRET), false);
  const status = await service.execute(operation('status'), TOKEN);
  assert.deepEqual(status.secrets, [{ name: 'JWT_SESSION_SECRET', status: 'present' }]);
});

test('setup generates all application keys, preserves existing, and skips optional provider credentials', async () => {
  const settings = config();
  settings.projects.app.secrets.WEBHOOK_SECRET = { generate: true, bytes: 64, rotation: 'manual' };
  settings.projects.app.secrets.OAUTH_CLIENT_SECRET = { generate: false, required: false, rotation: 'provider' };
  const provider = vault();
  provider.rows.push(row('JWT_SESSION_SECRET'));
  let scopeCalls = 0;
  let logins = 0;
  const service = createService(settings, memory(), {
    providers: async () => { logins++; return { infisical: provider.api }; }, scopeProvision: async () => { scopeCalls++; },
  });
  const result = await service.execute(operation('setup'), TOKEN);
  assert.equal(result.status, 'ready');
  assert.equal(scopeCalls, 1);
  assert.equal(logins, 1);
  assert.equal(provider.rows.length, 2);
  assert.equal(provider.rows[0].secretValue, SECRET);
  assert.equal(Buffer.from(provider.rows[1].secretValue, 'base64url').length, 64);
  assert.equal(result.secrets.find(s => s.name === 'OAUTH_CLIENT_SECRET').status, 'missing');
});

test('missing required provider-issued credentials makes setup pending, never substitutes a random token', async () => {
  const settings = config();
  settings.projects.app.secrets.OAUTH_CLIENT_SECRET = { generate: false, rotation: 'provider' };
  settings.projects.app.targets.local = { environment: 'dev', secretPath: '/app' };
  const provider = vault();
  const service = createService(settings, memory(), { providers: async () => ({ infisical: provider.api }), scopeProvision: async () => {} });
  const result = await service.execute(operation('setup'), TOKEN);
  assert.equal(result.status, 'pending');
  assert.equal(provider.rows.length, 1);
  await assert.rejects(service.execute(operation('generate', { name: 'OAUTH_CLIENT_SECRET' }), TOKEN), { code: 'forbidden' });
});

test('setup wires private credentials and connection IDs without widening tool access', async () => {
  const settings = config();
  Object.assign(settings.projects.app.targets.staging, { github: {}, cloudflare: { connectionName: 'app', autoSync: true } });
  const provider = vault();
  const privateState = memory();
  let credentialsCalls = 0;
  const service = createService(settings, privateState, {
    providers: async () => ({ infisical: provider.api }), scopeProvision: async () => {},
    credentialsProvision: async () => { credentialsCalls++; return { apiToken: SECRET, accountId: 'a'.repeat(32) }; },
    githubProvision: async () => ({ status: 'configured', secret: SECRET }),
    connectionProvision: async (_scope, { credentials, checkpoint }) => { assert.equal(credentials.apiToken, SECRET); checkpoint.state.connectionId = ENV_ID; },
    workerProvision: async scope => { assert.equal(scope.cloudflare.connectionId, ENV_ID); return { status: 'configured', secret: SECRET }; },
  });
  const result = await service.execute(operation('setup', { target: 'staging' }), TOKEN);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.github, { configured: true });
  assert.deepEqual(result.workerSync, { configured: true });
  assert.equal(credentialsCalls, 2);
  assert.equal(JSON.stringify({ result, data: privateState.data }).includes(SECRET), false);
});

test('unknown input, ungranted target, and wrong capability make no provider calls', async () => {
  let calls = 0;
  const service = createService(config(), memory(), { providers: async () => { calls++; throw Error(SECRET); } });
  for (const input of [operation('read'), operation('generate', { value: SECRET }), operation('status', { target: 'production' }), operation('status', { project: 'other' })]) {
    await assert.rejects(service.execute(input, TOKEN));
  }
  await assert.rejects(service.execute(operation(), 'x'.repeat(40)));
  assert.equal(calls, 0);
});

test('lost write response, approval, and missing readback cannot cause automatic regeneration', async () => {
  for (const mode of ['lost', 'approval', 'readback']) {
    let writes = 0;
    const service = createService(config(), memory(), { providers: async () => ({ infisical: async (_path, options) => {
      if (options.method !== 'POST') return { secrets: [] };
      writes++;
      if (mode === 'lost') throw Error(SECRET);
      return mode === 'approval' ? { approval: { id: SECRET } } : { secret: row('JWT_SESSION_SECRET') };
    } }) });
    await assert.rejects(service.execute(operation(), TOKEN));
    await assert.rejects(service.execute(operation(), TOKEN), { code: 'conflict' });
    assert.equal(writes, 1);
  }
});

test('rejects infrastructure random generation and cross-scope provider metadata', async () => {
  const settings = config();
  settings.projects.app.secrets.CLOUDFLARE_API_TOKEN = { generate: true, rotation: 'manual' };
  assert.throws(() => validateConfig(settings));
  const service = createService(config(), memory(), { providers: async () => ({ infisical: async () => ({ secrets: [row('JWT_SESSION_SECRET', SECRET, 'production')] }) }) });
  await assert.rejects(service.execute(operation('status'), TOKEN), { code: 'provider_failed' });
  for (const value of ['https://vault.example.test/path', 'http://vault.example.test', 'https://name:password@vault.example.test']) {
    const settings = config(); settings.projects.app.domain = value;
    assert.throws(() => validateConfig(settings));
  }
  assert.throws(() => validateOperation({ ...operation('status'), name: 'JWT_SESSION_SECRET' }));
});

test('setup creates only exact environment and folder paths and resumes confirmed creates', async () => {
  const scope = { projectId: PROJECT, environment: 'staging', secretPath: '/app/nested', github: {} };
  let environment;
  const folders = new Map();
  const mutations = [];
  const checkpoint = { state: {}, save: async () => {} };
  const api = async (url, options = {}) => {
    if (url.includes('/environments')) {
      if (options.method === 'POST') { mutations.push(options.body); environment = { id: ENV_ID, projectId: PROJECT, slug: 'staging' }; }
      if (!environment) throw new BrokerError('provider_failed', 404);
      return { environment };
    }
    if (options.method === 'POST') {
      mutations.push(options.body);
      const { path, name } = options.body;
      folders.set(path, [...(folders.get(path) ?? []), { name, envId: ENV_ID }]);
      return {};
    }
    return { folders: folders.get(options.query.path) ?? [] };
  };
  await ensureScope(scope, api, checkpoint);
  await ensureScope(scope, api, checkpoint);
  assert.equal(mutations.length, 4);
  assert.deepEqual(mutations.slice(1).map(b => [b.path, b.name]), [['/', 'app'], ['/app', 'nested'], ['/', 'ci']]);
  assert.deepEqual(checkpoint.state.scope, {});
});

test('Cloudflare CI credential transfer is scoped, private, create-only, and refuses mixed pairs', async () => {
  let rows = [];
  let writes = 0;
  const checkpoint = { state: {}, save: async () => {} };
  const api = async (_path, options) => {
    if (options.method === 'POST') {
      writes++;
      assert.equal(options.body.secretPath, '/ci');
      rows = options.body.secrets.map(s => row(s.secretKey, s.secretValue, 'staging', '/ci'));
    } else assert.equal(options.query.secretPath, '/ci');
    return { secrets: rows };
  };
  const env = { CLOUDFLARE_API_TOKEN: SECRET, CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) };
  const scope = { projectId: PROJECT, environment: 'staging' };
  const result = await ensureCloudflareCredentials(scope, api, checkpoint, env);
  assert.equal(result.apiToken, SECRET);
  await ensureCloudflareCredentials(scope, api, checkpoint, {});
  assert.equal(writes, 1);
  assert.equal(JSON.stringify(checkpoint).includes(SECRET), false);
  rows.pop();
  await assert.rejects(ensureCloudflareCredentials(scope, api, checkpoint, env), { code: 'conflict' });
  assert.equal(writes, 1);
});

test('provider auth remains inside broker and transport errors never echo response bodies', async () => {
  const seen = [];
  const providers = makeProviders({ env: { INFISICAL_CLIENT_ID: 'fixture', INFISICAL_CLIENT_SECRET: SECRET, GITHUB_TOKEN: SECRET }, request: async (url, options) => {
    seen.push({ url: url.toString(), options });
    assert.equal(options.redirect, 'manual');
    return new Response(JSON.stringify(url.pathname.endsWith('/login') ? { accessToken: 'fixture.access.token' } : { secrets: [] }));
  } });
  const { infisical, github } = await providers({ domain: 'https://vault.example.test' });
  await infisical('/api/v4/secrets'); await github('/repos/owner/app');
  assert.equal(seen.length, 3);
  assert.equal(seen.some(r => r.url.includes(SECRET)), false);
  assert.equal(seen[2].options.headers.authorization, `Bearer ${SECRET}`);
  for (const request of [async () => { throw Error(SECRET); }, async () => new Response(SECRET, { status: 403 }), async () => new Response(SECRET)]) {
    await assert.rejects(requestJson('https://vault.example.test', { request }), error => !error.message.includes(SECRET));
  }
});

test('manual redirect mode rejects provider redirects without forwarding credentials or revealing the destination', async () => {
  let calls = 0;
  await assert.rejects(requestJson('https://vault.example.test/api/v4/secrets', {
    headers: { authorization: `Bearer ${SECRET}` }, request: async (_url, options) => {
      calls++;
      assert.equal(options.redirect, 'manual');
      return new Response(null, { status: 307, headers: { location: `https://elsewhere.example.test/${SECRET}` } });
    },
  }), error => error.code === 'provider_failed' && error.status === 307 && !error.message.includes(SECRET));
  assert.equal(calls, 1);
});

test('native Worker sync rejects extra source-folder secrets before registering a connection', async () => {
  const settings = config();
  settings.projects.app.targets.staging.cloudflare = { connectionName: 'app' };
  const provider = vault();
  provider.rows.push(row('CLOUDFLARE_API_TOKEN', SECRET, 'staging'));
  let connected = false;
  const service = createService(settings, memory(), {
    providers: async () => ({ infisical: provider.api }),
    connectionProvision: async () => { connected = true; },
  });
  await assert.rejects(service.execute(operation('provision-worker-sync', { target: 'staging' }), TOKEN), { code: 'conflict' });
  assert.equal(connected, false);
});

test('Cloudflare-only setup creates /ci even without GitHub', async () => {
  const names = [];
  const folderRows = [];
  await ensureScope({ projectId: PROJECT, environment: 'staging', secretPath: '/app', cloudflare: {} }, async (endpoint, options = {}) => {
    if (endpoint.includes('/environments')) return { environment: { id: ENV_ID, projectId: PROJECT, slug: 'staging' } };
    if (options.method === 'POST') {
      names.push(options.body.name);
      folderRows.push({ name: options.body.name, envId: ENV_ID });
    }
    return { folders: folderRows };
  }, { state: {}, save: async () => {} });
  assert.deepEqual(names, ['app', 'ci']);
});

test('HTTP boundary rejects browser origins and value inputs, and suppresses raw provider errors/audit', async t => {
  const logs = [];
  const service = createService(config(), memory(), { providers: async () => { throw Error(SECRET); } });
  const server = createBrokerServer(service, { audit: event => logs.push(event) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/v1/operations`;
  const send = (body, headers = {}) => fetch(url, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  for (const request of [() => send(operation('status')), () => send({ ...operation(), value: SECRET }), () => send(operation(), { origin: 'https://untrusted.test' }), () => send(operation(), { authorization: 'Bearer invalid' })]) {
    const response = await request();
    assert.ok(response.status >= 400);
    const text = await response.text();
    assert.equal(text.includes(SECRET), false);
    assert.equal(text.includes(TOKEN), false);
  }
  assert.equal(JSON.stringify(logs).includes(SECRET), false);
});

test('private durable state locks, persists before reuse, and client capability issuance prints no token', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kit-broker-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateFile = path.join(root, 'state.json');
  const store = openState(stateFile);
  assert.throws(() => openState(stateFile), { code: 'conflict' });
  store.data.entries.test = { pending: true };
  await store.save(); store.close();
  const reopened = openState(stateFile);
  assert.equal(reopened.data.entries.test.pending, true);
  reopened.close();
  assert.equal(statSync(stateFile).mode & 0o777, 0o600);
  const policyFile = path.join(root, 'policy.json');
  const outputFile = path.join(root, 'agent.env');
  writeFileSync(policyFile, JSON.stringify(config()));
  const result = issueClient({ policyFile, outputFile, principalId: 'agent', brokerUrl: 'https://broker.example.test' });
  const content = readFileSync(outputFile, 'utf8');
  const token = content.match(/KIT_SECRETS_BROKER_TOKEN=(.+)/)[1];
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(JSON.parse(readFileSync(policyFile)).principals[0].tokenSha256, createHash('sha256').update(token).digest('hex'));
  assert.equal(statSync(outputFile).mode & 0o777, 0o600);
  assert.throws(() => issueClient({ policyFile, outputFile, principalId: 'agent', brokerUrl: 'https://broker.example.test' }));
  const mcpFile = path.join(root, 'connector.json');
  const issued = issueClient({ policyFile, outputFile: mcpFile, principalId: 'agent', brokerUrl: 'https://broker.example.test', format: 'mcp' });
  const connection = JSON.parse(readFileSync(mcpFile)).mcpServers.kitbash_secrets;
  assert.equal(connection.type, 'http');
  assert.equal(connection.url, 'https://broker.example.test/mcp');
  const capability = connection.headers.Authorization.slice('Bearer '.length);
  assert.equal(Buffer.from(capability, 'base64url').length, 32);
  assert.notEqual(capability, token);
  assert.equal(JSON.stringify(issued).includes(capability), false);
  const saved = JSON.parse(readFileSync(policyFile));
  assert.equal(saved.principals[0].tokenSha256, createHash('sha256').update(capability).digest('hex'));
  assert.deepEqual(saved.principals[0].grants, config().principals[0].grants);
  assert.equal(statSync(mcpFile).mode & 0o777, 0o600);
  assert.throws(() => issueClient({ policyFile, outputFile: mcpFile, principalId: 'agent', brokerUrl: 'https://broker.example.test', format: 'mcp' }));
});
