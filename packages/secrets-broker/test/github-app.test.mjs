import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createGitHubAppFlow, APP_COOKIE } from '../src/github-app.mjs';
import { createService } from '../src/service.mjs';
import { createBrokerServer } from '../src/server.mjs';
import { validateConfig } from '../src/config.mjs';

const token = 'fixture-github-app-capability-01234567890123456789';
const providerSecret = 'fixture-provider-content-never-visible';
const code = 'fixture-manifest-code';
const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
const input = { operation: 'provision-github-app', project: 'engine-box', target: 'staging' };
const names = { appId: 'GITHUB_APP_ID', clientId: 'GITHUB_APP_CLIENT_ID', clientSecret: 'GITHUB_APP_CLIENT_SECRET', privateKey: 'GITHUB_APP_PRIVATE_KEY', webhookSecret: 'GITHUB_APP_WEBHOOK_SECRET' };
const app = () => ({
  owner: 'example-org', ownerType: 'organization', secrets: { ...names },
  manifest: { name: 'Engine Box Runners', url: 'https://engine.example.test', hook_attributes: { url: 'https://engine.example.test/webhooks/github', active: true },
    callback_urls: ['https://engine.example.test/auth/github/callback'], public: false, default_permissions: { contents: 'read' }, default_events: ['push'] },
});
const policy = () => ({ version: 1, projects: { 'engine-box': {
  projectId: '11111111-1111-4111-8111-111111111111', projectSlug: 'engine-box', domain: 'https://vault.example.test',
  secrets: Object.fromEntries(Object.values(names).map(name => [name, { generate: false, rotation: 'provider' }])),
  targets: { staging: { environment: 'staging', secretPath: '/app', githubApp: app() } },
} }, principals: [{ id: 'grok', tokenSha256: createHash('sha256').update(token).digest('hex'), grants: [{ project: 'engine-box', targets: ['staging'], operations: ['provision-github-app', 'status', 'presence'] }] }] });

function fixture(mode) {
  let time = 0;
  let conversions = 0;
  let writes = 0;
  const rows = [];
  const store = { data: { version: 1, entries: {} }, save: async () => {} };
  const result = { id: 42, client_id: 'fixture-client-id', client_secret: providerSecret, webhook_secret: `${providerSecret}-webhook`, pem,
    owner: { login: 'example-org', type: 'Organization' }, permissions: { metadata: 'read', contents: 'read' }, events: ['push'] };
  const flow = createGitHubAppFlow({ publicOrigin: 'https://broker.example.test', now: () => time, request: async (url, options) => {
    conversions++;
    assert.equal(url, `https://api.github.com/app-manifests/${code}/conversions`);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.authorization, undefined);
    if (mode === 'conversion-lost') throw new Error(providerSecret);
    const body = structuredClone(result);
    if (mode === 'wrong-owner') body.owner.login = 'someone-else';
    if (mode === 'wrong-permissions') body.permissions.contents = 'write';
    if (mode === 'wrong-key') body.pem = providerSecret;
    return new Response(JSON.stringify(body));
  } });
  const providers = async scope => ({ infisical: async (_path, options) => {
    if (options.method === 'POST') {
      writes++;
      assert.equal(options.body.projectId, scope.projectId);
      assert.equal(options.body.environment, scope.environment);
      assert.equal(options.body.secretPath, scope.secretPath);
      for (const secret of options.body.secrets) {
        // Infisical's batch-create schema rejects extra properties (unlike single-create, it has no type).
        assert.deepEqual(Object.keys(secret).sort(), ['secretKey', 'secretValue', 'skipMultilineEncoding']);
      }
      if (mode === 'write-lost') throw new Error(providerSecret);
      if (mode === 'approval') return { approval: { token: providerSecret } };
      rows.push(...options.body.secrets.map(secret => ({ ...secret, workspace: scope.projectId, environment: scope.environment, secretPath: scope.secretPath, type: 'shared' })));
      return { secrets: rows, token: providerSecret };
    }
    assert.equal(options.query.viewSecretValue, 'false');
    return { secrets: mode === 'readback-missing' ? [] : rows, token: providerSecret };
  } });
  const service = createService(policy(), store, { providers, scopeProvision: async () => {}, githubAppFlow: flow });
  return { service, store, rows, result, conversions: () => conversions, writes: () => writes, advance: () => { time += 16 * 60 * 1000; },
    restart: () => createService(policy(), store, { providers, scopeProvision: async () => {}, env: { KIT_BROKER_PUBLIC_ORIGIN: 'https://broker.example.test' } }),
  };
}
async function handoff(f) {
  const pending = await f.service.execute(input, token);
  const page = await f.service.openGitHubApp(new URL(pending.approvalUrl).pathname.split('/').at(-1), 'https://broker.example.test');
  return { pending, page, state: /\?state=([A-Za-z0-9_-]+)/.exec(page.html)[1], cookie: page.cookie.split(';')[0].split('=')[1] };
}

