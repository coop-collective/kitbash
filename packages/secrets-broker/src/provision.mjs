import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PATH = /^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/;
const OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const fail = (code) => { throw new ProvisionError(code); };

// Errors are codes, never provider messages or response bodies.
export class ProvisionError extends Error {
  constructor(code) { super(code); this.name = 'ProvisionError'; this.code = code; }
}

function validateScope(config) {
  if (!UUID.test(config?.projectId ?? '') || !SLUG.test(config?.projectSlug ?? '') ||
      !SLUG.test(config?.environment ?? '') || !PATH.test(config?.secretPath ?? '') || config.secretPath === '/ci') fail('invalid_provision_policy');
  let url;
  try { url = new URL(config.domain); } catch { fail('invalid_provision_policy'); }
  if (url.protocol !== 'https:' || url.origin !== config.domain || url.username || url.password) fail('invalid_provision_policy');
}

export function githubPolicy(config, brokerCI = false) {
  validateScope(config);
  const g = config.github;
  if (!g || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(g.repository ?? '') ||
      !(brokerCI ? /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(g.environment ?? '') : ['staging', 'production'].includes(g.environment)) || !/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(g.ref ?? '') ||
      g.ref.includes('..') || !/^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/.test(g.workflow ?? '') ||
      !SLUG.test(g.roleSlug ?? '') || !SLUG.test(g.identityName ?? '')) fail('invalid_github_policy');
  const audience = g.audience ?? `kitbash:${g.repository}:${g.environment}`;
  // GitHub's default sub differs for old/new/renamed repositories. Bind the
  // individual immutable identity and workflow claims below, not a guessed sub.
  const subject = g.subject ?? '';
  if (!/^[A-Za-z0-9:_./-]{1,256}$/.test(audience) || !/^[A-Za-z0-9:@_./%-]{0,512}$/.test(subject)) fail('invalid_github_policy');
  return { ...g, audience, subject };
}

export function workerSyncPolicy(config) {
  validateScope(config);
  const c = config.cloudflare;
  if (!c || (!UUID.test(c.connectionId ?? '') && !SLUG.test(c.connectionName ?? '')) ||
      (c.connectionId !== undefined && !UUID.test(c.connectionId)) || (c.connectionName !== undefined && !SLUG.test(c.connectionName)) || !SLUG.test(c.workerName ?? '') ||
      !SLUG.test(c.syncName ?? '') || (c.autoSync !== undefined && typeof c.autoSync !== 'boolean')) fail('invalid_worker_sync_policy');
  return { ...c, autoSync: c.autoSync === true };
}

function checkpointFor(checkpoint, policy) {
  if (!checkpoint?.state || typeof checkpoint.save !== 'function') fail('checkpoint_required');
  const fingerprint = createHash('sha256').update(JSON.stringify(policy)).digest('hex');
  const state = checkpoint.state;
  if (state.fingerprint && state.fingerprint !== fingerprint) fail('provision_policy_changed');
  if (state.pending) fail('provision_reconciliation_required');
  state.fingerprint = fingerprint;
  return state;
}

// Persist intent before mutation. A lost response cannot silently create a second
// identity/sync on retry. An operator must reconcile ambiguous writes in the broker.
async function writeStep(checkpoint, step, write, record) {
  checkpoint.state.pending = step;
  try { await checkpoint.save(); } catch { fail('checkpoint_failed'); }
  let result;
  try { result = await write(); } catch { fail('provision_write_unconfirmed'); }
  try { record(result); } catch { fail('provision_write_unconfirmed'); }
  delete checkpoint.state.pending;
  try { await checkpoint.save(); } catch {
    checkpoint.state.pending = step;
    fail('checkpoint_failed');
  }
  return result;
}

async function optional(api, endpoint, options) {
  try { return await api(endpoint, options); } catch (error) {
    if (error?.status === 404) return undefined;
    fail('provision_read_failed');
  }
}
async function read(api, endpoint, options) {
  const value = await optional(api, endpoint, options);
  if (value === undefined) fail('provision_resource_missing');
  return value;
}

