import assert from 'node:assert/strict';
import test from 'node:test';
import { makeProviders } from '../src/api.mjs';
import { ensureDeploymentToken } from '../scripts/cloudflare-token.mjs';
import { loadDeploymentToken } from '../scripts/broker-ci.mjs';
import { ACCOUNT, ZONE, PROJECT, DEPLOY_TOKEN, BOOTSTRAP_TOKEN, TOKEN_ID, setupProviders } from './helpers/setup-providers.mjs';

async function fixture() {
  const f = setupProviders();
  const scope = { projectId: PROJECT, projectSlug: 'app', domain: 'https://vault.example.test', environment: 'production', secretPath: '/ci/example-broker' };
  const { infisical } = await makeProviders({ env: { INFISICAL_TOKEN: 'fixture.vault.token' }, request: f.request })(scope);
  const state = {}, snapshots = [], notes = [];
  const checkpoint = { state, save: async () => snapshots.push(structuredClone(state)) };
  const settings = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, KIT_BROKER_HOSTNAME: 'secrets.example.test', KIT_BROKER_WORKER_NAME: 'example-broker' };
  const opts = { scope, settings, infisical, checkpoint, request: f.request, bootstrap: async () => BOOTSTRAP_TOKEN, note: value => notes.push(value) };
  return { ...f, opts, state, snapshots, notes };
}

test('creates an account token with exact deployment permissions and writes its value only to the designated vault folder', async () => {
  const f = await fixture();
  const result = await ensureDeploymentToken(f.opts);
  assert.deepEqual(result, { CLOUDFLARE_API_TOKEN: DEPLOY_TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT });
  assert.deepEqual(f.records.tokens[0].policies, [
    { effect: 'allow', resources: { [`com.cloudflare.api.account.${ACCOUNT}`]: '*' }, permission_groups: [{ id: '1'.repeat(32) }, { id: '2'.repeat(32) }] },
    { effect: 'allow', resources: { [`com.cloudflare.api.account.zone.${ZONE}`]: '*' }, permission_groups: [{ id: '3'.repeat(32) }, { id: '4'.repeat(32) }] },
  ]);
  const batch = f.calls.find(call => call.path === '/api/v4/secrets/batch');
  assert.equal(batch.body.secretPath, '/ci/example-broker');
  assert.equal(batch.body.environment, 'production');
  assert.equal(batch.body.secrets.find(row => row.secretKey === 'CLOUDFLARE_API_TOKEN').secretValue, DEPLOY_TOKEN);
  assert.equal(JSON.stringify(batch.body).includes(BOOTSTRAP_TOKEN), false);
  assert.equal(f.state.tokenId, TOKEN_ID);
  for (const token of [DEPLOY_TOKEN, BOOTSTRAP_TOKEN]) assert.equal(JSON.stringify([f.snapshots, f.notes]).includes(token), false);
  const before = f.calls.length;
  await ensureDeploymentToken({ ...f.opts, bootstrap: () => assert.fail('must not ask for a setup token again') });
  assert.equal(f.calls.slice(before).every(call => call.method === 'GET'), true);
  assert.equal(f.records.tokens.length, 1);
});

test('an ambiguous token creation stops retries and preserves only reconciliation metadata', async () => {
  const f = await fixture(); f.modes.loseTokenResponse = true;
  await assert.rejects(ensureDeploymentToken(f.opts), /needs reconciliation/);
  assert.equal(f.state.pending, 'cloudflare-token');
  assert.equal(f.state.tokenId, undefined);
  await assert.rejects(ensureDeploymentToken(f.opts), /needs reconciliation/);
  assert.equal(f.records.tokens.length, 1);
  assert.equal(f.records.secrets.length, 0);
  assert.equal(JSON.stringify(f.snapshots).includes(DEPLOY_TOKEN), false);
});

