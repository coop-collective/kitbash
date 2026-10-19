import { env, SELF, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { Room } from '../src/room';
const sockets: WebSocket[] = [];
afterEach(() => { for (const socket of sockets.splice(0)) { try { socket.close(1000); } catch {} } });
const roomName = () => crypto.randomUUID();
function request(room: string, cookie = 'session=alice', origin = 'https://example.com') {
  return new Request(`https://example.com/rooms/${room}`, { headers: { upgrade: 'websocket', origin, cookie, 'x-room-user': 'attacker' } });
}
async function connect(room: string, cookie?: string) {
  const response = await SELF.fetch(request(room, cookie));
  expect(response.status).toBe(101);
  const socket = response.webSocket!; sockets.push(socket);
  const messages: unknown[] = [], waiters: ((v: any) => void)[] = [];
  socket.addEventListener('message', (e) => { const value = e.data === 'pong' ? 'pong' : JSON.parse(String(e.data)); const waiter = waiters.shift(); if (waiter) waiter(value); else messages.push(value); });
  socket.accept();
  return { socket, next: () => messages.length ? Promise.resolve(messages.shift() as any) : new Promise<any>((resolve) => waiters.push(resolve)) };
}
describe('hibernating room', () => {
  it('rejects unauthenticated, cross-origin and forbidden-room upgrades', async () => {
    expect((await SELF.fetch(request(roomName(), ''))).status).toBe(401);
    expect((await SELF.fetch(request(roomName(), 'session=alice', 'https://evil.example'))).status).toBe(403);
    expect((await SELF.fetch(request('forbidden'))).status).toBe(401);
  });
  it('broadcasts authenticated identity, persists a snapshot, separates tenants and auto-replies to ping', async () => {
    const name = roomName(), alice = await connect(name), bob = await connect(name, 'session=bob');
    await alice.next(); await bob.next();
    alice.socket.send(JSON.stringify({ text: 'hello', userId: 'attacker' }));
    expect(await alice.next()).toMatchObject({ type: 'message', userId: 'alice', text: 'hello', seq: 1 });
    expect(await bob.next()).toMatchObject({ userId: 'alice', text: 'hello' });
    const reconnected = await connect(name);
    expect(await reconnected.next()).toMatchObject({ type: 'snapshot', messages: [{ seq: 1, text: 'hello' }] });
    const other = await connect(name, 'session=other');
    expect(await other.next()).toEqual({ type: 'snapshot', messages: [] });
    alice.socket.send('ping'); expect(await alice.next()).toBe('pong');
  });
  it('recovers session from its attachment in a reconstructed object and keeps SQL state', async () => {
    const name = roomName(), alice = await connect(name); await alice.next();
    const stub = env.ROOMS.getByName(JSON.stringify(['team', name]));
    await runInDurableObject(stub, (_instance, state) => {
      const socket = state.getWebSockets()[0];
      const fresh = new Room(state, env);
      fresh.webSocketMessage(socket, JSON.stringify({ text: 'after reconstruction' }));
      expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM messages').one().n).toBe(1);
    });
    expect(await alice.next()).toMatchObject({ userId: 'alice', text: 'after reconstruction' });
  });
  it('closes expired sessions without adding a message', async () => {
    const name = roomName(), alice = await connect(name); await alice.next();
    const closed = new Promise<number>((resolve) => alice.socket.addEventListener('close', (e) => resolve(e.code), { once: true }));
    await runInDurableObject(env.ROOMS.getByName(JSON.stringify(['team', name])), (instance, state) => {
      const socket = state.getWebSockets()[0];
      socket.serializeAttachment({ ...socket.deserializeAttachment(), expiresAt: 1 });
      instance.webSocketMessage(socket, JSON.stringify({ text: 'rejected' }));
      expect(state.storage.sql.exec('SELECT COUNT(*) AS n FROM messages').one().n).toBe(0);
    });
    expect(await closed).toBe(1008);
  });
  it('reclaims capacity from expired idle sockets before admitting a new connection', async () => {
    const name = roomName();
    for (let index = 0; index < 100; index++) { const client = await connect(name); await client.next(); }
    expect((await SELF.fetch(request(name))).status).toBe(503);
    await runInDurableObject(env.ROOMS.getByName(JSON.stringify(['team', name])), (_instance, state) => {
      for (const socket of state.getWebSockets()) socket.serializeAttachment({ ...socket.deserializeAttachment(), expiresAt: 1 });
    });
    const replacement = await connect(name);
    expect(await replacement.next()).toEqual({ type: 'snapshot', messages: [] });
  });
  it('limits repeated messages and retains only the latest 100 committed rows', async () => {
    const name = roomName(), alice = await connect(name); await alice.next();
    await runInDurableObject(env.ROOMS.getByName(JSON.stringify(['team', name])), (instance, state) => {
      const socket = state.getWebSockets()[0];
      for (let index = 0; index < 110; index++) {
        // Represent separate allowed bursts without a wall-clock wait.
        socket.serializeAttachment({ ...socket.deserializeAttachment(), tokens: 10 });
        instance.webSocketMessage(socket, JSON.stringify({ text: `message ${index}` }));
      }
      const row = state.storage.sql.exec('SELECT COUNT(*) AS n, MIN(seq) AS first, MAX(seq) AS last FROM messages').one();
      expect(row).toMatchObject({ n: 100, first: 11, last: 110 });
      socket.serializeAttachment({ ...socket.deserializeAttachment(), tokens: 0, updatedAt: Date.now() });
      instance.webSocketMessage(socket, JSON.stringify({ text: 'rate limited' }));
      expect(state.storage.sql.exec('SELECT MAX(seq) AS last FROM messages').one().last).toBe(110);
    });
  });
  it.each(['not-json', JSON.stringify({ text: 'x'.repeat(1001) }), JSON.stringify({ text: 'ok', padding: 'x'.repeat(4096) })])('rejects malformed or oversized application data', async (input) => {
    const alice = await connect(roomName()); await alice.next();
    const closed = new Promise<number>((resolve) => alice.socket.addEventListener('close', (event) => resolve(event.code), { once: true }));
    alice.socket.send(input);
    expect(await closed).toBe(input.length > 4096 ? 1009 : 1008);
  });
  it('rejects binary frames', async () => {
    const alice = await connect(roomName()); await alice.next();
    const closed = new Promise<number>((resolve) => alice.socket.addEventListener('close', (e) => resolve(e.code), { once: true }));
    alice.socket.send(new Uint8Array([1, 2]));
    expect(await closed).toBe(1009);
  });
});