test('manifest handoff stores all App credentials directly, returns metadata, and cannot replay or rotate', async t => {
  const f = fixture();
  const audit = [];
  const server = createBrokerServer(f.service, { audit: entry => audit.push(entry) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const client = new Client({ name: 'grok-fixture', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', origin), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const pending = await client.callTool({ name: 'kitbash_secrets', arguments: input });
  assert.equal(pending.structuredContent.status, 'pending');
  const startUrl = new URL(pending.structuredContent.approvalUrl).pathname;
  const preview = await fetch(`${origin}${startUrl}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('set-cookie'), null);
  assert.match(await preview.text(), /Prepare registration/);
  assert.equal(JSON.stringify(f.store.data).includes('registrationStarted'), false);
  // A link preview does not consume the flow; a cross-origin POST cannot start it either.
  const denied = await fetch(`${origin}${startUrl}`, { method: 'POST', headers: { origin: 'https://untrusted.example.test' } });
  assert.equal(denied.status, 403);
  const noOrigin = await fetch(`${origin}${startUrl}`, { method: 'POST' });
  assert.equal(noOrigin.status, 403);
  const page = await fetch(`${origin}${startUrl}`, { method: 'POST', headers: { origin: 'https://broker.example.test' } });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.match(page.headers.get('content-security-policy'), /form-action 'self' https:\/\/github.com/);
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const html = await page.text();
  const state = /\?state=([A-Za-z0-9_-]+)/.exec(html)[1];
  assert.match(html, /https:\/\/github.com\/organizations\/example-org\/settings\/apps\/new/);
  assert.match(html, /https:\/\/broker.example.test\/github-app\/callback/);
  const callback = `${origin}/github-app/callback?state=${state}&code=${code}`;
  const noCookie = await fetch(callback);
  assert.equal(noCookie.status, 403);
  const wrongCookie = await fetch(callback, { headers: { cookie: `${APP_COOKIE}=${'x'.repeat(43)}` } });
  assert.equal(wrongCookie.status, 403);
  assert.equal(f.conversions(), 0);
  const complete = await fetch(callback, { headers: { cookie }, redirect: 'manual' });
  assert.equal(complete.status, 303);
  assert.equal(complete.headers.get('location'), '/github-app/complete');
  assert.equal(f.writes(), 1);
  assert.equal(f.rows.find(row => row.secretKey === names.privateKey).secretValue, pem);
  assert.equal(f.rows.find(row => row.secretKey === names.clientSecret).secretValue, providerSecret);
  const repeated = await client.callTool({ name: 'kitbash_secrets', arguments: input });
  assert.equal(repeated.structuredContent.status, 'configured');
  assert.equal(repeated.structuredContent.approvalUrl, undefined);
  const replay = await fetch(callback, { headers: { cookie } });
  assert.equal(replay.status, 403);
  const presence = await client.callTool({ name: 'kitbash_secrets', arguments: { ...input, operation: 'presence', name: names.privateKey } });
  assert.equal(presence.structuredContent.status, 'present');
  assert.equal(f.conversions(), 1);
  const visible = JSON.stringify({ pending, repeated, presence, html, audit, state: f.store.data, callbackBody: await complete.text() });
  for (const secret of [pem, providerSecret, token, code]) assert.equal(visible.includes(secret), false);
});

test('bad provider responses and uncertain writes are sanitized and stop further App creation', async () => {
  for (const mode of ['conversion-lost', 'wrong-owner', 'wrong-permissions', 'wrong-key', 'write-lost', 'approval', 'readback-missing']) {
    const f = fixture(mode);
    const { state, cookie } = await handoff(f);
    await assert.rejects(f.service.completeGitHubApp(state, cookie, code));
    await assert.rejects(f.service.execute(input, token), { code: 'conflict' });
    await assert.rejects(f.service.completeGitHubApp(state, cookie, code), { code: 'forbidden' });
    assert.equal(f.conversions(), 1);
    assert.ok(f.writes() <= 1);
    const persisted = JSON.stringify(f.store.data);
    for (const secret of [providerSecret, pem, code, state, cookie]) assert.equal(persisted.includes(secret), false);
  }
});

test('an opened handoff cannot be silently restarted after expiry or a broker restart', async () => {
  const f = fixture();
  const { state, cookie } = await handoff(f);
  assert.equal((await f.service.execute(input, token)).approvalUrl, undefined);
  await assert.rejects(f.restart().execute(input, token), { code: 'conflict' });
  f.advance();
  await assert.rejects(f.service.completeGitHubApp(state, cookie, code), { code: 'forbidden' });
  await assert.rejects(f.service.execute(input, token), { code: 'conflict' });
  assert.equal(f.conversions(), 0);
});

test('unopened handoffs can expire safely and partial pre-existing credentials prevent registration', async () => {
  const f = fixture();
  const before = await f.service.execute(input, token);
  f.advance();
  const after = await f.service.execute(input, token);
  assert.notEqual(before.approvalUrl, after.approvalUrl);
  f.rows.push({ secretKey: names.clientSecret, workspace: policy().projects['engine-box'].projectId, environment: 'staging', secretPath: '/app', type: 'shared' });
  await assert.rejects(f.service.execute(input, token), { code: 'conflict' });
  assert.equal(f.conversions(), 0);
});

test('trusted policy fixes owner, permissions, destinations, and provider-only secret names', () => {
  validateConfig(policy());
  for (const mutate of [
    config => { config.projects['engine-box'].targets.staging.githubApp.manifest.redirect_url = 'https://other.example.test'; },
    config => { config.projects['engine-box'].targets.staging.githubApp.owner = '../other'; },
    config => { config.projects['engine-box'].targets.staging.githubApp.manifest.url = 'http://example.test'; },
    config => { config.projects['engine-box'].targets.staging.githubApp.secrets.privateKey = names.clientSecret; },
    config => { config.projects['engine-box'].secrets[names.privateKey].generate = true; },
    config => { config.projects['engine-box'].secrets[names.privateKey].rotation = 'manual'; },
    config => { config.projects['engine-box'].targets.staging.githubApp.manifest.hook_attributes.active = false; },
  ]) { const config = policy(); mutate(config); assert.throws(() => validateConfig(config), { code: 'invalid_request' }); }
});
