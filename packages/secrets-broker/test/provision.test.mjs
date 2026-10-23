import assert from 'node:assert/strict';
import test from 'node:test';
import { connectCloudflare, githubPolicy, provisionGitHub, provisionWorkerSync, requestWorkerSync, workerSyncPolicy } from '../src/provision.mjs';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const ROLE = '22222222-2222-4222-8222-222222222222';
const IDENTITY = '33333333-3333-4333-8333-333333333333';
const CONNECTION = '44444444-4444-4444-8444-444444444444';
const SYNC = '55555555-5555-4555-8555-555555555555';
const config = () => ({
  projectId: PROJECT, projectSlug: 'my-app', domain: 'https://app.infisical.com', environment: 'staging', secretPath: '/app',
  github: { repository: 'owner/app', environment: 'staging', ref: 'refs/heads/main', workflow: '.github/workflows/worker-deploy.yml', roleSlug: 'kit-app-staging', identityName: 'kit-app-staging' },
  cloudflare: { connectionId: CONNECTION, workerName: 'my-app-staging', syncName: 'my-app-staging' },
});
const missing = () => { throw Object.assign(new Error('secret-value-must-never-leak'), { status: 404 }); };
const copy = value => structuredClone(value);

function fixture({ existingEnvironment = false } = {}) {
  const state = {};
  const snapshots = [];
  const calls = [];
  const records = { variables: {}, branches: [], environment: existingEnvironment ? { name: 'staging' } : undefined };
  const checkpoint = { state, async save() { snapshots.push(copy(state)); } };
  async function github(path, options = {}) {
    const { method = 'GET', body } = options;
    calls.push({ provider: 'github', path, method, body });
    if (path === '/repos/owner/app' && method === 'GET') return { id: 123, owner: { id: 456 }, full_name: 'owner/app' };
    if (path === '/repos/owner/app/environments/staging') {
      if (method === 'PUT') records.environment = { name: 'staging', ...body };
      return copy(records.environment ?? missing());
    }
    if (path.endsWith('/deployment-branch-policies')) {
      if (method === 'POST') { records.branches.push({ id: 1, ...body }); return copy(records.branches.at(-1)); }
      return { total_count: records.branches.length, branch_policies: copy(records.branches) };
    }
    if (path.endsWith('/variables') && method === 'POST') { records.variables[body.name] = copy(body); return {}; }
    const name = path.split('/variables/')[1];
    if (name && method === 'GET') return copy(records.variables[name] ?? missing());
    throw new Error(`Unexpected GitHub test route: ${method} ${path}`);
  }
  async function infisical(path, options = {}) {
    const { method = 'GET', body } = options;
    calls.push({ provider: 'infisical', path, method, body });
    if (path === `/api/v1/projects/${PROJECT}/roles` && method === 'POST') {
      records.role = { id: ROLE, projectId: PROJECT, ...copy(body) }; return { role: copy(records.role) };
    }
    if (path === `/api/v1/projects/${PROJECT}/roles/slug/kit-app-staging` && method === 'GET') return { role: copy(records.role ?? missing()) };
    if (path === `/api/v1/projects/${PROJECT}/identities` && method === 'POST') {
      records.identity = { id: IDENTITY, projectId: PROJECT, name: body.name, authMethods: [] };
      records.membership = { project: { id: PROJECT }, identityId: IDENTITY, roles: [{ customRoleId: ROLE, isTemporary: false }] };
      return { identity: copy(records.identity) };
    }
    if (path === `/api/v1/projects/${PROJECT}/identities/${IDENTITY}` && method === 'GET') return { identity: copy(records.identity ?? missing()) };
    if (path === `/api/v1/projects/${PROJECT}/identity-memberships/${IDENTITY}` && method === 'GET') return { identityMembership: copy(records.membership ?? missing()) };
    if (path === `/api/v1/auth/oidc-auth/identities/${IDENTITY}`) {
      if (method === 'POST') { records.oidc = { identityId: IDENTITY, ...copy(body) }; records.identity.authMethods.push('oidc-auth'); }
      return { identityOidcAuth: copy(records.oidc ?? missing()) };
    }
    if (path === '/api/v1/app-connections/cloudflare' && method === 'POST') {
      records.connection = { ...copy(body), id: CONNECTION, app: 'cloudflare' };
      return { appConnection: copy(records.connection) };
    }
    if (path.startsWith('/api/v1/app-connections/cloudflare/') && method === 'GET') return { appConnection: copy(records.connection ?? missing()) };
    if (path.endsWith('/sync-secrets') && method === 'POST') return { secretSync: copy(records.sync) };
    if (path === '/api/v1/secret-syncs/cloudflare-workers' && method === 'POST') {
      records.sync = { ...copy(body), id: SYNC, environment: { slug: body.environment }, folder: { path: body.secretPath }, connection: { app: 'cloudflare', id: CONNECTION }, destination: 'cloudflare-workers' };
      return { secretSync: copy(records.sync) };
    }
    if (path.startsWith('/api/v1/secret-syncs/cloudflare-workers/') && method === 'GET') return { secretSync: copy(records.sync ?? missing()) };
    throw new Error(`Unexpected Infisical test route: ${method} ${path}`);
  }
  return { state, snapshots, records, calls, checkpoint, github, infisical };
}