function readerPermissions(config, brokerCI = false) {
  return [...new Set(brokerCI ? [config.secretPath] : ['/ci', config.secretPath])].map(secretPath => ({
    subject: 'secrets', action: ['describeSecret', 'readValue'],
    conditions: { environment: { $eq: config.environment }, secretPath: { $eq: secretPath } },
  }));
}
function validRole(role, config, policy, brokerCI) {
  if (!UUID.test(role?.id ?? '') || role.projectId !== config.projectId || role.slug !== policy.roleSlug ||
      !isDeepStrictEqual(role.permissions, readerPermissions(config, brokerCI))) fail('provision_role_mismatch');
}
function validIdentity(identity, config, policy) {
  if (!UUID.test(identity?.id ?? '') || identity.projectId !== config.projectId || identity.name !== policy.identityName ||
      !Array.isArray(identity.authMethods) || identity.authMethods.some(method => method !== 'oidc-auth')) fail('provision_identity_mismatch');
}

async function ensureGitHubEnvironment(config, policy, api, checkpoint) {
  const base = `/repos/${policy.repository}`;
  const repo = await read(api, base);
  if (!Number.isSafeInteger(repo.id) || repo.id <= 0 || !Number.isSafeInteger(repo.owner?.id) || repo.owner.id <= 0 || repo.full_name !== policy.repository) fail('github_repository_mismatch');
  const environmentPath = `${base}/environments/${encodeURIComponent(policy.environment)}`;
  let environment = await optional(api, environmentPath);
  if (!environment) {
    if (policy.environment !== 'staging') fail('production_environment_requires_reviewers');
    environment = await writeStep(checkpoint, 'github-environment', () => api(environmentPath, {
      method: 'PUT', body: { deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } },
    }), (value) => {
      if (value?.name !== policy.environment) fail('github_environment_mismatch');
      checkpoint.state.environmentCreated = true;
    });
  }
  if (environment.name !== policy.environment) fail('github_environment_mismatch');
  if (policy.environment === 'production' && !environment.protection_rules?.some(rule =>
    rule.type === 'required_reviewers' && rule.prevent_self_review === true && rule.reviewers?.length > 0)) fail('production_environment_requires_reviewers');
  if (checkpoint.state.environmentCreated) {
    if (environment.deployment_branch_policy?.custom_branch_policies !== true || environment.deployment_branch_policy?.protected_branches !== false) fail('github_environment_mismatch');
    const branchPath = `${environmentPath}/deployment-branch-policies`;
    const branch = policy.ref.slice('refs/heads/'.length);
    const listing = await read(api, branchPath, { query: { per_page: '100' } });
    if (!Array.isArray(listing.branch_policies) || listing.total_count !== listing.branch_policies.length ||
        listing.branch_policies.some(p => p.name !== branch || p.type !== 'branch')) fail('github_branch_policy_mismatch');
    if (!listing.branch_policies.length) await writeStep(checkpoint, 'github-branch-policy', () => api(branchPath, {
      method: 'POST', body: { name: branch, type: 'branch' },
    }), value => { if (value?.name !== branch || value.type !== 'branch') fail('github_branch_policy_mismatch'); });
  }
  return { repo, environmentPath };
}

/** Trusted policy only. API functions accept (path, {method,query,body}), sanitize
 * errors and expose numeric status. Checkpoint is private per target+operation. */
export async function provisionGitHub(config, { infisical, github, checkpoint }) {
  return provisionGitHubIdentity(config, { infisical, github, checkpoint });
}

/** Operator-only template setup. Each event gets an exact-workflow OIDC identity
 * that can read only the broker's dedicated deployment folder. No agent option
 * can select this profile or relax application production environment checks. */
export async function provisionBrokerGitHub(config, dependencies, eventName) {
  if (!['push', 'workflow_dispatch'].includes(eventName) || !config.secretPath?.startsWith('/ci/')) fail('invalid_github_policy');
  return provisionGitHubIdentity(config, dependencies, eventName);
}

