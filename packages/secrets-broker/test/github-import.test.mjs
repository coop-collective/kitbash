import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDeliveryFlow, integrationConfig, prepareGitHubDelivery } from '../src/github-import.mjs';
import { createUploadFlow } from '../src/uploads.mjs';
import { openDelivery, sealDelivery } from '../src/sealed-delivery.mjs';
import { enrollReceiver, receiveOnce } from '../scripts/controller-receiver.mjs';

const receiverKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const appKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' });
const clientSecret = 'fixture-github-client-secret';
const webhookSecret = 'fixture-existing-webhook-secret-0123456789';
const receiverToken = 'r'.repeat(43);
const hash = value => createHash('sha256').update(value).digest('hex');
const names = { clientSecret: 'APP_CLIENT_SECRET', privateKey: 'APP_PRIVATE_KEY', webhookSecret: 'APP_WEBHOOK_SECRET' };
const app = { id: 42, client_id: 'Iv1.fixture', slug: 'enginebox-runners', owner: { login: 'coop-collective' } };
const config = { principal: 'grok-bot', project: 'enginebox', target: 'production', owner: 'coop-collective', slug: app.slug,
  names, webhookBinding: 'KIT_DELIVERY_AAAAAAAAAAAAAAAA', controller: { label: 'Engine Box controller', publicKey: receiverKeys.publicKey.export({ format: 'jwk' }), tokenSha256: hash(receiverToken) } };

function fixture() {
  let uploads = {}, state = {}, creates = 0;
  const values = new Map([[names.webhookSecret, webhookSecret]]), mode = {};
  const storage = { listNames: async () => new Set(values.keys()), createMany: async entries => {
    creates++;
    for (const [i, entry] of entries.entries()) if (!mode.partial || i === 0) values.set(entry.name, entry.value);
    if (mode.lost || mode.partial) throw new Error('raw-provider-response-must-not-escape');
  } };
  const upload = () => createUploadFlow({ principal: 'grok-bot', project: 'enginebox', target: 'production', epoch: 'epoch',
    rules: { [names.clientSecret]: { generate: false }, [names.privateKey]: { generate: false } }, state: uploads, storage,
    save: async (next, prepared) => { uploads = structuredClone(next); if (prepared) state = structuredClone(prepared); },
    prepare: async (row, values) => prepareGitHubDelivery({ id: 'enginebox-runners', config, metadata: row.metadata, values,
      readWebhook: async () => webhookSecret, request: async (url, options) => {
        assert.equal(url, 'https://api.github.com/app'); assert.equal(options.redirect, 'manual');
        return Response.json(mode.app ?? app);
      } }),
  });
  const flow = () => createDeliveryFlow({ id: 'enginebox-runners', config: mode.config ?? config, state, storage, save: async next => { state = structuredClone(next); } });
  const begin = async () => {
    const result = await upload().begin({ operation: 'begin', project: 'enginebox', target: 'production', names: [names.clientSecret, names.privateKey],
      delivery: 'enginebox-runners', metadata: { clientId: app.client_id } });
    return { id: result.uploadId, capability: result.path.split('/').at(-1), body: { secrets: { [names.clientSecret]: clientSecret, [names.privateKey]: appKey } } };
  };
  return { upload, flow, begin, values, mode, state: () => ({ state, uploads }), creates: () => creates };
}

test('generic file upload preserves the existing webhook and stages only encrypted controller credentials', async () => {
  const f = fixture(), h = await f.begin();
  const result = await f.upload().submit(h.id, h.capability, h.body);
  assert.equal(result.status, 'stored');
  assert.equal(f.values.get(names.webhookSecret), webhookSecret);
  assert.equal(f.values.get(names.privateKey), appKey);
  assert.equal(f.values.get(names.clientSecret), clientSecret);
  for (const value of [appKey, clientSecret, webhookSecret, receiverToken]) assert.equal(JSON.stringify({ result, state: f.state() }).includes(JSON.stringify(value).slice(1, -1)), false);
  await assert.rejects(f.flow().delivery('x'.repeat(43)), /forbidden/);
  const delivery = await f.flow().delivery(receiverToken);
  const payload = await openDelivery(delivery.envelope, receiverKeys.privateKey.export({ format: 'jwk' }), { integration: 'enginebox-runners', project: 'enginebox', target: 'production' });
  assert.equal(payload.secrets[names.webhookSecret], webhookSecret);
  await assert.rejects(openDelivery(delivery.envelope, receiverKeys.privateKey.export({ format: 'jwk' }), { target: 'staging' }), /forbidden/);
  assert.equal(f.creates(), 1);
  await f.flow().acknowledge(receiverToken, delivery.envelope.context.deliveryId);
  assert.equal(f.state().state.envelope, undefined);
  assert.equal((await f.flow().status()).status, 'delivered');
});

