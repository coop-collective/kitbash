// Post-run diagnostic of an exact immutable class; no timers, network or app changes.
// Usage: node expired-fanout.mjs [published-evidence-directory]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..'));
const snapshotHash = '8cd9737798117e97316f8ea611980e1da4be0c156076ea5cbe67579431dce0af';
const sourceHash = '9bbc8d00c25c6b636e44114deca96684ef6a7d861bfc5618773465d8256b647e';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const { results } = JSON.parse(await readFile(path.join(root, 'evidence.json'), 'utf8'));
const stage = results.stages.find((entry) => entry.pair === 3 && entry.arm === 'reuse' && entry.phase === 'integration');
assert.equal(stage.finalSnapshot.sha256, snapshotHash);
assert.equal(hash(JSON.stringify(stage.finalSnapshot.files)), snapshotHash);
assert.equal(stage.finalSnapshot.files.find((file) => file.path === 'src/room.ts').sha256, sourceHash);
const source = await readFile(path.join(root, 'blobs', sourceHash), 'utf8');
assert.equal(hash(source), sourceHash);

let now = 0;
const peers = [], messages = [];
class Socket {
  events = [];
  serializeAttachment(value) { this.attachment = structuredClone(value); }
  deserializeAttachment() { return structuredClone(this.attachment); }
  send(value) { this.events.push(JSON.parse(value)); }
  close(code, reason) { this.closed = { code, reason }; }
}
class Pair { constructor() { this[0] = new Socket(); this[1] = new Socket(); } }
const cursor = (rows) => ({ toArray: () => rows, one: () => { assert.equal(rows.length, 1); return rows[0]; } });
const ctx = {
  storage: {
    transactionSync: (callback) => callback(),
    sql: { exec(query, ...args) {
      if (query.startsWith('CREATE ') || query.startsWith('DELETE ')) return cursor([]);
      if (query.startsWith('SELECT ')) return cursor(messages.slice(-50));
      if (query.startsWith('INSERT INTO messages')) {
        const row = { seq: messages.length + 1, userId: args[0], text: args[1] };
        messages.push(row); return cursor([row]);
      }
      throw new Error(`Unexpected pinned-source query: ${query}`);
    } },
  },
  setWebSocketAutoResponse() {}, acceptWebSocket(socket) { peers.push(socket); }, getWebSockets() { return [...peers]; },
};
class DurableObject { constructor(state, bindings) { this.ctx = state; this.env = bindings; } }
const executable = stripTypeScriptTypes(source.replace("import { DurableObject } from 'cloudflare:workers';", ''), { mode: 'strip' })
  .replace('export class TeamRoom', 'class TeamRoom') + '\nglobalThis.DiagnosticRoom = TeamRoom;';
const scope = { DurableObject, TextEncoder, Date: { now: () => now }, WebSocketPair: Pair, WebSocketRequestResponsePair: class {}, Response: class {
  constructor(body, init) { this.body = body; Object.assign(this, init); }
} };
runInNewContext(executable, scope, { filename: `immutable-src/room.ts@${sourceHash}` });
const room = new scope.DiagnosticRoom(ctx, {});
const request = (user, expiry) => new Request('https://room.internal/', { headers: {
  Upgrade: 'websocket', 'x-room-user': user, 'x-room-expires': String(expiry),
} });
// Bob's actual session expires at 1,000ms; Alice connects while it is still live.
await room.fetch(request('user_bob', 1000));
const bob = peers[0];
now = 500;
await room.fetch(request('user_alice', 5000));
const alice = peers[1];
now = 2000;
assert.ok(bob.attachment.expiresAt <= now && alice.attachment.expiresAt > now);
room.webSocketMessage(alice, JSON.stringify({ text: 'after-recipient-session-expiry' }));
assert.equal(messages.length, 1);
assert.equal(bob.events.filter((event) => event.type === 'message').length, 1);
assert.equal(bob.closed, undefined);
console.log(JSON.stringify({
  diagnostic: 'immutable-source-expired-recipient-fanout', modelCalls: 0, runtime: 'deterministic class mocks, not Workers runtime',
  snapshotSha256: snapshotHash, blobSha256: sourceHash, now, recipientExpiresAt: bob.attachment.expiresAt,
  senderExpiresAt: alice.attachment.expiresAt, expiredRecipientMessages: 1, expiredRecipientClosed: false,
  findingReproduced: true,
}, null, 2));