async function provisionGitHubIdentity(config, { infisical, github, checkpoint }, brokerEvent) {
  const brokerCI = brokerEvent !== undefined;
  const policy = githubPolicy(config, brokerCI);
  const state = checkpointFor(checkpoint, { projectId: config.projectId, projectSlug: config.projectSlug, domain: config.domain, environment: config.environment, secretPath: config.secretPath, github: policy,
    ...(brokerCI ? { brokerEvent } : {}) });
  let repo, environmentPath;
  if (brokerCI) {
    // Setup creates missing environments separately and preserves existing protections.
    repo = await read(github, `/repos/${policy.repository}`);
    if (!Number.isSafeInteger(repo.id) || repo.id <= 0 || !Number.isSafeInteger(repo.owner?.id) || repo.owner.id <= 0 || repo.full_name !== policy.repository || `refs/heads/${repo.default_branch}` !== policy.ref) fail('github_repository_mismatch');
    environmentPath = `/repos/${policy.repository}/environments/${encodeURIComponent(policy.environment)}`;
    if ((await read(github, environmentPath)).name !== policy.environment) fail('github_environment_mismatch');
  } else ({ repo, environmentPath } = await ensureGitHubEnvironment(config, policy, github, checkpoint));
  const rolePath = `/api/v1/projects/${config.projectId}/roles`;
  let role = (await optional(infisical, `${rolePath}/slug/${policy.roleSlug}`))?.role;
  if (role && role.id !== state.roleId) fail('provision_role_already_exists');
  if (!role) {
    if (state.roleId) fail('provision_resource_missing');
    await writeStep(checkpoint, 'infisical-role', () => infisical(rolePath, { method: 'POST', body: {
      slug: policy.roleSlug, name: policy.roleSlug, permissions: readerPermissions(config, brokerCI),
      description: 'Kitbash GitHub deployment: exact environment and source folders only.',
    } }), value => { validRole(value?.role, config, policy, brokerCI); state.roleId = value.role.id; });
    role = (await read(infisical, `${rolePath}/slug/${policy.roleSlug}`)).role;
  }
  validRole(role, config, policy, brokerCI);
  const identityPath = `/api/v1/projects/${config.projectId}/identities`;
  if (!state.identityId) await writeStep(checkpoint, 'infisical-identity', () => infisical(identityPath, { method: 'POST', body: {
    name: policy.identityName, roles: [{ role: policy.roleSlug }], hasDeleteProtection: true,
  } }), value => { validIdentity(value?.identity, config, policy); state.identityId = value.identity.id; });
  const identity = (await read(infisical, `${identityPath}/${state.identityId}`)).identity;
  validIdentity(identity, config, policy);
  const membership = (await read(infisical, `/api/v1/projects/${config.projectId}/identity-memberships/${state.identityId}`)).identityMembership;
  if (membership?.project?.id !== config.projectId || membership.identityId !== state.identityId || membership.roles?.length !== 1 ||
      membership.roles[0].customRoleId !== state.roleId || membership.roles[0].isTemporary !== false) fail('provision_membership_mismatch');
  const oidcPath = `/api/v1/auth/oidc-auth/identities/${state.identityId}`;
  const oidc = {
    oidcDiscoveryUrl: OIDC_ISSUER, boundIssuer: OIDC_ISSUER,
    boundAudiences: policy.audience, boundSubject: policy.subject,
    boundClaims: {
      repository: policy.repository, repository_id: String(repo.id), repository_owner_id: String(repo.owner.id),
      ref: policy.ref, workflow_ref: `${policy.repository}/${policy.workflow}@${policy.ref}`,
      environment: policy.environment, event_name: brokerEvent ?? 'workflow_dispatch',
    },
    accessTokenTTL: 900, accessTokenMaxTTL: 900, accessTokenNumUsesLimit: 0,
  };
  const sameOidc = (value) => value?.identityId === state.identityId && Object.entries(oidc).every(([key, expected]) => isDeepStrictEqual(value[key], expected)) && !value.templateId;
  let auth = (await optional(infisical, oidcPath))?.identityOidcAuth;
  if (!auth) {
    if (identity.authMethods.length || state.oidcConfigured) fail('provision_oidc_mismatch');
    await writeStep(checkpoint, 'infisical-oidc', () => infisical(oidcPath, { method: 'POST', body: oidc }), value => {
      if (!sameOidc(value?.identityOidcAuth)) fail('provision_oidc_mismatch');
      state.oidcConfigured = true;
    });
    auth = (await read(infisical, oidcPath)).identityOidcAuth;
  }
  if (!sameOidc(auth)) fail('provision_oidc_mismatch');
  const identityVariable = brokerCI
    ? (brokerEvent === 'push' ? 'INFISICAL_PUSH_IDENTITY_ID' : 'INFISICAL_DISPATCH_IDENTITY_ID')
    : 'INFISICAL_IDENTITY_ID';
  const variables = {
    [identityVariable]: state.identityId, INFISICAL_PROJECT_SLUG: config.projectSlug,
    INFISICAL_DOMAIN: config.domain, INFISICAL_OIDC_AUDIENCE: policy.audience,
    INFISICAL_ENVIRONMENT_SLUG: config.environment, INFISICAL_SECRET_PATH: config.secretPath,
  };
  for (const [name, value] of Object.entries(variables)) {
    const endpoint = `${environmentPath}/variables/${name}`;
    const existing = await optional(github, endpoint);
    if (existing) {
      if (existing.name !== name || existing.value !== value) fail('github_variable_conflict');
      continue;
    }
    await writeStep(checkpoint, `github-variable-${name}`, () => github(`${environmentPath}/variables`, { method: 'POST', body: { name, value } }), () => {});
    const actual = await read(github, endpoint);
    if (actual?.name !== name || actual.value !== value) fail('github_variable_mismatch');
  }
  state.configured = true;
  try { await checkpoint.save(); } catch { fail('checkpoint_failed'); }
  return { status: 'configured', github: { configured: true } };
}