test('GitHub setup creates exact-source reader identity and environment variables, never credentials', async () => {
  const f = fixture();
  const result = await provisionGitHub(config(), f);
  assert.deepEqual(result, { status: 'configured', github: { configured: true } });
  assert.deepEqual(f.records.role.permissions, ['/ci', '/app'].map(secretPath => ({
    subject: 'secrets', action: ['describeSecret', 'readValue'], conditions: { environment: { $eq: 'staging' }, secretPath: { $eq: secretPath } },
  })));
  assert.deepEqual(f.records.oidc.boundClaims, {
    repository: 'owner/app', repository_id: '123', repository_owner_id: '456', ref: 'refs/heads/main',
    workflow_ref: 'owner/app/.github/workflows/worker-deploy.yml@refs/heads/main', environment: 'staging', event_name: 'workflow_dispatch',
  });
  assert.equal(f.records.oidc.accessTokenTTL, 900);
  assert.equal(f.records.oidc.boundSubject, '');
  assert.equal(f.records.variables.INFISICAL_OIDC_AUDIENCE.value, f.records.oidc.boundAudiences);
  assert.equal(f.records.variables.INFISICAL_IDENTITY_ID.value, IDENTITY);
  assert.equal(f.records.variables.INFISICAL_ENVIRONMENT_SLUG.value, 'staging');
  assert.equal(f.records.variables.INFISICAL_SECRET_PATH.value, '/app');
  assert.deepEqual(f.records.branches, [{ id: 1, name: 'main', type: 'branch' }]);
  assert.ok(f.snapshots.some(s => s.pending === 'infisical-identity' && s.identityId === undefined));
  assert.ok(f.snapshots.some(s => s.identityId === IDENTITY && !s.pending));
  assert.ok(f.calls.every(c => !c.path.includes('/secrets') && !c.path.includes('universal-auth')));
  assert.equal(JSON.stringify(result).includes(IDENTITY), false);
  assert.equal(f.state.configured, true);
});

test('repeated configuration validates the saved identity without additional writes', async () => {
  const f = fixture();
  await provisionGitHub(config(), f);
  const firstCount = f.calls.length;
  await provisionGitHub(config(), f);
  assert.ok(f.calls.slice(firstCount).every(call => call.method === 'GET'));
});

test('an existing environment is preserved and conflicting variables are not overwritten', async () => {
  const f = fixture({ existingEnvironment: true });
  f.records.variables.INFISICAL_PROJECT_SLUG = { name: 'INFISICAL_PROJECT_SLUG', value: 'another-project' };
  await assert.rejects(provisionGitHub(config(), f), { code: 'github_variable_conflict' });
  assert.equal(f.records.variables.INFISICAL_PROJECT_SLUG.value, 'another-project');
  assert.ok(f.calls.every(c => !(c.provider === 'github' && c.method === 'PUT')));
});

test('production requires an existing environment with non-self-review protections before vault writes', async () => {
  const c = config(); c.github.environment = 'production'; c.environment = 'production';
  for (const environment of [undefined, { name: 'production', protection_rules: [] }, { name: 'production', protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ id: 1 }] }] }]) {
    const f = fixture();
    const github = async (path, options) => path.includes('/environments/production') ? (environment ?? missing()) : f.github(path, options);
    await assert.rejects(provisionGitHub(c, { ...f, github }), { code: 'production_environment_requires_reviewers' });
    assert.ok(f.calls.every(call => call.method === 'GET'));
  }
});

