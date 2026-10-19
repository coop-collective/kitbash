import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { assertMessages, openProbeSocket, probeUpgrade, verifyCheckpoint } from "../lifecycle/acceptance.mjs";

test("snapshot validator rejects duplicated, reversed, untrusted and unbounded records", () => {
  const valid = { seq: 1, userId: "user_alice", text: "hello" };
  assertMessages([]);
  assertMessages([valid, { ...valid, seq: 3 }]);
  for (const messages of [
    {}, [valid, valid], [{ ...valid, seq: 0 }], [{ ...valid, seq: 1.5 }],
    [{ ...valid, seq: 2 }, valid], [{ ...valid, userId: "forged" }],
    [{ ...valid, text: "  " }], [{ ...valid, text: "x".repeat(1001) }],
    Array.from({ length: 51 }, (_, index) => ({ ...valid, seq: index + 1 })),
  ]) assert.throws(() => assertMessages(messages));
});

// A deliberately small test-only RFC6455 peer. It exercises the actual browser
// probe and checkpoint verifier; it is not an implementation used by an arm.
function frame(value) {
  const payload = Buffer.from(JSON.stringify(value));
  const prefix = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
  return Buffer.concat([prefix, payload]);
}

async function fakeContract() {
  const checkpoint = {
    version: 1, cookie: "fixture=session", team: "team-1", name: "Preserved team", room: "general",
    memberRole: "member", sequenceRoom: "sequence", lastSequence: 1,
    file: "team-file", fileBytes: Buffer.from([0, 255, 42]).toString("base64"),
    personalFile: "personal-file", personalBytes: Buffer.from("personal").toString("base64"),
    history: [{ seq: 2, userId: "user_alice", text: "retained" }],
    retry: { payload: { text: "pruned", clientId: "old-id" }, seq: 1 },
  };
  const state = { corrupt: null, upgrades: 0, retries: 0, sequence: [{ seq: 1, userId: "user_alice", text: "sequence-seed" }] };
  const sockets = new Set();
  let base;
  const server = http.createServer((request, response) => {
    const json = (value, status = 200) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
    if (request.url === "/api/login" && request.method === "POST") { response.setHeader("set-cookie", "fixture=member; HttpOnly"); return json({ user: { id: "user_bob" } }); }
    if (![checkpoint.cookie, "fixture=member"].includes(request.headers.cookie)) return json({ error: "unauthorized" }, 401);
    if (request.url === "/api/health") return json({ ok: true });
    if (request.url === "/api/session") return json({ user: { id: "user_alice" } });
    if (request.url === "/api/teams") return json({ teams: [{ id: checkpoint.team, name: checkpoint.name, role: state.corrupt === "role" ? "viewer" : request.headers.cookie === "fixture=member" ? (state.corrupt === "member" ? "viewer" : "member") : "owner" }] });
    if (request.url === "/api/teams/team-1/uploads/team-file") {
      response.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": "attachment; filename=file.bin", "x-content-type-options": "nosniff", "cache-control": "private, no-store" });
      return response.end(state.corrupt === "bytes" ? Buffer.from("wrong") : Buffer.from(checkpoint.fileBytes, "base64"));
    }
    if (request.url === "/api/uploads/personal-file") return response.end(Buffer.from(checkpoint.personalBytes, "base64"));
    return json({ error: "missing" }, 404);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    // Browser context disposal and raw 101 probes intentionally reset sockets.
    socket.on("error", () => {});
  });
  server.on("upgrade", (request, socket) => {
    state.lastIdentityHeader = request.headers["x-user-id"];
    if (request.headers.cookie !== checkpoint.cookie || request.headers.origin !== base) {
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      return;
    }
    state.upgrades++;
    const counter = request.url.includes("/rooms/sequence/");
    const accept = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.write(frame({ type: "snapshot", messages: counter ? state.sequence : state.corrupt === "history" ? [] : state.corrupt === "snapshot-shape" ? {} : state.corrupt === "additive" ? checkpoint.history.map((message) => ({ ...message, clientId: null, createdAt: 123 })) : checkpoint.history }));
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 2) {
        const opcode = pending[0] & 15;
        const masked = !!(pending[1] & 128);
        let length = pending[1] & 127;
        let offset = 2;
        if (length === 126) { if (pending.length < 4) return; length = pending.readUInt16BE(2); offset = 4; }
        if (length === 127) { socket.destroy(); return; }
        const maskLength = masked ? 4 : 0;
        if (pending.length < offset + maskLength + length) return;
        const mask = pending.subarray(offset, offset + maskLength);
        const payload = Buffer.from(pending.subarray(offset + maskLength, offset + maskLength + length));
        pending = pending.subarray(offset + maskLength + length);
        if (masked) for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
        if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
        if (opcode !== 1) continue;
        const input = JSON.parse(payload.toString());
        if (counter) {
          const message = { seq: state.corrupt === "sequence" ? 1 : state.sequence.at(-1).seq + 1, userId: "user_alice", text: input.text };
          state.sequence.push(message);
          socket.write(frame({ type: "message", ...message }));
          continue;
        }
        state.retries++;
        socket.write(frame({ type: "ack", seq: state.corrupt === "ack" ? 999 : 1, clientId: input.clientId }));
        if (state.corrupt === "duplicate") socket.write(frame({ type: "message", seq: 3, userId: "user_alice", text: input.text, clientId: input.clientId }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, checkpoint, state,
    async close() { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); },
  };
}

test("raw upgrade probes have a working 101 control and carry hostile Origin faithfully", async () => {
  const fixture = await fakeContract();
  try {
    assert.equal(await probeUpgrade(fixture.base, "/ws", { cookie: fixture.checkpoint.cookie, origin: fixture.base }), 101);
    for (const origin of [undefined, "null", "https://foreign.invalid"]) {
      assert.equal(await probeUpgrade(fixture.base, "/ws", { cookie: fixture.checkpoint.cookie, ...(origin ? { origin } : {}) }), 403);
    }
    assert.equal(fixture.state.upgrades, 1);
  } finally { await fixture.close(); }
});

test("checkpoint verifier exercises real browser sockets and fails on lost state or duplicate replay", async () => {
  const fixture = await fakeContract();
  const browser = await chromium.launch({ headless: true });
  try {
    assert.deepEqual(await verifyCheckpoint(fixture.base, fixture.checkpoint, { browser }), { passed: true });
    assert.equal(fixture.state.retries, 1);
    assert.equal(fixture.checkpoint.lastSequence, 2);
    const injected = await openProbeSocket(browser, fixture.base, fixture.checkpoint.cookie, "team-1", "general", { headers: { "x-user-id": "forged-owner" } });
    try { assert.equal(fixture.state.lastIdentityHeader, "forged-owner", "Browser probe must actually send configured handshake headers"); } finally { await injected.close(); }
    fixture.state.corrupt = "additive";
    assert.deepEqual(await verifyCheckpoint(fixture.base, fixture.checkpoint, { browser }), { passed: true }, "Maintenance may add metadata to old messages");
    for (const corrupt of ["role", "member", "bytes", "history", "ack", "duplicate", "sequence"]) {
      fixture.state.corrupt = corrupt;
      await assert.rejects(verifyCheckpoint(fixture.base, fixture.checkpoint, { browser }), undefined, `Must fail when ${corrupt} is corrupted`);
    }
    fixture.state.corrupt = "snapshot-shape";
    await assert.rejects(openProbeSocket(browser, fixture.base, fixture.checkpoint.cookie, "team-1", "general"), /Snapshot messages must be an array/);
    await assert.rejects(verifyCheckpoint(fixture.base, undefined, { browser }), /complete phase-one checkpoint/);
  } finally { await browser.close(); await fixture.close(); }
});
