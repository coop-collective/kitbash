import { after, afterEach, before, test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, Request, convertV4MiniflareOptions } from 'miniflare';
import { parse } from 'jsonc-parser';

let mf;
const test = (name, run) => nodeTest(name, { timeout: 30_000 }, run);
const sockets = [];
before(async () => {
  const output = await build({ entryPoints: [fileURLToPath(new URL('./{{kit.fileSlug}}.fixture.ts', import.meta.url))], bundle: true,
    write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: output.outputFiles[0].text, compatibilityDate: '2026-10-12',
    durableObjects: { '{{kit.bindingName}}': { className: '{{kit.className}}', useSQLite: true } } }));
});
afterEach(() => { for (const socket of sockets.splice(0)) { try { socket.close(1000); } catch {} } });
after(async () => { await mf?.dispose(); });
const roomName = () => crypto.randomUUID();
function request(room, cookie = 'session=alice', origin = 'https://example.com') {
  return new Request(`https://example.com{{kit.routePrefix}}/${room}`, { headers: { upgrade: 'websocket', origin, cookie, 'x-room-user': 'attacker' } });
}
async function connect(room, cookie) {
  const response = await mf.dispatchFetch(request(room, cookie));
  assert.equal(response.status, 101);
  const socket = response.webSocket; sockets.push(socket);
  const messages = [], waiters = [];
  socket.addEventListener('message', (event) => {
    const value = event.data === 'pong' ? 'pong' : JSON.parse(String(event.data)), waiter = waiters.shift();
    if (waiter) waiter(value); else messages.push(value);
  });
  socket.accept();
  return { socket, next: () => messages.length ? Promise.resolve(messages.shift()) : new Promise(resolve => waiters.push(resolve)) };
}
const inspect = async (room, action) => (await mf.dispatchFetch(`https://example.com/__test/${room}`, {
  method: 'POST', body: JSON.stringify({ action }), headers: { 'content-type': 'application/json' },
})).json();

test('Wrangler merged the chosen DO binding and SQLite migration', async () => {
  const config = parse(await readFile('wrangler.jsonc', 'utf8'));
  assert.ok(config.durable_objects.bindings.some(binding => binding.name === '{{kit.bindingName}}' && binding.class_name === '{{kit.className}}'));
  assert.ok(config.migrations.some(migration => migration.tag === '{{kit.migrationTag}}' && migration.new_sqlite_classes?.includes('{{kit.className}}')));
});
test('rejects unauthenticated, cross-origin, query-bearing and forbidden-room upgrades', async () => {
  assert.equal((await mf.dispatchFetch(request(roomName(), ''))).status, 401);
  assert.equal((await mf.dispatchFetch(request(roomName(), 'session=alice', 'https://evil.example'))).status, 403);
  assert.equal((await mf.dispatchFetch(request('forbidden'))).status, 401);
  assert.equal((await mf.dispatchFetch(request('room?token=bad'))).status, 400);
});
test('broadcasts verified identity, persists snapshots, isolates tenants and auto-replies to ping', async () => {
  const name = roomName(), alice = await connect(name), bob = await connect(name, 'session=bob');
  await alice.next(); await bob.next();
  alice.socket.send(JSON.stringify({ text: 'x', userId: 'attacker' }));
  assert.deepEqual(await alice.next(), { type: 'message', userId: 'alice', text: 'x', seq: 1 });
  assert.equal((await bob.next()).userId, 'alice');
  alice.socket.send('ping'); assert.equal(await alice.next(), 'pong');
  bob.socket.close(1000);
  const other = await connect(name, 'session=other');
  assert.deepEqual(await other.next(), { type: 'snapshot', messages: [] });
  const reconnected = await connect(name);
  assert.deepEqual(await reconnected.next(), { type: 'snapshot', messages: [{ seq: 1, userId: 'alice', text: 'x' }] });
});
test('reconstructs the DO using serialized attachments and existing SQLite state', async () => {
  const name = roomName(), alice = await connect(name); await alice.next();
  assert.equal((await inspect(name, 'reconstruct')).n, 1);
  assert.equal((await alice.next()).text, 'w');
});
test('closes expired sessions without committing a message', async () => {
  const name = roomName(), alice = await connect(name); await alice.next();
  const closed = new Promise(resolve => alice.socket.addEventListener('close', event => resolve(event.code), { once: true }));
  assert.equal((await inspect(name, 'expired-message')).n, 0);
  assert.equal(await closed, 1008);
});
test('reclaims expired idle sockets before enforcing the configured connection limit', async () => {
  const name = roomName();
  for (let index = 0; index < {{kit.maxConnections}}; index++) { const client = await connect(name); await client.next(); }
  assert.equal((await mf.dispatchFetch(request(name))).status, 503);
  await inspect(name, 'expire');
  const replacement = await connect(name);
  assert.deepEqual(await replacement.next(), { type: 'snapshot', messages: [] });
});
test('retains the configured history bound and rejects an exhausted rate bucket', async () => {
  const name = roomName(), alice = await connect(name); await alice.next();
  assert.deepEqual(await inspect(name, 'history'), { n: {{kit.historySize}}, first: 11, last: {{kit.historySize}} + 10 });
});
for (const [name, input, code] of [
  ['malformed JSON', 'not-json', 1008],
  ['oversized text', JSON.stringify({ text: 'x'.repeat({{kit.textChars}} + 1) }), {{kit.textChars}} + 12 > {{kit.messageBytes}} ? 1009 : 1008],
  ['oversized frame', JSON.stringify({ text: 'ok', padding: 'x'.repeat({{kit.messageBytes}}) }), 1009],
  ['binary frame', new Uint8Array([1, 2]), 1009],
]) test(`rejects ${name}`, async () => {
  const alice = await connect(roomName()); await alice.next();
  const closed = new Promise(resolve => alice.socket.addEventListener('close', event => resolve(event.code), { once: true }));
  alice.socket.send(input);
  assert.equal(await closed, code);
});
