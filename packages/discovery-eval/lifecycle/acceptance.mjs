import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { accept as acceptLegacy } from "../acceptance.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const unique = (prefix) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const users = { alice: "user_alice", bob: "user_bob" };
const maxUpload = 1024 * 1024;

function client(base) {
  base = new URL(base).origin;
  const request = (pathname, { cookie, origin = base, json, ...options } = {}) =>
    fetch(base + pathname, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(15_000),
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(options.method && options.method !== "GET" && origin !== undefined ? { origin } : {}),
        ...(json !== undefined ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  const status = async (response, expected) => {
    assert.equal(response.status, expected, `Expected HTTP ${expected}, got ${response.status}: ${(await response.clone().text()).slice(0, 500)}`);
    return response;
  };
  const login = async (name) => {
    const response = await status(await request("/api/login", {
      method: "POST", json: { email: `${name}@example.test`, password: "local-demo-password" },
    }), 200);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie, "Login must set a cookie");
    return cookie;
  };
  const team = async (cookie, name = unique("Review")) => {
    const response = await status(await request("/api/teams", { cookie, method: "POST", json: { name } }), 201);
    const result = await response.json();
    assert.equal(result.name, name.trim());
    assert.ok(typeof result.id === "string" && result.id.length > 0);
    return result;
  };
  const member = async (cookie, id, role = "member", userId = users.bob) => {
    await status(await request(`/api/teams/${encodeURIComponent(id)}/members/${userId}`, {
      cookie, method: "PUT", json: { role },
    }), 204);
  };
  const setup = async (role = "member") => {
    const alice = await login("alice");
    const bob = await login("bob");
    const created = await team(alice);
    if (role) await member(alice, created.id, role);
    return { alice, bob, team: created.id, name: created.name, room: unique("room") };
  };
  return { base, request, status, login, team, member, setup };
}

const teamPath = (id) => `/api/teams/${encodeURIComponent(id)}`;
const socketPath = (team, room) => `${teamPath(team)}/rooms/${encodeURIComponent(room)}/ws`;
const filePath = (team, id) => `${teamPath(team)}/uploads${id ? `/${encodeURIComponent(id)}` : ""}`;

/** Raw upgrade probe: browsers cannot set hostile Origin/identity headers themselves. */
export function probeUpgrade(base, pathname, headers = {}, timeoutMs = 5000) {
  const url = new URL(pathname, base);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(url, {
      headers: {
        Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": Buffer.from("lifecycle-probe!").toString("base64"), ...headers,
      },
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Upgrade probe timed out")));
    request.on("upgrade", (response, socket) => { socket.destroy(); resolve(response.statusCode); });
    request.on("response", (response) => { response.resume(); resolve(response.statusCode); });
    request.on("error", reject);
    request.end();
  });
}

/** A real browser socket; each connection has its own cookie jar and ordered event log. */
export async function openProbeSocket(browser, base, cookie, team, room, { headers = {} } = {}) {
  const context = await browser.newContext({ extraHTTPHeaders: headers });
  try {
    if (cookie) {
      const split = cookie.indexOf("=");
      await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: base, httpOnly: true, sameSite: "Lax" }]);
    }
    const page = await context.newPage();
    const browserErrors = [];
    page.on("console", (event) => { if (event.type() === "error") browserErrors.push(event.text()); });
    // A genuine same-origin navigation establishes the browser's IP address
    // space. Synthetic route.fulfill pages fail Chromium's local-network check.
    // JSON health avoids running either arm's UI scripts inside the probe.
    await page.goto(new URL("/api/health", base).href);
    const target = new URL(socketPath(team, room), base);
    target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
    await page.evaluate((url) => {
      const socket = new WebSocket(url);
      const probe = window.__lifecycleSocket = { socket, events: [], closed: false };
      socket.onmessage = (event) => {
        try { probe.events.push(JSON.parse(event.data)); }
        catch { probe.events.push({ type: "invalid-json", data: String(event.data) }); }
      };
      socket.onclose = (event) => { probe.closed = true; probe.closeCode = event.code; };
      socket.onerror = () => { probe.errored = true; };
    }, target.href);
    const events = () => page.evaluate(() => window.__lifecycleSocket.events);
    const wait = async (predicate, { after = 0, timeoutMs = 8000, allowClose = false } = {}) => {
      const deadline = Date.now() + timeoutMs;
      do {
        const state = await page.evaluate(() => ({ events: window.__lifecycleSocket.events, closed: window.__lifecycleSocket.closed, closeCode: window.__lifecycleSocket.closeCode }));
        const found = state.events.slice(after).find(predicate);
        if (found) return found;
        if (state.closed) {
          if (allowClose) return { type: "closed", code: state.closeCode };
          throw new Error(`Socket closed (${state.closeCode}) while awaiting an event; got ${JSON.stringify(state.events.slice(after)).slice(0, 500)}; ${browserErrors.join("; ").slice(0, 500)}`);
        }
        await sleep(20);
      } while (Date.now() < deadline);
      throw new Error(`Timed out awaiting socket event; got ${JSON.stringify((await events()).slice(after)).slice(0, 500)}`);
    };
    const sendRaw = async (data) => page.evaluate((value) => {
      const socket = window.__lifecycleSocket.socket;
      if (socket.readyState !== WebSocket.OPEN) return false;
      socket.send(value);
      return true;
    }, data);
    const socket = {
      context, page, events, wait,
      mark: async () => (await events()).length,
      sendRaw,
      send: (value) => sendRaw(JSON.stringify(value)),
      close: () => context.close(),
    };
    socket.snapshot = await wait((event) => event.type === "snapshot");
    assertMessages(socket.snapshot.messages);
    return socket;
  } catch (error) {
    await context.close();
    throw error;
  }
}

