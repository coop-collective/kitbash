import { createHash, createPrivateKey, randomUUID, sign, timingSafeEqual } from 'node:crypto';
import { ALIAS, NAME, TARGETS } from './config.mjs';
import { fail } from './errors.mjs';
import { requestJson } from './api.mjs';
import { sealDelivery } from './sealed-delivery.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (value, digest) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) && /^[a-f0-9]{64}$/.test(digest ?? '') && timingSafeEqual(Buffer.from(hash(value), 'hex'), Buffer.from(digest, 'hex'));

export function integrationConfig(env) {
  let entries;
  try { entries = JSON.parse(env.KIT_BROKER_INTEGRATIONS ?? '{}'); } catch { fail('unavailable'); }
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) fail('unavailable');
  for (const [id, row] of Object.entries(entries)) {
    if (!ALIAS.test(id) || !ALIAS.test(row?.principal) || !ALIAS.test(row?.project) || !TARGETS.includes(row?.target) ||
        !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(row.owner ?? '') || (row.slug !== undefined && !ALIAS.test(row.slug)) ||
        !NAME.test(row.webhookBinding ?? '') || !row.names || Object.keys(row.names).sort().join(',') !== 'clientSecret,privateKey,webhookSecret' ||
        Object.values(row.names).some(name => !NAME.test(name)) || new Set(Object.values(row.names)).size !== 3 ||
        row.controller?.publicKey?.kty !== 'RSA' || !/^[a-f0-9]{64}$/.test(row.controller?.tokenSha256 ?? '') ||
        Object.keys(row.controller.publicKey).some(key => !['kty', 'n', 'e', 'alg', 'ext', 'key_ops'].includes(key)) ||
        typeof row.controller.label !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/.test(row.controller.label)) fail('unavailable');
  }
  return entries;
}

export function controllerAuthorized(config, token) {
  if (!equal(token, config.controller.tokenSha256)) fail('forbidden');
}

export function githubJwt(clientId, pem, now = Date.now()) {
  if (typeof clientId !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(clientId) || typeof pem !== 'string' || pem.length > 16384) fail('invalid_request');
  let key;
  try { key = createPrivateKey(pem); } catch { fail('invalid_request'); }
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) fail('invalid_request');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: clientId, iat: Math.floor(now / 1000) - 60, exp: Math.floor(now / 1000) + 300 })}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`;
}

export async function authenticatedApp(config, clientId, pem, request = fetch) {
  const jwt = githubJwt(clientId, pem);
  const headers = { authorization: `Bearer ${jwt}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2026-03-10', 'user-agent': 'kitbash-secrets' };
  const app = await requestJson('https://api.github.com/app', { headers, request });
  if (!ALIAS.test(app.slug ?? '') || (config.slug !== undefined && app.slug !== config.slug) || app.owner?.login?.toLowerCase() !== config.owner.toLowerCase() || app.client_id !== clientId || !Number.isSafeInteger(app.id) || app.id <= 0) fail('forbidden');
  return { app: { id: app.id, clientId, slug: app.slug, owner: app.owner.login }, headers };
}

/** Optional GitHub adapter for a generic upload. Values remain inside broker/controller code. */
export async function prepareGitHubDelivery({ id, config, metadata, values, readWebhook, request = fetch }) {
  if (!metadata || Object.keys(metadata).join(',') !== 'clientId' || typeof metadata.clientId !== 'string') fail('invalid_request');
  const clientSecret = values[config.names.clientSecret], privateKey = values[config.names.privateKey];
  if (!clientSecret?.trim() || clientSecret.length > 4096 || /[\r\n\0]/.test(clientSecret)) fail('invalid_request');
  const { app } = await authenticatedApp(config, metadata.clientId, privateKey, request);
  const webhookSecret = await readWebhook();
  if (typeof webhookSecret !== 'string' || webhookSecret.length < 32 || webhookSecret.length > 4096) fail('unavailable');
  const deliveryId = randomUUID();
  const envelope = await sealDelivery({ app, secrets: {
    [config.names.clientSecret]: clientSecret, [config.names.privateKey]: privateKey, [config.names.webhookSecret]: webhookSecret,
  } }, config.controller.publicKey, { integration: id, project: config.project, target: config.target, deliveryId });
  return { fingerprint: hash(JSON.stringify(config)), app, envelope, deliveryId, phase: 'saving' };
}

/** Retains compatibility with already staged deliveries; browser upload sessions are no longer accepted. */
export function createDeliveryFlow({ id, config, state, save, storage }) {
  const persist = save;
  save = async next => { await persist(next); state = next; };
  const verifyConfig = () => { if (state.fingerprint && state.fingerprint !== hash(JSON.stringify(config))) fail('conflict'); };
  async function reconcile() {
    if (state.phase === 'saving') {
      const names = await storage.listNames();
      if ([config.names.clientSecret, config.names.privateKey].every(name => names.has(name))) await save({ ...state, phase: 'ready' });
    }
  }
  const status = () => ({ integration: id, project: config.project, target: config.target, type: 'github-app',
    status: state.phase === 'delivered' ? 'delivered' : state.phase === 'ready' ? 'awaiting-controller' : state.phase === 'saving' ? 'pending' : 'awaiting-upload',
    names: Object.values(config.names), uploadNames: [config.names.clientSecret, config.names.privateKey], metadataFields: ['clientId'],
    controller: config.controller.label, ...(state.app ? { app: state.app } : {}),
  });
  return {
    async status() { verifyConfig(); await reconcile(); return status(); },
    async delivery(token) {
      verifyConfig(); controllerAuthorized(config, token); await reconcile();
      return state.phase === 'ready' ? { status: 'ready', envelope: state.envelope } : { status: state.phase === 'delivered' ? 'delivered' : 'pending' };
    },
    async acknowledge(token, deliveryId) {
      verifyConfig(); controllerAuthorized(config, token);
      if (!['ready', 'delivered'].includes(state.phase) || deliveryId !== state.deliveryId) fail('conflict');
      await save({ ...state, phase: 'delivered', envelope: undefined });
      return status();
    },
  };
}
