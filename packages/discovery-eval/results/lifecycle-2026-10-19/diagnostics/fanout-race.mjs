// Post-run diagnostic only. No imports from mutable apps, model calls, sockets,
// timers, Workers, SQLite processes, package installs, or benchmark mutations.
// Usage: node fanout-race.mjs [published-evidence-directory]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..'));
const expectedSnapshot = '69e05d390a0758f74b16b1b789ce8eb2cefcb4fc973cd8584cf996fc27dd20b6';
const expectedBlob = 'cd69fc1a534c63dbf27224d32bf4eee1eef5e66b07d109bd9a0dafce3483a6f1';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const { results } = JSON.parse(await readFile(path.join(root, 'evidence.json'), 'utf8'));
const stage = results.stages.find((entry) => entry.pair === 2 && entry.arm === 'scratch' && entry.phase === 'maintenance');
assert.equal(stage.finalSnapshot.sha256, expectedSnapshot);
assert.equal(hash(JSON.stringify(stage.finalSnapshot.files)), expectedSnapshot);
assert.equal(stage.finalSnapshot.files.find((file) => file.path === 'src/room.ts').sha256, expectedBlob);
const source = await readFile(path.join(root, 'blobs', expectedBlob), 'utf8');
assert.equal(hash(source), expectedBlob);

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const authStarted = deferred(), authReply = deferred();
const order = [], peers = [], messages = [], dedup = [];
let sequence = 0;
class Socket {
  events = [];
  serializeAttachment(value) { this.attachment = structuredClone(value); }
  deserializeAttachment() { return structuredClone(this.attachment); }
  send(value) { this.events.push(JSON.parse(value)); }
  close(code, reason) { this.closed = { code, reason }; }
}
class Pair {
  constructor() { this[0] = new Socket(); this[1] = new Socket(); }
}
const cursor = (rows) => ({ toArray: () => rows, one: () => { assert.equal(rows.length, 1); return rows[0]; } });
const sql = {
  exec(query, ...args) {
    if (query.startsWith('CREATE ')) return cursor([]);
    if (query.startsWith('SELECT m.seq')) {
      return cursor(messages.slice(-args[0]).map((message) => ({ ...message, client_id: dedup.find((entry) => entry.seq === message.seq)?.client_id ?? null })));
    }
    if (query.startsWith('SELECT seq, text FROM client_ids')) return cursor(dedup.filter((entry) => entry.user_id === args[0] && entry.client_id === args[1]));
    if (query.startsWith('INSERT INTO messages')) {
      const row = { seq: ++sequence, user_id: args[0], text: args[1] };
      messages.push(row); order.push('message-committed'); return cursor([{ seq: row.seq }]);
    }
    if (query.startsWith('INSERT INTO client_ids')) { dedup.push({ user_id: args[0], client_id: args[1], text: args[2], seq: args[3] }); return cursor([]); }
    if (query.startsWith('DELETE FROM messages')) return cursor([]); // One message: pruning has nothing to remove.
    throw new Error(`Unexpected query in pinned source: ${query}`);
  },
};
const ctx = {
  storage: { sql, transactionSync: (callback) => callback() },
  initialization: [],
  blockConcurrencyWhile(callback) { const promise = callback(); this.initialization.push(promise); return promise; },
  setWebSocketAutoResponse() {},
  acceptWebSocket(socket) { peers.push(socket); },
  getWebSockets() { return [...peers]; },
};
const env = {
  DB: {
    prepare() {
      return { bind(team, now, ...sessions) {
        return { async all() {
          assert.equal(team, 'team-1');
          assert.deepEqual(sessions, ['alice-session']);
          order.push('sender-authorization-pending'); authStarted.resolve();
          await authReply.promise;
          order.push('sender-authorization-resolved');
          return { results: [{ sid: 'alice-session', uid: 'user_alice', role: 'owner' }] };
        } };
      } };
    },
  },
};
class DurableObject {
  constructor(state, bindings) { this.ctx = state; this.env = bindings; }
}
const executable = stripTypeScriptTypes(source.replace("import { DurableObject } from 'cloudflare:workers';", ''), { mode: 'strip' })
  .replace('export class Room', 'class Room') + '\nglobalThis.DiagnosticRoom = Room;';
const scope = { DurableObject, TextEncoder, WebSocketPair: Pair, crypto: { randomUUID }, WebSocketRequestResponsePair: class {}, Response: class {
  constructor(body, init) { this.body = body; Object.assign(this, init); }
} };
runInNewContext(executable, scope, { filename: `immutable-src/room.ts@${expectedBlob}` });
const room = new scope.DiagnosticRoom(ctx, env);
await Promise.all(ctx.initialization);
const request = (user, session) => new Request('https://room.internal/connect', { headers: {
  Upgrade: 'websocket', 'X-Verified-User': user, 'X-Verified-Team': 'team-1', 'X-Verified-Session': session,
} });
await room.fetch(request('user_alice', 'alice-session'));
const alice = peers[0];
const sending = room.webSocketMessage(alice, JSON.stringify({ text: 'joined-before-commit' }));
await authStarted.promise;
assert.equal(messages.length, 0);
await room.fetch(request('user_bob', 'bob-session'));
const bob = peers[1];
order.push('newcomer-snapshot-sent-before-commit');
assert.equal(bob.events.length, 1);
assert.equal(bob.events[0].type, 'snapshot');
assert.equal(bob.events[0].messages.length, 0);
authReply.resolve();
await sending;
order.push('broadcast-finished');
assert.equal(messages.length, 1);
assert.equal(alice.events.filter((event) => event.type === 'message').length, 1);
assert.equal(bob.events.filter((event) => event.type === 'message').length, 0);
console.log(JSON.stringify({
  diagnostic: 'immutable-source-delayed-D1-join', modelCalls: 0, runtime: 'deterministic class mocks, not Workers runtime',
  snapshotSha256: expectedSnapshot, blobSha256: expectedBlob, order,
  storedMessages: messages.length, existingPeerMessages: 1, newcomerSnapshotMessages: 0, newcomerLiveMessages: 0,
  findingReproduced: true,
}, null, 2));