function syncMatches(sync, config, policy) {
  return UUID.test(sync?.id ?? '') && sync.projectId === config.projectId && sync.name === policy.syncName &&
    sync.connectionId === policy.connectionId && sync.connection?.app === 'cloudflare' && sync.connection.id === policy.connectionId &&
    sync.environment?.slug === config.environment && sync.folder?.path === config.secretPath &&
    sync.destination === 'cloudflare-workers' && sync.destinationConfig?.scriptId === policy.workerName &&
    sync.isAutoSyncEnabled === policy.autoSync && sync.syncOptions?.initialSyncBehavior === 'overwrite-destination' &&
    sync.syncOptions.disableSecretDeletion === true && sync.syncOptions.includeAllSubFolders === false &&
    sync.syncOptions.syncNonSecretBindings === false && !sync.syncOptions.keySchema;
}

export async function provisionWorkerSync(config, { infisical, checkpoint }) {
  const policy = workerSyncPolicy(config);
  if (!UUID.test(policy.connectionId ?? '')) fail('cloudflare_connection_required');
  const state = checkpointFor(checkpoint, { projectId: config.projectId, domain: config.domain, environment: config.environment, secretPath: config.secretPath, cloudflare: policy });
  const base = '/api/v1/secret-syncs/cloudflare-workers';
  let sync = (await optional(infisical, `${base}/sync-name/${policy.syncName}`, { query: { projectId: config.projectId } }))?.secretSync;
  if (sync && sync.id !== state.syncId) fail('provision_sync_already_exists');
  if (!sync) {
    if (state.syncId) fail('provision_resource_missing');
    await writeStep(checkpoint, 'infisical-worker-sync', () => infisical(base, { method: 'POST', body: {
      name: policy.syncName, projectId: config.projectId, connectionId: policy.connectionId,
      environment: config.environment, secretPath: config.secretPath, isAutoSyncEnabled: policy.autoSync,
      syncOptions: { initialSyncBehavior: 'overwrite-destination', disableSecretDeletion: true, includeAllSubFolders: false, syncNonSecretBindings: false },
      destinationConfig: { scriptId: policy.workerName },
    } }), value => {
      if (!syncMatches(value?.secretSync, config, policy)) fail('provision_sync_mismatch');
      state.syncId = value.secretSync.id;
    });
    sync = (await read(infisical, `${base}/${state.syncId}`)).secretSync;
  }
  if (!syncMatches(sync, config, policy)) fail('provision_sync_mismatch');
  state.configured = true;
  try { await checkpoint.save(); } catch { fail('checkpoint_failed'); }
  // Configured is not a claim that an asynchronous sync has delivered secrets.
  return { status: 'configured', workerSync: { configured: true } };
}