test('ambiguous write persists intent and blocks retries without leaking response errors', async () => {
  const f = fixture({ existingEnvironment: true });
  const infisical = async (path, options) => {
    const value = await f.infisical(path, options);
    if (path.endsWith('/identities') && options?.method === 'POST') throw new Error('SENSITIVE_PROVIDER_RESPONSE');
    return value;
  };
  await assert.rejects(provisionGitHub(config(), { ...f, infisical }), error => error.code === 'provision_write_unconfirmed' && !error.message.includes('SENSITIVE'));
  assert.equal(f.state.pending, 'infisical-identity');
  const count = f.calls.length;
  await assert.rejects(provisionGitHub(config(), f), { code: 'provision_reconciliation_required' });
  assert.equal(f.calls.length, count);
});

test('external role broadening or extra identity auth cannot silently become configured', async () => {
  for (const mutate of [f => f.records.role.permissions.push({ subject: 'secrets', action: 'read' }), f => f.records.identity.authMethods.push('universal-auth'), f => f.records.membership.roles.push({ role: 'admin' }), f => { f.records.oidc.boundClaims.ref = '*'; }]) {
    const f = fixture(); await provisionGitHub(config(), f); mutate(f);
    const count = f.calls.length;
    await assert.rejects(provisionGitHub(config(), f), /provision_(role|identity|membership|oidc)_mismatch/);
    assert.ok(f.calls.slice(count).every(call => call.method === 'GET'));
  }
});

test('existing role is not adopted and changing checkpoint policy cannot rebind access', async () => {
  const f = fixture(); f.records.role = { id: ROLE };
  await assert.rejects(provisionGitHub(config(), f), { code: 'provision_role_already_exists' });
  const other = fixture(); await provisionGitHub(config(), other);
  const changed = config(); changed.github.ref = 'refs/heads/feature';
  await assert.rejects(provisionGitHub(changed, other), { code: 'provision_policy_changed' });
});

test('Worker sync defaults to manual, no deletion/import/subfolders/nonsecret bindings', async () => {
  const f = fixture();
  const result = await provisionWorkerSync(config(), f);
  assert.deepEqual(result, { status: 'configured', workerSync: { configured: true } });
  assert.equal(f.records.sync.isAutoSyncEnabled, false);
  assert.deepEqual(f.records.sync.syncOptions, { initialSyncBehavior: 'overwrite-destination', disableSecretDeletion: true, includeAllSubFolders: false, syncNonSecretBindings: false });
  assert.equal(f.records.sync.destinationConfig.scriptId, 'my-app-staging');
  assert.ok(!JSON.stringify(result).includes(SYNC));
  const count = f.calls.length;
  await provisionWorkerSync(config(), f);
  assert.ok(f.calls.slice(count).every(call => call.method === 'GET'));
});

test('automatic sync is opt-in from trusted policy and returns configured rather than delivered', async () => {
  const f = fixture(); const c = config(); c.cloudflare.autoSync = true;
  assert.deepEqual(await provisionWorkerSync(c, f), { status: 'configured', workerSync: { configured: true } });
  assert.equal(f.records.sync.isAutoSyncEnabled, true);
});

test('sync conflicts and external destination drift fail without changing existing sync', async () => {
  const f = fixture(); f.records.sync = { id: SYNC };
  await assert.rejects(provisionWorkerSync(config(), f), { code: 'provision_sync_already_exists' });
  const g = fixture(); await provisionWorkerSync(config(), g); g.records.sync.destinationConfig.scriptId = 'wrong-worker';
  const count = g.calls.length;
  await assert.rejects(provisionWorkerSync(config(), g), { code: 'provision_sync_mismatch' });
  assert.ok(g.calls.slice(count).every(call => call.method === 'GET'));
});

test('policy validation rejects glob claims, traversal and infrastructure sync source', () => {
  for (const mutate of [c => { c.github.ref = 'refs/heads/*'; }, c => { c.github.workflow = '.github/workflows/../evil.yml'; }, c => { c.github.audience = '*'; }, c => { c.secretPath = '/ci'; }, c => { c.domain = 'https://app.infisical.com@evil.test'; }]) {
    const c = config(); mutate(c); assert.throws(() => githubPolicy(c));
  }
  const c = config(); c.cloudflare.workerName = '../other'; assert.throws(() => workerSyncPolicy(c));
});