export function assertMessages(messages) {
  assert.ok(Array.isArray(messages), "Snapshot messages must be an array");
  assert.ok(messages.length <= 50, "Snapshot exceeds its 50-message window");
  let previous = 0;
  for (const message of messages) {
    assert.ok(Number.isSafeInteger(message.seq) && message.seq > previous, "Sequences must be positive, unique and strictly increasing");
    assert.ok(Object.values(users).includes(message.userId), "Message identity must be a verified fixture user");
    assert.ok(typeof message.text === "string" && message.text.trim().length > 0 && message.text.length <= 1000);
    previous = message.seq;
  }
}

async function message(socket, text, extra = {}) {
  const after = await socket.mark();
  assert.equal(await socket.send({ text, ...extra }), true, "Socket must be open to send");
  const event = await socket.wait((event) => event.type === "message" && event.text === text, { after });
  assertMessages([event]);
  return event;
}

async function assertNoMessages(socket, after, predicate = () => true) {
  // Positive acknowledgements/HTTP responses establish processing boundaries; this
  // short quiet window detects extra delivery, not arbitrary eventual consistency.
  await sleep(250);
  const unexpected = (await socket.events()).slice(after).filter((event) => event.type === "message" && predicate(event));
  assert.deepEqual(unexpected, [], "Unexpected message delivery");
}

async function rejection(socket, value, { raw = false } = {}) {
  const after = await socket.mark();
  const sent = await (raw ? socket.sendRaw(value) : socket.send(value));
  if (sent) await socket.wait((event) => event.type === "error", { after, allowClose: true });
  await assertNoMessages(socket, after);
  assert.equal((await socket.events()).slice(after).filter((event) => event.type === "ack").length, 0, "Rejected send must not bypass authorization through a retry acknowledgement");
}

async function assertDownload(response, bytes) {
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(bytes));
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment/i);
  assert.equal(response.headers.get("content-type")?.split(";")[0], "application/octet-stream");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("cache-control") ?? "", /private/i);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
}

async function upload(api, cookie, team, bytes) {
  const response = await api.status(await api.request(filePath(team), {
    cookie, method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes,
  }), 201);
  const id = (await response.json()).id;
  assert.ok(typeof id === "string" && id.length > 0);
  return id;
}

async function withSockets(browser, api, fixture, fn) {
  const alice = await openProbeSocket(browser, api.base, fixture.alice, fixture.team, fixture.room);
  let bob;
  try {
    bob = await openProbeSocket(browser, api.base, fixture.bob, fixture.team, fixture.room);
    return await fn(alice, bob);
  } finally {
    await alice.close();
    await bob?.close();
  }
}

function assertPreservedHistory(previousMessages, currentMessages) {
  assert.equal(currentMessages.length, previousMessages.length, "Prior room history length changed across restart/maintenance");
  for (let index = 0; index < previousMessages.length; index++) {
    const previous = previousMessages[index];
    const current = currentMessages[index];
    for (const field of ["seq", "userId", "text"]) assert.equal(current[field], previous[field], `Prior history ${field} changed`);
    // New columns may add null/default metadata to legacy messages.
    if (previous.clientId != null) assert.equal(current.clientId, previous.clientId);
  }
}

/**
 * Checkpoint contains an ephemeral test cookie: redact it before publishing.
 * Verification advances lastSequence in a separate counter-probe room in place;
 * retain that updated object before the next restart/phase. Main history is read-only.
 */