function connectionMatches(connection, config, name, accountId) {
  return UUID.test(connection?.id ?? '') && connection.projectId === config.projectId &&
    connection.app === 'cloudflare' && connection.method === 'api-token' &&
    (!name || connection.name === name) && (!accountId || connection.credentials?.accountId === accountId);
}

/** credentials are obtained by the trusted broker, never accepted as tool args. */
export async function connectCloudflare(config, { infisical, checkpoint, credentials = {} }) {
  validateScope(config);
  const c = config.cloudflare;
  if (!c || (c.connectionId !== undefined && !UUID.test(c.connectionId)) ||
      (c.connectionName !== undefined && !SLUG.test(c.connectionName)) || (!c.connectionId && !c.connectionName)) fail('invalid_cloudflare_connection_policy');
  const state = checkpointFor(checkpoint, { projectId: config.projectId, domain: config.domain, connectionId: c.connectionId, connectionName: c.connectionName });
  const base = '/api/v1/app-connections/cloudflare';
  const id = c.connectionId ?? state.connectionId;
  let connection;
  if (id) {
    connection = (await read(infisical, `${base}/${id}`)).appConnection;
  } else {
    if (!/^[a-f0-9]{32}$/i.test(credentials.accountId ?? '') || typeof credentials.apiToken !== 'string' ||
        credentials.apiToken.length < 16 || credentials.apiToken.length > 256 || /[\r\n\0]/.test(credentials.apiToken)) fail('cloudflare_broker_credentials_required');
    const existing = await optional(infisical, `${base}/connection-name/${c.connectionName}`, { query: { projectId: config.projectId } });
    if (existing) fail('cloudflare_connection_already_exists');
    await writeStep(checkpoint, 'infisical-cloudflare-connection', () => infisical(base, { method: 'POST', body: {
      name: c.connectionName, projectId: config.projectId, method: 'api-token',
      credentials: { accountId: credentials.accountId, apiToken: credentials.apiToken },
      isAutoRotationEnabled: false,
    } }), value => {
      if (!connectionMatches(value?.appConnection, config, c.connectionName, credentials.accountId)) fail('cloudflare_connection_mismatch');
      state.connectionId = value.appConnection.id;
    });
    connection = (await read(infisical, `${base}/${state.connectionId}`)).appConnection;
  }
  if (!connectionMatches(connection, config, c.connectionName, credentials.accountId) || (id && connection.id !== id)) fail('cloudflare_connection_mismatch');
  state.connectionId = connection.id;
  state.configured = true;
  try { await checkpoint.save(); } catch { fail('checkpoint_failed'); }
  return { status: 'configured', cloudflareConnection: { configured: true } };
}

/** Queue the configured native sync; completion is asynchronous. */
export async function requestWorkerSync(config, { infisical, checkpoint }) {
  const policy = workerSyncPolicy(config);
  if (!UUID.test(policy.connectionId ?? '')) fail('cloudflare_connection_required');
  const state = checkpointFor(checkpoint, { projectId: config.projectId, domain: config.domain, environment: config.environment, secretPath: config.secretPath, cloudflare: policy });
  if (!UUID.test(state.syncId ?? '')) fail('worker_sync_not_configured');
  const base = `/api/v1/secret-syncs/cloudflare-workers/${state.syncId}`;
  const sync = (await read(infisical, base)).secretSync;
  if (!syncMatches(sync, config, policy)) fail('provision_sync_mismatch');
  await writeStep(checkpoint, 'infisical-worker-sync-request', () => infisical(`${base}/sync-secrets`, { method: 'POST' }), () => {});
  return { status: 'pending', workerSync: { configured: true } };
}