test('connection creation passes broker credentials directly and persists only an opaque id', async () => {
  const f = fixture(); const c = config(); delete c.cloudflare.connectionId; c.cloudflare.connectionName = 'kit-cloudflare-staging';
  const credentials = { accountId: 'a'.repeat(32), apiToken: 'PRIVATE_PROVIDER_TOKEN_FOR_TEST' };
  const result = await connectCloudflare(c, { ...f, credentials });
  assert.deepEqual(result, { status: 'configured', cloudflareConnection: { configured: true } });
  assert.equal(f.records.connection.credentials.apiToken, credentials.apiToken);
  assert.equal(f.records.connection.projectId, PROJECT);
  assert.equal(f.state.connectionId, CONNECTION);
  assert.ok(!JSON.stringify(f.snapshots).includes(credentials.apiToken));
  assert.ok(!JSON.stringify(result).includes(credentials.apiToken));
  const count = f.calls.length;
  await connectCloudflare(c, { ...f, credentials });
  assert.ok(f.calls.slice(count).every(call => call.method === 'GET'));
});

test('an existing connection is verified against its project and configured account', async () => {
  const f = fixture(); const c = config();
  f.records.connection = { id: CONNECTION, projectId: PROJECT, app: 'cloudflare', method: 'api-token', credentials: { accountId: 'a'.repeat(32) } };
  await connectCloudflare(c, { ...f, credentials: { accountId: 'a'.repeat(32) } });
  assert.ok(f.calls.every(call => call.method === 'GET'));
  f.records.connection.projectId = 'different-project';
  await assert.rejects(connectCloudflare(c, f), { code: 'cloudflare_connection_mismatch' });
});

test('lost connection responses are sanitized and cannot duplicate credentials on retry', async () => {
  const f = fixture(); const c = config(); delete c.cloudflare.connectionId; c.cloudflare.connectionName = 'kit-cloudflare-staging';
  const credentials = { accountId: 'a'.repeat(32), apiToken: 'PRIVATE_PROVIDER_TOKEN_FOR_TEST' };
  const infisical = async (path, options) => {
    if (options?.method === 'POST') throw new Error(credentials.apiToken);
    return f.infisical(path, options);
  };
  await assert.rejects(connectCloudflare(c, { ...f, infisical, credentials }), error => error.code === 'provision_write_unconfirmed' && !error.message.includes(credentials.apiToken));
  assert.equal(f.state.pending, 'infisical-cloudflare-connection');
  await assert.rejects(connectCloudflare(c, { ...f, credentials }), { code: 'provision_reconciliation_required' });
});

test('explicit sync validates the destination and reports only a queued operation', async () => {
  const f = fixture(); await provisionWorkerSync(config(), f);
  assert.deepEqual(await requestWorkerSync(config(), f), { status: 'pending', workerSync: { configured: true } });
  assert.ok(f.calls.some(call => call.path === `/api/v1/secret-syncs/cloudflare-workers/${SYNC}/sync-secrets` && call.method === 'POST'));
  f.records.sync.syncOptions.includeAllSubFolders = true;
  const count = f.calls.length;
  await assert.rejects(requestWorkerSync(config(), f), { code: 'provision_sync_mismatch' });
  assert.ok(f.calls.slice(count).every(call => call.method === 'GET'));
});


test('optional explicit immutable subject is accepted while wildcard subjects are rejected', () => {
  const c = config(); c.github.subject = 'repo:owner@456/app@123:environment:staging';
  assert.equal(githubPolicy(c).subject, c.github.subject);
  c.github.subject = 'repo:owner/*';
  assert.throws(() => githubPolicy(c), { code: 'invalid_github_policy' });
});


test('custom vault environment and folder are registered for Actions to fetch the same scope', async () => {
  const f = fixture(); const c = config(); c.environment = 'preproduction'; c.secretPath = '/runtime/app';
  await provisionGitHub(c, f);
  assert.equal(f.records.variables.INFISICAL_ENVIRONMENT_SLUG.value, 'preproduction');
  assert.equal(f.records.variables.INFISICAL_SECRET_PATH.value, '/runtime/app');
  assert.equal(f.records.role.permissions[1].conditions.environment.$eq, 'preproduction');
  assert.equal(f.records.role.permissions[1].conditions.secretPath.$eq, '/runtime/app');
  assert.equal(f.records.oidc.boundClaims.environment, 'staging');
});