test('a lost vault response is recovered by verified readback without duplicating or overwriting the token', async () => {
  const f = await fixture(); f.modes.loseVaultResponse = true;
  await assert.rejects(ensureDeploymentToken(f.opts), /needs reconciliation/);
  assert.equal(f.state.pending, 'infisical-token');
  await ensureDeploymentToken(f.opts);
  assert.equal(f.state.pending, undefined);
  assert.equal(f.records.tokens.length, 1);
  assert.equal(f.calls.filter(call => call.path === '/api/v4/secrets/batch').length, 1);
});

test('failed vault storage retains the known token ID and never mints another on retry', async () => {
  const f = await fixture(); f.modes.failVaultBeforeWrite = true;
  await assert.rejects(ensureDeploymentToken(f.opts), /needs reconciliation/);
  assert.equal(f.state.tokenId, TOKEN_ID);
  assert.equal(f.records.secrets.length, 0);
  await assert.rejects(ensureDeploymentToken(f.opts), /needs reconciliation/);
  assert.equal(f.records.tokens.length, 1);
});

test('scope drift, changed credentials and revoked tokens cannot be silently replaced', async () => {
  const f = await fixture();
  await ensureDeploymentToken(f.opts);
  await assert.rejects(ensureDeploymentToken({ ...f.opts, scope: { ...f.opts.scope, environment: 'staging' } }), /needs reconciliation/);
  const row = f.records.secrets.find(row => row.secretKey === 'CLOUDFLARE_API_TOKEN');
  row.secretValue = 'another_private_token_fixture';
  await assert.rejects(ensureDeploymentToken(f.opts), /needs reconciliation/);
  row.secretValue = DEPLOY_TOKEN;
  f.modes.tokenStatus = 'disabled';
  await assert.rejects(ensureDeploymentToken(f.opts), /inactive or has changed/);
  assert.equal(f.records.tokens.length, 1);
});

test('zone ownership and unavailable permissions fail before creating a token', async () => {
  for (const change of [f => { f.zone.account.id = 'd'.repeat(32); }, f => { f.permissionGroups[0].is_selectable = false; }]) {
    const f = await fixture(); change(f);
    await assert.rejects(ensureDeploymentToken(f.opts), /selected Cloudflare account|permission is unavailable/);
    assert.equal(f.records.tokens.length, 0);
  }
});

test('hostname updates within the same zone reuse the token; another zone is rejected', async () => {
  const f = await fixture(); await ensureDeploymentToken(f.opts);
  f.opts.settings.KIT_BROKER_HOSTNAME = 'another.example.test';
  await ensureDeploymentToken(f.opts);
  f.opts.settings.KIT_BROKER_HOSTNAME = 'another.example.org';
  await assert.rejects(ensureDeploymentToken(f.opts), /outside the deployment token/);
  assert.equal(f.records.tokens.length, 1);
});

test('ordinary local deployment reads only its configured vault folder and rejects an account mismatch', async () => {
  const f = await fixture(); await ensureDeploymentToken(f.opts);
  const env = {
    KIT_BROKER_CI_PROJECT_ID: PROJECT, KIT_BROKER_CI_PROJECT_SLUG: 'app', KIT_BROKER_CI_DOMAIN: 'https://vault.example.test',
    KIT_BROKER_CI_ENVIRONMENT: 'production', KIT_BROKER_CI_SECRET_PATH: '/ci/example-broker',
    INFISICAL_TOKEN: 'fixture.vault.token', CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
  };
  const before = f.calls.length;
  assert.equal(await loadDeploymentToken(env, f.request), DEPLOY_TOKEN);
  assert.equal(f.calls.length, before + 1);
  const call = f.calls.at(-1);
  assert.equal(call.method, 'GET');
  assert.equal(new URL(call.url).searchParams.get('secretPath'), '/ci/example-broker');
  assert.equal(new URL(call.url).searchParams.get('includeImports'), 'false');
  assert.equal(new URL(call.url).searchParams.get('recursive'), 'false');
  await assert.rejects(loadDeploymentToken({ ...env, CLOUDFLARE_ACCOUNT_ID: 'd'.repeat(32) }, f.request), /No matching/);
});
