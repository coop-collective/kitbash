import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createService } from '../src/service.mjs';
import { makeProviders } from '../src/api.mjs';
import { cloudflareSecretStore } from '../src/cloudflare-store.mjs';
import { validateConfig } from '../src/config.mjs';

const token = 'a'.repeat(43);
const accountId = 'b'.repeat(32), storeId = 'c'.repeat(32);
const runtimeToken = 'cfat_private_runtime_fixture_only';
function fixture() {
  const policy = { version: 1, projects: { app: {
    backend: 'cloudflare-secrets-store', accountId, storeId,
    secrets: { SESSION_SECRET: { generate: true, rotation: 'migration-required' } },
    targets: { staging: { secretPrefix: 'APP_STAGING_' } },
  } }, principals: [{ id: 'bot', tokenSha256: createHash('sha256').update(token).digest('hex'),
    grants: [{ project: 'app', targets: ['staging'], operations: ['setup', 'status', 'generate', 'presence'] }] }] };
  const state = { data: { entries: {} }, save: async () => {} };
  const rows = [], calls = [], writes = [], mode = {};
  const request = async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.cloudflare.com');
    assert.equal(url.pathname, `/client/v4/accounts/${accountId}/secrets_store/stores/${storeId}/secrets`);
    assert.equal(options.headers.authorization, `Bearer ${runtimeToken}`);
    calls.push({ method: options.method, search: url.searchParams.get('search') });
    if (options.method === 'POST') {
      const entries = JSON.parse(options.body); writes.push(...entries);
      if (mode.fail) return Response.json({ secretValue: entries[0].value }, { status: 500 });
      const created = entries.map((entry, i) => ({ id: String(i + 1).repeat(32), name: entry.name, store_id: storeId, status: mode.status ?? 'active' }));
      rows.push(...created);
      return Response.json({ success: true, result: created });
    }
    return Response.json({ success: true, result: rows, result_info: { total_pages: 1 } });
  };
  const service = createService(policy, state, { providers: makeProviders({ env: { KIT_BROKER_SECRETS_API_TOKEN: runtimeToken }, request }) });
  const execute = (operation, extra = {}) => service.execute({ operation, project: 'app', target: 'staging', ...extra }, token);
  return { policy, state, rows, calls, writes, mode, request, execute };
}

test('Cloudflare generation writes directly to the scoped store, returns metadata, and preserves existing values', async () => {
  const f = fixture();
  assert.equal((await f.execute('setup')).status, 'ready');
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].name, 'APP_STAGING_SESSION_SECRET');
  assert.match(f.writes[0].value, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(f.writes[0].scopes, ['workers']);
  assert.equal((await f.execute('generate', { name: 'SESSION_SECRET' })).status, 'already-exists');
  assert.equal((await f.execute('presence', { name: 'SESSION_SECRET' })).status, 'present');
  assert.equal(f.writes.length, 1);
  assert.equal(JSON.stringify(f.state).includes(f.writes[0].value), false);
  assert.equal(JSON.stringify(await f.execute('status')).includes(f.writes[0].value), false);
  assert.equal(f.calls.filter(c => c.method === 'GET').every(c => c.search === 'APP_STAGING_'), true);
});

test('an uncertain Cloudflare write is checkpointed and cannot silently generate a replacement', async () => {
  const f = fixture(); f.mode.fail = true;
  await assert.rejects(f.execute('generate', { name: 'SESSION_SECRET' }), error => error.code === 'provider_failed' && !error.message.includes(f.writes[0].value));
  f.mode.fail = false;
  await assert.rejects(f.execute('generate', { name: 'SESSION_SECRET' }), { code: 'conflict' });
  assert.equal(f.writes.length, 1);
  assert.equal(JSON.stringify(f.state).includes(f.writes[0].value), false);
});

test('Cloudflare accepted pending writes succeed after metadata readback and are never regenerated', async () => {
  const f = fixture();
  f.mode.status = 'pending';
  const created = await f.execute('generate', { name: 'SESSION_SECRET' });
  assert.equal(created.status, 'created');
  assert.equal(f.state.data.entries['app:staging:generate'].state.keys.SESSION_SECRET, 'created');
  assert.equal((await f.execute('generate', { name: 'SESSION_SECRET' })).status, 'already-exists');
  f.rows[0].status = 'active';
  assert.equal((await f.execute('presence', { name: 'SESSION_SECRET' })).status, 'present');
  assert.equal(f.writes.length, 1);
  assert.equal(JSON.stringify({ created, state: f.state.data }).includes(f.writes[0].value), false);
});

test('Cloudflare deleted creation records remain failures and cannot trigger another write', async () => {
  const f = fixture();
  f.mode.status = 'deleted';
  await assert.rejects(f.execute('generate', { name: 'SESSION_SECRET' }), { code: 'provider_failed' });
  await assert.rejects(f.execute('generate', { name: 'SESSION_SECRET' }), { code: 'conflict' });
  assert.equal(f.writes.length, 1);
});

test('substring search results cannot cross a prefix boundary; unknown names and destinations cannot be supplied by clients', async () => {
  const f = fixture();
  f.rows.push({ id: 'd'.repeat(32), name: 'OTHER_APP_SESSION_SECRET', comment: 'APP_STAGING_', store_id: storeId, status: 'active' });
  assert.equal((await f.execute('presence', { name: 'SESSION_SECRET' })).status, 'missing');
  const count = f.calls.length;
  await assert.rejects(f.execute('presence', { name: 'UNKNOWN_SECRET' }), { code: 'forbidden' });
  await assert.rejects(f.execute('generate', { name: 'SESSION_SECRET', storeId: 'e'.repeat(32) }), { code: 'invalid_request' });
  await assert.rejects(f.execute('generate', { name: 'CLOUDFLARE_API_TOKEN' }), { code: 'forbidden' });
  assert.equal(f.calls.length, count);
  f.rows.push({ id: 'e'.repeat(32), name: 'APP_STAGING_SESSION_SECRET', store_id: 'f'.repeat(32), status: 'active' });
  await assert.rejects(f.execute('status'), { code: 'provider_failed' });
});

test('policy rejects overlapping namespaces and Infisical-only provisioning grants for Cloudflare storage', () => {
  const f = fixture();
  const project = f.policy.projects.app;
  project.targets.production = { secretPrefix: 'APP_STAGING_NESTED_' };
  assert.throws(() => validateConfig(f.policy), { code: 'invalid_request' });
  delete project.targets.production;
  f.policy.principals[0].grants[0].operations.push('provision-github');
  assert.throws(() => validateConfig(f.policy), { code: 'invalid_request' });
});

test('metadata pagination is complete and batch creation accepts only the exact expected records', async () => {
  const scope = { accountId, storeId, secretPrefix: 'APP_STAGING_' };
  let page = 0;
  const storage = cloudflareSecretStore(scope, { token: runtimeToken, request: async (url, options) => {
    if (options.method === 'POST') return Response.json({ success: true, result: [{ id: 'd'.repeat(32), store_id: storeId, name: 'OTHER_SECRET', status: 'active' }] });
    page++;
    assert.equal(new URL(url).searchParams.get('page'), String(page));
    return Response.json({ success: true, result: [{ id: String(page).repeat(32), store_id: storeId, name: `APP_STAGING_SECRET_${page}`, status: 'active' }], result_info: { total_pages: 2 } });
  } });
  assert.deepEqual([...await storage.listNames()], ['SECRET_1', 'SECRET_2']);
  await assert.rejects(storage.createMany([{ name: 'SESSION_SECRET', value: 'fixture-value' }]), { code: 'provider_failed' });
});
