import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectRoom, retryDelay } from '../public/room-client.js';
test('backoff is bounded and jittered', () => {
  assert.equal(retryDelay(0, () => 0), 4250);
  assert.equal(retryDelay(12, () => 0.5), 30000);
});
test('browser reconnects with backoff, stops after explicit close, and does not replay sends', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const sockets = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    sent = [];
    constructor(url) { this.url = String(url); sockets.push(this); }
    send(data) { this.sent.push(data); }
    close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
  }
  const oldSocket = globalThis.WebSocket, oldLocation = globalThis.location;
  globalThis.WebSocket = FakeSocket; globalThis.location = new URL('https://example.com/');
  t.after(() => { globalThis.WebSocket = oldSocket; if (oldLocation) globalThis.location = oldLocation; else delete globalThis.location; });
  t.mock.method(Math, 'random', () => 0.5);
  const statuses = [], events = [];
  const client = connectRoom('lobby', (e) => events.push(e), (s) => statuses.push(s));
  assert.equal(sockets[0].url, 'wss://example.com/rooms/lobby');
  assert.equal(client.send('not connected'), false);
  sockets[0].readyState = 1; sockets[0].onopen(); client.send('once');
  sockets[0].close(1006); t.mock.timers.tick(4999); assert.equal(sockets.length, 1);
  t.mock.timers.tick(1); assert.equal(sockets.length, 2);
  sockets[1].readyState = 1; sockets[1].onopen();
  assert.deepEqual(sockets[1].sent, []);
  t.mock.timers.tick(20000); assert.deepEqual(sockets[1].sent, ['ping']);
  sockets[1].onmessage({ data: 'pong' }); assert.deepEqual(events, []);
  client.close(); const count = statuses.length;
  sockets[1].onclose({ code: 1006 }); t.mock.timers.tick(60000);
  assert.equal(sockets.length, 2); assert.equal(statuses.length, count);
});
