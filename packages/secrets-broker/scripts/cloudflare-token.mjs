import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { requestJson } from '../src/api.mjs';

const ID = /^[a-f0-9]{32}$/i;
const TOKEN = /^[A-Za-z0-9_-]{16,256}$/;
const names = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
const digest = value => createHash('sha256').update(value).digest('hex');
const reconcile = () => { throw new Error('Cloudflare token provisioning needs reconciliation. Inspect .kitbash/setup-state.json, the named Cloudflare token, and the configured credential destination before retrying: a provider write may already have succeeded.'); };

// Cloudflare documents these template keys. The dashboard still requires the
// operator to choose resource scopes and finish creation; there is no callback.
export function bootstrapTokenUrl(workerName) {
  const url = new URL('https://dash.cloudflare.com/');
  url.searchParams.set('to', '/:account/api-tokens');
  url.searchParams.set('permissionGroupKeys', JSON.stringify([
    { key: 'account_api_tokens', type: 'edit' },
    { key: 'zone', type: 'read' },
  ]));
  url.searchParams.set('name', `Kitbash setup ${workerName}`);
  return url.href;
}

function cloudflare(token, request) {
  // Wrangler OAuth credentials are longer than account API tokens and can
  // contain JWT separators. This client also performs local-login preflights.
  if (typeof token !== 'string' || !/^[A-Za-z0-9._~+/-]{16,8192}={0,2}$/.test(token)) throw new Error('Invalid Cloudflare token format.');
  return async (endpoint, { query, ...options } = {}) => {
    const url = new URL(`https://api.cloudflare.com/client/v4${endpoint}`);
    if (query) url.search = new URLSearchParams(query).toString();
    let value;
    try { value = await requestJson(url, { ...options, request, headers: { authorization: `Bearer ${token}` } }); }
    catch (error) {
      const phase = endpoint === '/zones' ? 'zone discovery'
        : endpoint.endsWith('/permission_groups') ? 'permission discovery'
        : endpoint.endsWith('/verify') ? 'token verification'
        : endpoint.startsWith('/zones/') ? 'zone verification'
        : endpoint.endsWith('/workers/scripts') ? 'Worker access verification'
        : options.method === 'POST' ? 'token creation' : 'token inventory';
      throw new Error(`Cloudflare request failed during ${phase}${Number.isInteger(error.status) ? ` (HTTP ${error.status})` : ''}. Check the selected account and token permissions. Provider responses were omitted.`);
    }
    if (value.success !== true || value.result === undefined) throw new Error('Cloudflare returned an invalid result. Provider responses were omitted.');
    return value;
  };
}

async function findZone(api, accountId, hostname) {
  // Exact name queries, longest suffix first, avoid fetching unrelated zones.
  const parts = hostname.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const name = parts.slice(i).join('.');
    const listing = await api('/zones', { query: { 'account.id': accountId, name, per_page: '50' } });
    if (!Array.isArray(listing.result) || listing.result.length > 1 || (listing.result_info?.total_pages ?? 1) > 1) throw new Error('Cannot uniquely identify the hostname zone.');
    if (!listing.result.length) continue;
    const zone = listing.result[0];
    if (!ID.test(zone.id ?? '') || zone.name !== name || zone.account?.id !== accountId || zone.status !== 'active') throw new Error('The hostname zone must be active in the selected Cloudflare account.');
    return zone;
  }
  throw new Error('No active Cloudflare zone was found for this hostname in the selected account. Give the setup token Zone Read access to that zone.');
}

function tokenPolicies(groups, accountId, zoneId) {
  if (!Array.isArray(groups)) throw new Error('Cannot read Cloudflare permission groups.');
  const permission = (name, scope) => {
    // Resolve provider IDs at runtime; never allow caller-supplied permissions.
    const found = groups.filter(group => group.name === name && group.scopes?.includes(scope) && group.is_selectable !== false);
    if (found.length !== 1 || !ID.test(found[0].id)) throw new Error(`Required Cloudflare permission is unavailable: ${name}.`);
    return { id: found[0].id };
  };
  return [
    { effect: 'allow', resources: { [`com.cloudflare.api.account.${accountId}`]: '*' }, permission_groups: [
      permission('Workers Scripts Write', 'com.cloudflare.api.account'),
      permission('Account Settings Read', 'com.cloudflare.api.account'),
    ] },
    { effect: 'allow', resources: { [`com.cloudflare.api.account.zone.${zoneId}`]: '*' }, permission_groups: [
      permission('Workers Routes Write', 'com.cloudflare.api.account.zone'),
      permission('Zone Read', 'com.cloudflare.api.account.zone'),
    ] },
  ];
}