export async function verifyCheckpoint(base, checkpoint, { browser: suppliedBrowser } = {}) {
  assert.equal(checkpoint?.version, 1, "A complete phase-one checkpoint is required");
  const api = client(base);
  const cookie = checkpoint.cookie;
  await api.status(await api.request("/api/session", { cookie }), 200);
  const teams = await (await api.status(await api.request("/api/teams", { cookie }), 200)).json();
  assert.ok(teams.teams.some((team) => team.id === checkpoint.team && team.role === "owner" && team.name === checkpoint.name), "Checkpoint team/membership was lost");
  if (checkpoint.memberRole) {
    const memberCookie = await api.login("bob");
    const memberTeams = await (await api.status(await api.request("/api/teams", { cookie: memberCookie }), 200)).json();
    assert.ok(memberTeams.teams.some((team) => team.id === checkpoint.team && team.role === checkpoint.memberRole), "Checkpoint member role was lost");
  }
  await assertDownload(await api.request(filePath(checkpoint.team, checkpoint.file), { cookie }), Buffer.from(checkpoint.fileBytes, "base64"));
  const personal = await api.request(`/api/uploads/${encodeURIComponent(checkpoint.personalFile)}`, { cookie });
  assert.equal(personal.status, 200);
  assert.equal(Buffer.from(await personal.arrayBuffer()).toString("base64"), checkpoint.personalBytes);
  const browser = suppliedBrowser ?? await chromium.launch({ headless: true });
  let socket;
  try {
    socket = await openProbeSocket(browser, api.base, cookie, checkpoint.team, checkpoint.room);
    assertPreservedHistory(checkpoint.history, socket.snapshot.messages);
    if (checkpoint.retry) {
      const after = await socket.mark();
      assert.equal(await socket.send(checkpoint.retry.payload), true);
      const ack = await socket.wait((event) => event.type === "ack" && event.clientId === checkpoint.retry.payload.clientId, { after });
      assert.equal(ack.seq, checkpoint.retry.seq, "Pruned message retry must retain its original sequence across restart");
      await assertNoMessages(socket, after);
      await socket.close();
      socket = await openProbeSocket(browser, api.base, cookie, checkpoint.team, checkpoint.room);
      assertPreservedHistory(checkpoint.history, socket.snapshot.messages);
    }
    if (checkpoint.sequenceRoom) {
      await socket.close();
      socket = await openProbeSocket(browser, api.base, cookie, checkpoint.team, checkpoint.sequenceRoom);
      const previous = Math.max(checkpoint.lastSequence, socket.snapshot.messages.at(-1)?.seq ?? 0);
      const appended = await message(socket, unique("restart_sequence"));
      assert.ok(appended.seq > previous, "Fresh message sequence must continue after a process restart");
      checkpoint.lastSequence = appended.seq;
    }
  } finally {
    await socket?.close();
    if (!suppliedBrowser) await browser.close();
  }
  return { passed: true };
}

async function createCheckpoint(api, browser, maintenance) {
  const fixture = await api.setup();
  const cookie = fixture.alice;
  const bytes = Buffer.from(`Persistent team attachment ${fixture.team}\n\0\xff`, "utf8");
  const file = await upload(api, cookie, fixture.team, bytes);
  const personalBytes = Buffer.from(`Persistent personal attachment ${fixture.team}`);
  const personalResponse = await api.status(await api.request("/api/uploads", { cookie, method: "POST", body: personalBytes }), 201);
  const personalFile = (await personalResponse.json()).id;
  assert.ok(personalFile);
  const sequenceRoom = unique("sequence");
  const counterSocket = await openProbeSocket(browser, api.base, cookie, fixture.team, sequenceRoom);
  let lastSequence;
  try { lastSequence = (await message(counterSocket, "sequence-seed")).seq; } finally { await counterSocket.close(); }
  let socket = await openProbeSocket(browser, api.base, cookie, fixture.team, fixture.room);
  let retry;
  try {
    const text = unique("persistent_legacy");
    await message(socket, text);
    if (maintenance) {
      const payload = { text: unique("persistent_retry"), clientId: unique("persist") };
      const result = await message(socket, payload.text, { clientId: payload.clientId });
      assert.equal(result.clientId, payload.clientId);
      retry = { payload, seq: result.seq };
      // Force the retry's message outside the latest-50 window, then verify the
      // independent dedup record survives both pruning and the process restart.
      for (let index = 0; index < 51; index++) {
        await message(socket, `checkpoint-${index}`);
        await sleep(100);
      }
    }
  } finally { await socket.close(); }
  socket = await openProbeSocket(browser, api.base, cookie, fixture.team, fixture.room);
  try {
    const checkpoint = {
      version: 1, cookie, team: fixture.team, name: fixture.name, room: fixture.room,
      memberRole: "member", sequenceRoom, lastSequence,
      file, fileBytes: bytes.toString("base64"), personalFile,
      personalBytes: personalBytes.toString("base64"),
      history: socket.snapshot.messages, ...(retry ? { retry } : {}),
    };
    assert.equal(checkpoint.history.length, maintenance ? 50 : 1);
    if (retry) assert.ok(checkpoint.history.every((entry) => entry.seq !== retry.seq));
    return checkpoint;
  } finally { await socket.close(); }
}

