#!/usr/bin/env node
// Runs only on the trusted controller. Never prints credentials or provider responses.
import { generateKeyPairSync, randomBytes, createHash } from 'node:crypto';
import { readFile, mkdir, lstat, writeFile, rename, rm, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDelivery } from '../src/sealed-delivery.mjs';
import { authenticatedApp } from '../src/github-import.mjs';
import { requestJson } from '../src/api.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const filename = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,62}$/.test(value);
async function privateFile(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error('Private file permissions are invalid.');
  return readFile(file, 'utf8');
}
async function writePrivate(file, value, exclusive = false) {
  if (exclusive) return writeFile(file, value, { flag: 'wx', mode: 0o600 });
  const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try { await writeFile(temp, value, { flag: 'wx', mode: 0o600 }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
async function privateDirectory(dir) {
  await mkdir(dir, { mode: 0o700, recursive: true });
  const stat = await lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error('Private directory permissions are invalid.');
}
export async function enrollReceiver(dir) {
  if (!path.isAbsolute(dir)) throw new Error('Use an absolute private directory.');
  await privateDirectory(dir);
  const file = path.join(dir, 'identity.json');
  let identity;
  try { identity = JSON.parse(await privateFile(file)); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const keys = generateKeyPairSync('rsa', { modulusLength: 3072 });
    identity = { version: 1, privateKey: keys.privateKey.export({ format: 'jwk' }), publicKey: keys.publicKey.export({ format: 'jwk' }), token: randomBytes(32).toString('base64url') };
    await writePrivate(file, json(identity), true);
  }
  return { publicKey: identity.publicKey, tokenSha256: hash(identity.token) };
}

async function brokerRequest(config, token, body) {
  const url = new URL(`/v1/deliveries/${config.integration}`, config.origin);
  if (url.protocol !== 'https:' || url.origin !== config.origin || url.username || url.password) throw new Error('Invalid broker origin.');
  return requestJson(url, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}` }, body });
}

export async function receiveOnce(dir, { broker = brokerRequest, github = requestJson, request = fetch } = {}) {
  await privateDirectory(dir);
  const config = JSON.parse(await privateFile(path.join(dir, 'config.json')));
  const identity = JSON.parse(await privateFile(path.join(dir, 'identity.json')));
  if (!filename(config.integration) || !filename(config.project) || !['staging', 'production'].includes(config.target) ||
      !['repos', 'runners'].includes(config.kind) || !path.isAbsolute(config.outputDirectory) ||
      !config.names || Object.keys(config.names).sort().join(',') !== 'clientSecret,privateKey,webhookSecret') throw new Error('Invalid receiver configuration.');
  const lock = await open(path.join(dir, 'receiver.lock'), 'wx', 0o600);
  try {
    const reply = await broker(config, identity.token);
    if (reply.status !== 'ready') return { status: reply.status === 'delivered' ? 'delivered' : 'pending', integration: config.integration };
    const envelope = reply.envelope;
    const deliveryId = envelope?.context?.deliveryId;
    if (typeof deliveryId !== 'string' || !/^[a-f0-9-]{36}$/.test(deliveryId)) throw new Error('Invalid delivery.');
    const receiptFile = path.join(dir, 'receipt.json');
    let receipt;
    try { receipt = JSON.parse(await privateFile(receiptFile)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (receipt && receipt.deliveryId !== deliveryId) throw new Error('A different delivery requires an explicit credential migration.');
    const payload = await openDelivery(envelope, identity.privateKey, { integration: config.integration, project: config.project, target: config.target });
    if (!payload?.app || !payload.secrets || Object.keys(payload.secrets).length !== 3 ||
        Object.values(config.names).some(name => typeof payload.secrets[name] !== 'string' || !payload.secrets[name].trim() || payload.secrets[name].length > 16384)) throw new Error('Invalid credential bundle.');
    const { app, headers } = await authenticatedApp({ owner: config.owner, slug: config.slug }, payload.app.clientId, payload.secrets[config.names.privateKey], request);
    if (app.id !== payload.app.id || app.slug !== payload.app.slug) throw new Error('App identity changed.');
    const hook = await github('https://api.github.com/app/hook/config', { headers });
    const webhookUrl = new URL(hook.url);
    if (webhookUrl.protocol !== 'https:' || webhookUrl.username || webhookUrl.password || webhookUrl.hash || webhookUrl.search ||
        (config.webhookUrl && webhookUrl.href !== config.webhookUrl)) throw new Error('Configure the expected HTTPS webhook URL in GitHub first.');
    const updated = await github('https://api.github.com/app/hook/config', { method: 'PATCH', headers,
      body: { secret: payload.secrets[config.names.webhookSecret], content_type: 'json', insecure_ssl: '0' } });
    if (updated.url !== hook.url || updated.content_type !== 'json') throw new Error('Webhook configuration was not confirmed.');
    // Repeating the same PATCH is safe after a lost response; it never generates another value.
    const destination = path.join(config.outputDirectory, deliveryId);
    await privateDirectory(config.outputDirectory);
    let exists = false;
    try { await lstat(destination); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const files = { clientSecret: `${config.kind}-client-secret`, privateKey: `${config.kind}-private-key`, webhookSecret: `${config.kind}-webhook-secret` };
    if (exists) {
      await privateDirectory(destination);
      for (const [field, file] of Object.entries(files)) if (await privateFile(path.join(destination, file)) !== payload.secrets[config.names[field]]) throw new Error('Existing credential files differ.');
    } else {
      // A fresh random directory is assembled completely before the atomic rename.
      const temporary = path.join(config.outputDirectory, `.delivery-${randomBytes(12).toString('hex')}`);
      await mkdir(temporary, { mode: 0o700 });
      try {
        for (const [field, file] of Object.entries(files)) await writePrivate(path.join(temporary, file), payload.secrets[config.names[field]], true);
        const appConfig = { client_id: app.clientId, slug: app.slug, ...Object.fromEntries(Object.entries(files).map(([field, file]) => [({ clientSecret: 'client_secret', privateKey: 'private_key', webhookSecret: 'webhook_secret' })[field], { file: path.join(destination, file) }])) };
        await writePrivate(path.join(temporary, `${config.kind}.json`), json(appConfig), true);
        await rename(temporary, destination);
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }
    receipt = { deliveryId, integration: config.integration, status: 'staged', directory: destination, app, webhookUrl: hook.url, names: Object.values(config.names) };
    await writePrivate(receiptFile, json(receipt));
    await broker(config, identity.token, { deliveryId });
    return receipt;
  } finally { await lock.close(); await rm(path.join(dir, 'receiver.lock'), { force: true }); }
}

export async function main(argv) {
  if (argv.length !== 2 || !['enroll', 'receive'].includes(argv[0])) throw new Error('Usage: controller-receiver.mjs enroll|receive /private/directory');
  return argv[0] === 'enroll' ? enrollReceiver(argv[1]) : receiveOnce(argv[1]);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(() => { console.error('Kitbash controller delivery failed; credentials and provider responses were omitted.'); process.exitCode = 1; });