function canonicalPolicies(policies) {
  if (!Array.isArray(policies)) return undefined;
  return policies.map(policy => ({ effect: policy.effect, resources: policy.resources,
    permission_groups: policy.permission_groups?.map(group => group.id).sort(),
  })).sort((a, b) => JSON.stringify(a.resources).localeCompare(JSON.stringify(b.resources)));
}

export async function readDeploymentCredentials(scope, infisical) {
  const result = await infisical('/api/v4/secrets', { query: {
    projectId: scope.projectId, environment: scope.environment, secretPath: scope.secretPath,
    viewSecretValue: 'true', expandSecretReferences: 'false', includeImports: 'false', includePersonalOverrides: 'false', recursive: 'false',
  } });
  if (!Array.isArray(result.secrets)) throw new Error('Cannot read the Infisical deployment folder.');
  const values = {};
  for (const row of result.secrets) {
    if (!names.includes(row.secretKey)) throw new Error('The broker CI folder must contain only its Cloudflare token and account ID. Use a dedicated folder.');
    if (row.workspace !== scope.projectId || row.environment !== scope.environment || row.type !== 'shared' ||
        (row.secretPath !== undefined && row.secretPath !== scope.secretPath) || row.secretValueHidden || typeof row.secretValue !== 'string' || Object.hasOwn(values, row.secretKey)) throw new Error('Infisical returned credentials outside the expected deployment scope.');
    values[row.secretKey] = row.secretValue;
  }
  if (Object.keys(values).length && (!ID.test(values.CLOUDFLARE_ACCOUNT_ID ?? '') || !TOKEN.test(values.CLOUDFLARE_API_TOKEN ?? ''))) throw new Error('The Infisical deployment credential pair is incomplete or invalid. Reconcile the folder before retrying.');
  return values;
}

async function verify(values, accountId, tokenId, zoneId, hostname, request) {
  if (values.CLOUDFLARE_ACCOUNT_ID !== accountId) throw new Error('The stored deployment token belongs to a different account.');
  const api = cloudflare(values.CLOUDFLARE_API_TOKEN, request);
  const { result } = await api(`/accounts/${accountId}/tokens/verify`);
  if (result.status !== 'active' || result.id !== tokenId) throw new Error('The stored Cloudflare deployment token is inactive or has changed. Reconcile it before retrying setup.');
  if (!ID.test(zoneId ?? '')) reconcile();
  const zone = (await api(`/zones/${zoneId}`)).result;
  if (zone.id !== zoneId || zone.account?.id !== accountId || zone.status !== 'active' || typeof zone.name !== 'string' ||
      !(hostname === zone.name || hostname.endsWith(`.${zone.name}`))) throw new Error('The hostname is outside the deployment token\'s active Cloudflare zone.');
}

/** Operator-side only. Raw values travel in memory from Cloudflare to Infisical
 * and Wrangler; checkpoints contain IDs/digests, never either bearer token. */
export async function ensureDeploymentToken({ scope, settings, infisical, checkpoint, bootstrap, request = fetch, note = () => {} }) {
  const accountId = settings.CLOUDFLARE_ACCOUNT_ID;
  const hostname = settings.KIT_BROKER_HOSTNAME;
  const worker = settings.KIT_BROKER_WORKER_NAME;
  const { state } = checkpoint;
  const fingerprint = digest(JSON.stringify({ version: 1, scope, accountId, worker }));
  if (state.fingerprint && state.fingerprint !== fingerprint) reconcile();
  state.fingerprint = fingerprint;
  const existing = await readDeploymentCredentials(scope, infisical);
  if (existing.CLOUDFLARE_API_TOKEN) {
    if (!state.tokenId || state.tokenDigest !== digest(existing.CLOUDFLARE_API_TOKEN)) reconcile();
    await verify(existing, accountId, state.tokenId, state.zoneId, hostname, request);
    delete state.pending;
    state.configured = true;
    await checkpoint.save();
    note('Reusing the existing Cloudflare deployment token from Infisical.');
    return existing;
  }
  if (state.pending || state.tokenId || state.configured) reconcile();
  const values = await createDeploymentToken({ settings, checkpoint, bootstrap, request, note, fingerprint });
  state.pending = 'infisical-token';
  await checkpoint.save();
  try {
    const result = await infisical('/api/v4/secrets/batch', { method: 'POST', body: {
      projectId: scope.projectId, environment: scope.environment, secretPath: scope.secretPath,
      secrets: names.map(secretKey => ({ secretKey, secretValue: values[secretKey], skipMultilineEncoding: true })),
    } });
    if (result.approval || !isDeepStrictEqual(await readDeploymentCredentials(scope, infisical), values)) reconcile();
  } catch { reconcile(); }
  delete state.pending;
  state.configured = true;
  await checkpoint.save();
  note('Cloudflare deployment token stored in Infisical. The setup token was not saved; you can revoke it in Cloudflare.');
  return values;
}