test('wrong App and changed controller identity are rejected without adopting credentials', async () => {
  const f = fixture(), h = await f.begin();
  f.mode.app = { ...app, owner: { login: 'another-owner' } };
  await assert.rejects(f.upload().submit(h.id, h.capability, h.body), /forbidden/);
  assert.equal(f.creates(), 0);
  f.mode.app = app;
  await f.upload().submit(h.id, h.capability, h.body);
  f.mode.config = { ...config, controller: { ...config.controller, tokenSha256: 'f'.repeat(64) } };
  await assert.rejects(f.flow().status(), /conflict/);
  assert.throws(() => integrationConfig({ KIT_BROKER_INTEGRATIONS: JSON.stringify({ demo: { ...config, controller: { ...config.controller, publicKey: receiverKeys.privateKey.export({ format: 'jwk' }) } } }) }), /unavailable/);
});

test('uncertain provider writes resume delivery by metadata; partial writes remain pending', async () => {
  for (const mode of ['lost', 'partial']) {
    const f = fixture(), h = await f.begin(); f.mode[mode] = true;
    assert.equal((await f.upload().submit(h.id, h.capability, h.body)).status, 'pending');
    assert.equal((await f.flow().status()).status, mode === 'lost' ? 'awaiting-controller' : 'pending');
    assert.equal(f.creates(), 1);
    assert.equal(JSON.stringify(f.state()).includes(clientSecret), false);
  }
});

test('controller decrypts directly to private files, configures the matching webhook and safely retries a lost acknowledgement', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kitbash-receiver-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const publicIdentity = await enrollReceiver(dir);
  const identity = JSON.parse(await readFile(path.join(dir, 'identity.json'), 'utf8'));
  assert.equal(publicIdentity.tokenSha256, hash(identity.token));
  assert.equal(JSON.stringify(publicIdentity).includes(identity.token), false);
  const receiverConfig = { integration: 'enginebox-runners', project: 'enginebox', target: 'production', kind: 'runners', owner: config.owner, slug: config.slug,
    origin: 'https://broker.example.test', names, outputDirectory: path.join(dir, 'credentials') };
  await writeFile(path.join(dir, 'config.json'), JSON.stringify(receiverConfig), { mode: 0o600 });
  const context = { integration: receiverConfig.integration, project: 'enginebox', target: 'production', deliveryId: '12345678-1234-4234-8234-123456789012' };
  const envelope = await sealDelivery({ app: { id: app.id, clientId: app.client_id, slug: app.slug, owner: app.owner.login },
    secrets: { [names.clientSecret]: clientSecret, [names.privateKey]: appKey, [names.webhookSecret]: webhookSecret } }, publicIdentity.publicKey, context);
  let acks = 0, patches = 0;
  const options = {
    request: async () => Response.json(app),
    broker: async (_config, token, body) => {
      assert.equal(token, identity.token);
      if (body) { acks++; if (acks === 1) throw new Error('Lost acknowledgement'); return { status: 'delivered' }; }
      return { status: 'ready', envelope };
    },
    github: async (url, opts) => {
      assert.equal(url, 'https://api.github.com/app/hook/config');
      if (opts.method === 'PATCH') { patches++; assert.equal(opts.body.secret, webhookSecret); }
      return { url: 'https://enginebox.example.test/api/github/webhook/runners', content_type: 'json' };
    },
  };
  await assert.rejects(receiveOnce(dir, options), /Lost acknowledgement/);
  const result = await receiveOnce(dir, options);
  assert.equal(result.status, 'staged'); assert.equal(patches, 2);
  for (const [field, filename] of Object.entries({ clientSecret: 'runners-client-secret', privateKey: 'runners-private-key', webhookSecret: 'runners-webhook-secret' })) {
    const file = path.join(result.directory, filename);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(await readFile(file, 'utf8'), ({ clientSecret, privateKey: appKey, webhookSecret })[field]);
  }
  for (const secret of [clientSecret, appKey, webhookSecret, identity.token]) assert.equal(JSON.stringify(result).includes(secret), false);
});