export async function acceptLifecycle(base, artifactDirectory, { phase = "initial", checkpoint } = {}) {
  assert.ok(["initial", "maint", "integration", "maintenance"].includes(phase), "Unknown lifecycle phase");
  const maintenance = phase === "maint" || phase === "maintenance";
  await mkdir(artifactDirectory, { recursive: true });
  const api = client(base);
  const results = [];
  const check = async (name, fn) => {
    const start = performance.now();
    try {
      const details = await fn();
      results.push({ name, passed: true, durationMs: Math.round(performance.now() - start), ...(details ? { details } : {}) });
    } catch (error) {
      results.push({ name, passed: false, durationMs: Math.round(performance.now() - start), error: String(error.message).slice(0, 1200), ...(error.details ? { details: error.details } : {}) });
    }
  };
  let browser;
  const getBrowser = async () => browser ??= await chromium.launch({ headless: true });
  let nextCheckpoint;
  try {
    // Verify before legacy checks intentionally edit the persistent profile.
    if (maintenance || checkpoint) await check("prior-phase checkpoint survives maintenance/restart", async () => verifyCheckpoint(base, checkpoint, { browser: await getBrowser() }));
    await check("existing application regression suite", async () => {
      const details = await acceptLegacy(base, artifactDirectory);
      if (details.passed !== details.total) {
        const error = new Error(`${details.passed}/${details.total} legacy groups passed`);
        error.details = details;
        throw error;
      }
      return details;
    });
    await check("team creation, current membership, owner-only management and immutable owner", async () => {
      const f = await api.setup(null);
      for (const name of ["", " ", "x".repeat(81)]) await api.status(await api.request("/api/teams", { cookie: f.alice, method: "POST", json: { name } }), 400);
      await api.team(f.alice, "  Trimmed team  ");
      const listing = async (cookie) => (await (await api.status(await api.request("/api/teams", { cookie }), 200)).json()).teams;
      assert.ok((await listing(f.alice)).some((team) => team.id === f.team && team.role === "owner"));
      assert.ok(!(await listing(f.bob)).some((team) => team.id === f.team));
      await api.member(f.alice, f.team);
      assert.ok((await listing(f.bob)).some((team) => team.id === f.team && team.role === "member"));
      await api.status(await api.request(`${teamPath(f.team)}/members/user_unknown`, { cookie: f.alice, method: "PUT", json: { role: "member" } }), 400);
      for (const method of ["PUT", "DELETE"]) {
        await api.status(await api.request(`${teamPath(f.team)}/members/${users.alice}`, { cookie: f.alice, method, ...(method === "PUT" ? { json: { role: "member" } } : {}) }), 409);
        await api.status(await api.request(`${teamPath(f.team)}/members/${users.alice}`, { cookie: f.bob, method, ...(method === "PUT" ? { json: { role: "member" } } : {}) }), 403);
      }
      await api.status(await api.request(`${teamPath(f.team)}/members/${users.bob}`, { cookie: f.alice, method: "DELETE" }), 204);
      assert.ok(!(await listing(f.bob)).some((team) => team.id === f.team));
      assert.ok([403, 404].includes((await api.request(filePath(f.team), { cookie: f.bob, method: "POST", body: "no" })).status));
    });
    await check("team HTTP authentication and mutation Origin checks", async () => {
      const f = await api.setup();
      await api.status(await api.request("/api/teams"), 401);
      const mutations = [
        ["/api/teams", "POST", { name: "blocked" }],
        [`${teamPath(f.team)}/members/${users.bob}`, "PUT", { role: "member" }],
        [`${teamPath(f.team)}/members/${users.bob}`, "DELETE"],
        [filePath(f.team), "POST"], [filePath(f.team, "missing"), "DELETE"],
      ];
      for (const [pathname, method, json] of mutations) {
        await api.status(await api.request(pathname, { method, json }), 401);
        for (const origin of [null, "null", "https://foreign.invalid"]) {
          const headers = { cookie: f.alice, ...(json ? { "content-type": "application/json" } : {}), ...(origin === null ? {} : { origin }) };
          await api.status(await fetch(api.base + pathname, { method, headers, ...(json ? { body: JSON.stringify(json) } : {}), signal: AbortSignal.timeout(10000) }), 403);
        }
      }
    });
    await check("team attachments share with members and isolate foreign team IDs and personal files", async () => {
      const f = await api.setup();
      const other = await api.team(f.alice);
      const bytes = Buffer.from([0, 255, 13, 10, 42, 100]);
      const id = await upload(api, f.alice, f.team, bytes);
      await assertDownload(await api.request(filePath(f.team, id), { cookie: f.bob }), bytes);
      assert.equal((await api.request(filePath(other.id, id), { cookie: f.alice })).status, 404);
      assert.ok([204, 404].includes((await api.request(filePath(other.id, id), { cookie: f.alice, method: "DELETE" })).status));
      await assertDownload(await api.request(filePath(f.team, id), { cookie: f.bob }), bytes);
      const personal = await api.status(await api.request("/api/uploads", { cookie: f.alice, method: "POST", body: bytes }), 201);
      const personalId = (await personal.json()).id;
      assert.equal((await api.request(filePath(f.team, personalId), { cookie: f.bob })).status, 404);
      assert.equal((await api.request(`/api/uploads/${personalId}`, { cookie: f.bob })).status, 404);
      await api.status(await api.request(filePath(f.team, id), { cookie: f.bob, method: "DELETE" }), 204);
      assert.equal((await api.request(filePath(f.team, id), { cookie: f.alice })).status, 404);
    });
    await check("team upload limit includes actual chunked bytes", async () => {
      const f = await api.setup();
      await upload(api, f.alice, f.team, new Uint8Array(maxUpload));
      await api.status(await api.request(filePath(f.team), { cookie: f.alice, method: "POST", body: new Uint8Array(maxUpload + 1) }), 413);
      const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(maxUpload)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
      await api.status(await api.request(filePath(f.team), { cookie: f.alice, method: "POST", body: stream, duplex: "half" }), 413);
    });
    await check("WebSocket upgrade rejects hostile origins, queries, invalid rooms and forged identity", async () => {
      const f = await api.setup(null);
      const pathname = socketPath(f.team, f.room);
      // A positive control prevents a broken raw probe from making all negatives pass.
      assert.equal(await probeUpgrade(base, pathname, { cookie: f.alice, origin: api.base }), 101);
      const denied = [
        [pathname, { cookie: f.alice }],
        [pathname, { cookie: f.alice, origin: "null" }],
        [pathname, { cookie: f.alice, origin: "https://foreign.invalid" }],
        [pathname, { origin: api.base, "x-user-id": users.alice, "x-session-id": "forged", "x-authenticated-user": users.alice }],
        [pathname, { cookie: f.bob, origin: api.base, "x-user-id": users.alice }],
        [pathname + "?userId=user_alice", { cookie: f.alice, origin: api.base }],
        [socketPath(f.team, "x".repeat(41)), { cookie: f.alice, origin: api.base }],
        [socketPath(f.team, "bad.room"), { cookie: f.alice, origin: api.base }],
      ];
      for (const [route, headers] of denied) {
        const status = await probeUpgrade(base, route, headers);
        assert.ok(status >= 400 && status < 500, `Rejected upgrade must be 4xx, got ${status} for ${route}`);
      }
      await api.member(f.alice, f.team);
      const forged = { "x-user-id": users.alice, "x-authenticated-user": users.alice };
      const memberStatus = await probeUpgrade(base, pathname, { cookie: f.bob, origin: api.base, ...forged });
      if (memberStatus === 101) {
        // Safe stripping is valid. If accepted, the real handshake headers must
        // not change the verified session identity used by committed messages.
        const member = await openProbeSocket(await getBrowser(), base, f.bob, f.team, f.room, { headers: forged });
        try { assert.equal((await message(member, unique("header_identity"))).userId, users.bob); } finally { await member.close(); }
      } else assert.ok(memberStatus >= 400 && memberStatus < 500);
      await api.status(await api.request("/api/logout", { cookie: f.alice, method: "POST" }), 204);
      assert.equal(await probeUpgrade(base, pathname, { cookie: f.alice, origin: api.base }), 401);
    });
    await check("room messages have trusted identity, concurrent unique sequence and team/room isolation", async () => {
      const f = await api.setup();
      const engine = await getBrowser();
      await withSockets(engine, api, f, async (a, b) => {
        const texts = [unique("alice"), unique("bob")];
        await Promise.all([a.send({ text: texts[0] }), b.send({ text: texts[1] })]);
        const sentA = await a.wait((event) => event.type === "message" && event.text === texts[0]);
        const sentB = await a.wait((event) => event.type === "message" && event.text === texts[1]);
        assert.equal(sentA.userId, users.alice);
        assert.equal(sentB.userId, users.bob);
        assert.notEqual(sentA.seq, sentB.seq);
        await b.wait((event) => event.type === "message" && event.text === texts[0]);
        await b.wait((event) => event.type === "message" && event.text === texts[1]);
        await sleep(100);
        for (const socket of [a, b]) for (const text of texts) assert.equal((await socket.events()).filter((event) => event.type === "message" && event.text === text).length, 1);
      });
      const same = await openProbeSocket(engine, base, f.alice, f.team, f.room);
      try { assert.equal(same.snapshot.messages.length, 2); } finally { await same.close(); }
      const hostileRoom = unique("identity");
      const hostile = await openProbeSocket(engine, base, f.alice, f.team, hostileRoom);
      try {
        const text = unique("forged_identity");
        await hostile.send({ text, userId: users.bob });
        const event = await hostile.wait((event) => event.type === "message" || event.type === "error", { allowClose: true });
        if (event.type === "message") assert.equal(event.userId, users.alice);
      } finally { await hostile.close(); }
      const inspected = await openProbeSocket(engine, base, f.alice, f.team, hostileRoom);
      try { assert.ok(inspected.snapshot.messages.every((message) => message.userId === users.alice)); } finally { await inspected.close(); }
      const otherTeam = await api.team(f.alice);
      for (const [team, room] of [[f.team, unique("other")], [otherTeam.id, f.room]]) {
        const isolated = await openProbeSocket(engine, base, f.alice, team, room);
        try { assert.deepEqual(isolated.snapshot.messages, []); } finally { await isolated.close(); }
      }
    });
    await check("invalid socket payloads never enter persistent history", async () => {
      const f = await api.setup();
      const engine = await getBrowser();
      const invalid = ["not-json", JSON.stringify({ text: " " }), JSON.stringify({ text: "x".repeat(1001) }), JSON.stringify({ text: "okay", padding: "é".repeat(2100) }), JSON.stringify({ text: 42 })];
      if (maintenance) invalid.push(...["", "bad.id", "x".repeat(81), 42, null].map((clientId) => JSON.stringify({ text: "invalid id", clientId })));
      for (const raw of invalid) {
        const socket = await openProbeSocket(engine, base, f.alice, f.team, f.room);
        try { await rejection(socket, raw, { raw: true }); } finally { await socket.close(); }
      }
      const binary = await openProbeSocket(engine, base, f.alice, f.team, f.room);
      try {
        const after = await binary.mark();
        await binary.page.evaluate(() => window.__lifecycleSocket.socket.send(new Uint8Array([123, 125])));
        await binary.wait((event) => event.type === "error", { after, allowClose: true });
      } finally { await binary.close(); }
      const final = await openProbeSocket(engine, base, f.alice, f.team, f.room);
      try { assert.deepEqual(final.snapshot.messages, []); } finally { await final.close(); }
    });
    await check("latest 50 history is ordered and sequence continues after pruning/reconnect", async () => {
      const f = await api.setup();
      const engine = await getBrowser();
      let socket = await openProbeSocket(engine, base, f.alice, f.team, f.room);
      const sent = [];
      try {
        for (let index = 0; index < 60; index++) { sent.push(await message(socket, `window-${index}`)); await sleep(100); }
      } finally { await socket.close(); }
      socket = await openProbeSocket(engine, base, f.alice, f.team, f.room);
      try {
        assert.deepEqual(socket.snapshot.messages.map(({ seq, userId, text }) => ({ seq, userId, text })), sent.slice(-50).map(({ seq, userId, text }) => ({ seq, userId, text })));
        const next = await message(socket, "after-pruning");
        assert.ok(next.seq > sent.at(-1).seq);
      } finally { await socket.close(); }
    });

    if (maintenance) {
      await check("viewer role reads history/files and cannot mutate HTTP or socket data", async () => {
        const f = await api.setup("viewer");
        const engine = await getBrowser();
        const bytes = Buffer.from("viewer-readable");
        const id = await upload(api, f.alice, f.team, bytes);
        const listing = await (await api.status(await api.request("/api/teams", { cookie: f.bob }), 200)).json();
        assert.equal(listing.teams.find((team) => team.id === f.team)?.role, "viewer");
        await assertDownload(await api.request(filePath(f.team, id), { cookie: f.bob }), bytes);
        for (const [pathname, method, json] of [[filePath(f.team), "POST"], [filePath(f.team, id), "DELETE"], [`${teamPath(f.team)}/members/${users.alice}`, "PUT", { role: "member" }]]) await api.status(await api.request(pathname, { cookie: f.bob, method, json }), 403);
        await withSockets(engine, api, f, async (a, b) => {
          const text = unique("viewer_receives");
          await message(a, text);
          await b.wait((event) => event.type === "message" && event.text === text);
          const start = await a.mark();
          await rejection(b, { text: "viewer must not write" });
          await assertNoMessages(a, start);
        });
      });
      await check("live downgrade and removal immediately constrain both sends and fanout", async () => {
        const f = await api.setup();
        await withSockets(await getBrowser(), api, f, async (a, b) => {
          const oldPayload = { text: unique("before_downgrade"), clientId: unique("before") };
          await message(b, oldPayload.text, { clientId: oldPayload.clientId });
          await a.wait((event) => event.type === "message" && event.clientId === oldPayload.clientId);
          await api.member(f.alice, f.team, "viewer");
          const before = await a.mark();
          await rejection(b, oldPayload);
          await rejection(b, { text: unique("downgraded_fresh_denied") });
          await assertNoMessages(a, before);
          // A downgraded socket may close; a fresh viewer must still read.
          const viewer = await openProbeSocket(await getBrowser(), base, f.bob, f.team, f.room);
          try {
            const text = unique("viewer_fanout");
            await message(a, text);
            await viewer.wait((event) => event.type === "message" && event.text === text);
            await api.status(await api.request(`${teamPath(f.team)}/members/${users.bob}`, { cookie: f.alice, method: "DELETE" }), 204);
            const after = await viewer.mark();
            const ownerAfter = await a.mark();
            await viewer.send(oldPayload);
            await viewer.send({ text: unique("removed_fresh_denied") });
            await message(a, unique("removed_must_not_receive"));
            await assertNoMessages(viewer, after);
            assert.equal((await viewer.events()).slice(after).filter((event) => event.type === "ack").length, 0);
            assert.equal((await a.events()).slice(ownerAfter).filter((event) => event.type === "message").length, 1);
            const status = await probeUpgrade(base, socketPath(f.team, f.room), { cookie: f.bob, origin: api.base });
            assert.ok([403, 404].includes(status));
            await api.member(f.alice, f.team);
            const rejoined = await openProbeSocket(await getBrowser(), base, f.bob, f.team, f.room);
            try { await message(rejoined, unique("rejoined")); } finally { await rejoined.close(); }
          } finally { await viewer.close(); }
        });
      });
      await check("logout immediately stops live sends/fanout and re-adding cannot revive the session", async () => {
        const f = await api.setup();
        await withSockets(await getBrowser(), api, f, async (a, b) => {
          const oldPayload = { text: unique("before_logout"), clientId: unique("before") };
          await message(b, oldPayload.text, { clientId: oldPayload.clientId });
          await a.wait((event) => event.type === "message" && event.clientId === oldPayload.clientId);
          await api.status(await api.request("/api/logout", { cookie: f.bob, method: "POST" }), 204);
          const after = await b.mark();
          const ownerAfter = await a.mark();
          await b.send(oldPayload);
          await b.send({ text: unique("logged_out_fresh_denied") });
          await message(a, unique("logged_out_must_not_receive"));
          await assertNoMessages(b, after);
          assert.equal((await b.events()).slice(after).filter((event) => event.type === "ack").length, 0);
          assert.equal((await a.events()).slice(ownerAfter).filter((event) => event.type === "message").length, 1);
          await api.member(f.alice, f.team);
          assert.equal(await probeUpgrade(base, socketPath(f.team, f.room), { cookie: f.bob, origin: api.base }), 401);
          const fresh = await openProbeSocket(await getBrowser(), base, await api.login("bob"), f.team, f.room);
          try { await message(fresh, unique("fresh_login")); } finally { await fresh.close(); }
        });
      });
      await check("simultaneous client retries deduplicate, conflicts reject and namespaces stay independent", async () => {
        const f = await api.setup();
        const engine = await getBrowser();
        const a = await openProbeSocket(engine, base, f.alice, f.team, f.room);
        const retry = await openProbeSocket(engine, base, f.alice, f.team, f.room);
        const observer = await openProbeSocket(engine, base, f.bob, f.team, f.room);
        const payload = { text: unique("idempotent"), clientId: unique("client") };
        try {
          await Promise.all([a.send(payload), retry.send(payload)]);
          const original = await observer.wait((event) => event.type === "message" && event.clientId === payload.clientId);
          const ack = await Promise.race([a.wait((event) => event.type === "ack" && event.clientId === payload.clientId), retry.wait((event) => event.type === "ack" && event.clientId === payload.clientId)]);
          assert.equal(ack.seq, original.seq);
          await sleep(250);
          assert.equal((await observer.events()).filter((event) => event.type === "message" && event.clientId === payload.clientId).length, 1);
          assert.equal((await observer.events()).filter((event) => event.type === "ack").length, 0, "Retry acknowledgements are sender-only");
          assert.equal([...await a.events(), ...await retry.events()].filter((event) => event.type === "ack" && event.clientId === payload.clientId).length, 1);
          const start = await a.mark();
          await a.send({ ...payload, text: "different payload" });
          const conflict = await a.wait((event) => event.type === "error", { after: start });
          assert.equal(conflict.code, "conflict");
          assert.equal(conflict.clientId, payload.clientId);
          await assertNoMessages(a, start);
          const bobMessage = await message(observer, unique("bob_same_id"), { clientId: payload.clientId });
          assert.ok(bobMessage.seq > original.seq);
          assert.equal(bobMessage.clientId, payload.clientId);
          for (const [team, room] of [[f.team, unique("independent")], [(await api.team(f.alice)).id, f.room]]) {
            const independent = await openProbeSocket(engine, base, f.alice, team, room);
            try { assert.equal((await message(independent, payload.text, { clientId: payload.clientId })).clientId, payload.clientId); } finally { await independent.close(); }
          }
          const history = await openProbeSocket(engine, base, f.alice, f.team, f.room);
          try {
            assert.equal(history.snapshot.messages.length, 2);
            assert.equal(history.snapshot.messages.filter((entry) => entry.userId === users.alice && entry.clientId === payload.clientId).length, 1);
          } finally { await history.close(); }
        } finally { await Promise.all([a.close(), retry.close(), observer.close()]); }
      });
    }

    await check("browser team create/connect/message/reconnect/upload/download journey", async () => {
      const context = await (await getBrowser()).newContext();
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        await page.goto(base);
        await page.getByTestId("login-email").fill("alice@example.test");
        await page.getByTestId("login-password").fill("local-demo-password");
        await page.getByTestId("login-submit").click();
        await page.getByTestId("profile-display-name").waitFor();
        await page.goto(new URL("/teams.html", base).href);
        await page.getByTestId("team-name").fill(unique("Browser"));
        await page.getByTestId("team-create").click();
        await page.waitForFunction(() => !!document.querySelector('[data-testid="team-select"]')?.value);
        assert.equal(await page.getByTestId("room-name").inputValue(), "general");
        await page.getByTestId("room-connect").click();
        await page.getByTestId("room-status").filter({ hasText: /\bconnected\b/i }).waitFor();
        const text = `<img src=x onerror="window.__roomXss=1">${unique("safe")}`;
        await page.getByTestId("message-text").fill(text);
        await page.getByTestId("message-send").click();
        await page.getByTestId("room-messages").filter({ hasText: text }).waitFor();
        assert.equal(await page.evaluate(() => window.__roomXss), undefined);
        assert.equal(await page.getByTestId("room-messages").locator("img").count(), 0);
        await page.getByTestId("room-connect").click();
        await page.getByTestId("room-status").filter({ hasText: /\bconnected\b/i }).waitFor();
        const second = unique("after_reconnect");
        await page.getByTestId("message-text").fill(second);
        await page.getByTestId("message-send").click();
        await page.getByTestId("room-messages").filter({ hasText: second }).waitFor();
        await sleep(250);
        assert.equal((await page.getByTestId("room-messages").innerText()).split(text).length - 1, 1, "Reconnect must replace history instead of appending it");
        assert.equal((await page.getByTestId("room-messages").innerText()).split(second).length - 1, 1, "Reconnect must not create duplicate live delivery");
        await page.getByTestId("team-upload").setInputFiles({ name: "review.bin", mimeType: "application/octet-stream", buffer: Buffer.from("team browser attachment") });
        const link = page.getByTestId("file-list").locator("a").first();
        await link.waitFor();
        const downloadPromise = page.waitForEvent("download");
        await link.click();
        const download = await downloadPromise;
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        assert.equal(Buffer.concat(chunks).toString(), "team browser attachment");
        await page.screenshot({ path: `${artifactDirectory}/review-rooms-${phase}.png`, fullPage: true });
        if (maintenance) {
          const team = await page.getByTestId("team-select").inputValue();
          const alice = await api.login("alice");
          await api.member(alice, team, "viewer");
          const bob = await api.login("bob");
          const split = bob.indexOf("=");
          await context.clearCookies();
          await context.addCookies([{ name: bob.slice(0, split), value: bob.slice(split + 1), url: base }]);
          await page.reload();
          await page.getByTestId("team-select").selectOption(team);
          await page.waitForFunction(() => document.querySelector('[data-testid="message-send"]')?.disabled && document.querySelector('[data-testid="team-upload"]')?.disabled);
          await page.getByTestId("room-connect").click();
          await page.getByTestId("room-status").filter({ hasText: /\bconnected\b/i }).waitFor();
          assert.equal(await page.getByTestId("message-send").isDisabled(), true);
          assert.equal(await page.getByTestId("team-upload").isDisabled(), true);
        }
      } finally { await context.close(); }
    });
    await check("persistent checkpoint seeded and readable before restart", async () => {
      nextCheckpoint = await createCheckpoint(api, await getBrowser(), maintenance);
      await verifyCheckpoint(base, nextCheckpoint, { browser: await getBrowser() });
    });
  } finally { await browser?.close(); }
  return { passed: results.filter((result) => result.passed).length, total: results.length, results, checkpoint: nextCheckpoint };
}