/** Creates a token once; the caller must deliver it to its credential destination.
 * Pending writes and metadata survive failures without recording secret values. */
export async function createDeploymentToken({ settings, checkpoint, bootstrap, fingerprint, request = fetch, note = () => {} }) {
  const accountId = settings.CLOUDFLARE_ACCOUNT_ID;
  const hostname = settings.KIT_BROKER_HOSTNAME;
  const worker = settings.KIT_BROKER_WORKER_NAME;
  const { state } = checkpoint;
  if (state.pending || state.tokenId || state.configured) reconcile();
  const creator = await bootstrap();
  const api = cloudflare(creator, request);
  const zone = await findZone(api, accountId, hostname);
  const base = `/accounts/${accountId}/tokens`;
  const groups = await api(`${base}/permission_groups`);
  if (groups.result_info?.total_count > groups.result.length) throw new Error('Cloudflare returned an incomplete permission catalogue. No token was created.');
  const policies = tokenPolicies(groups.result, accountId, zone.id);
  // The destination makes names deterministic across separate template copies.
  const name = `kitbash-${worker}-${fingerprint.slice(0, 12)}`;
  for (let page = 1; ; page++) {
    const listing = await api(base, { query: { page: String(page), per_page: '50' } });
    if (!Array.isArray(listing.result) || listing.result.some(row => row.name === name)) reconcile();
    const info = listing.result_info;
    const pages = Number.isInteger(info?.total_count) && info.total_count >= 0 && Number.isInteger(info.per_page) && info.per_page > 0
      ? Math.ceil(info.total_count / info.per_page) : info?.total_pages;
    if (!Number.isInteger(pages) || pages < 0 || pages > 100 || (pages === 0 && listing.result.length)) throw new Error('Cannot inspect existing Cloudflare tokens completely.');
    if (page >= pages) break;
  }
  note(`Creating deployment access for Workers in account ${accountId} and routes in zone ${zone.name}. The deployment token cannot create tokens.`);
  state.tokenName = name;
  state.zoneId = zone.id;
  state.pending = 'cloudflare-token';
  await checkpoint.save();
  let created;
  try { created = (await api(base, { method: 'POST', body: { name, policies } })).result; }
  catch { reconcile(); }
  if (!ID.test(created?.id ?? '') || !TOKEN.test(created?.value ?? '')) reconcile();
  // Record the known ID before any further check, so an operator can revoke an
  // orphan if Cloudflare returns an unexpected policy or the vault write fails.
  state.tokenId = created.id;
  state.tokenDigest = digest(created.value);
  await checkpoint.save();
  if (created.name !== name || created.status !== 'active' || !isDeepStrictEqual(canonicalPolicies(created.policies), canonicalPolicies(policies))) reconcile();
  const values = { CLOUDFLARE_API_TOKEN: created.value, CLOUDFLARE_ACCOUNT_ID: accountId };
  await verify(values, accountId, state.tokenId, state.zoneId, hostname, request);
  return values;
}

export async function verifyDeploymentAccess(token, settings, request = fetch) {
  const api = cloudflare(token, request);
  const zone = await findZone(api, settings.CLOUDFLARE_ACCOUNT_ID, settings.KIT_BROKER_HOSTNAME);
  // Catch setup-only or zone-only tokens before storing them as deployment
  // credentials. Read access does not prove write access; deploy verifies that.
  const workers = await api(`/accounts/${settings.CLOUDFLARE_ACCOUNT_ID}/workers/scripts`);
  if (!Array.isArray(workers.result)) throw new Error('Cannot verify Worker access for the supplied deployment credential.');
  return zone;
}
