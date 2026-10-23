import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANVALYTICS_NAMESPACE,
  KEY_SECRET,
  TRANSPORT,
  anonId,
  chunks,
  factId,
  parseServerKey,
  sha256Hex,
  signBatch,
  tuning,
  ulid,
  uuid5,
  type AnalyticsEnv,
} from "{{paths.lib|rel}}/cf-analytics/client";
import { analytics, type AnalyticsVariables } from "{{paths.lib|rel}}/cf-analytics/middleware";
import { handleRelay, RELAY_MAX_BYTES } from "{{paths.lib|rel}}/cf-analytics/relay";
import { CLIENT_SNIPPET, RELAY_PATH } from "{{paths.lib|rel}}/cf-analytics/snippet";
import { isDeniedKey, scrub, scrubBody, scrubProps, scrubString } from "{{paths.lib|rel}}/cf-analytics/scrub";
import idVectors from "./vectors/ids.json";
import scrubVectors from "./vectors/scrub.json";
import sigVectors from "./vectors/signature.json";
import { fact, flush, identify, log, track } from "{{paths.lib|rel}}/cf-analytics/track";

// Fake values: nothing here is a real key.
const SECRET = "test_secret_0123456789abcdef";
const KEY_ID = "ck_01J8ZQ4K7M3N5P6R";
const BASE: AnalyticsEnv & Record<string, unknown> = {
  CANVALYTICS_URL: "https://ingest.example.test/v1/ingest",
  CANVALYTICS_PROJECT: "prj_test",
  [KEY_SECRET]: `${KEY_ID}.${SECRET}`,
  // With transport=service-binding the block posts through this binding; here it forwards to the (spied) global fetch,
  // so every test below runs unchanged in both modes.
  ...(TRANSPORT === "service-binding" ? { CANVALYTICS: { fetch: (u: string, i?: RequestInit) => fetch(u, i) } } : {}),
};
const ENV: AnalyticsEnv = BASE;

function makeCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  return { ctx, done: async () => void (await Promise.all(pending)) };
}
type Call = { url: string; headers: Record<string, string>; body: { records: Record<string, any>[] } };
function mockFetch(status = 202) {
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response('{"accepted":1}', { status }));
  const calls = (): Call[] =>
    spy.mock.calls.map(([url, init]) => ({
      url: String(url),
      headers: init!.headers as Record<string, string>,
      body: JSON.parse(String(init!.body)),
    }));
  return { spy, calls };
}

beforeEach(() => {
  tuning.retryBaseMs = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("signing (reference vectors, same as @canvalytics/core)", () => {
  const body = '{"records":[{"id":"01HZZZZZZZZZZZZZZZZZZZZZZZ","kind":"event","name":"signup","ts":1760000000000,"v":1}]}';
  it("sha256 and the v1 signature equal the vector", async () => {
    expect(await sha256Hex(body)).toBe("991fa92f77d37b66bc2fc4347e488b37dc2567cfb75a2b542f55d077d5e67bcf");
    expect(await signBatch({ secret: SECRET, ts: 1760000000, batchId: "01J8ZQ4K7M3N5P6R8S9T0V1W2X", body })).toBe(
      "v1=153dd1374fd5af1b0b7c84600fbb4974a6204ae06ad7f46ea585110b9314c8f7",
    );
  });
  it("uuid5 matches RFC 9562 and the project namespace vectors", async () => {
    expect(await uuid5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
    expect(await uuid5(CANVALYTICS_NAMESPACE, "prj_test")).toBe("649d0342-abbc-5ec4-a16e-a372a088b8a2");
    expect(await factId("prj_test", "signup", "acc_123")).toBe("6b376500-9f05-5cc7-bdb2-3f29b35971bf");
  });
  it("ulid encodes time and is 26 Crockford chars", () => {
    expect(ulid(1760000000000, new Uint8Array(10))).toBe("01K742SG000000000000000000");
    expect(ulid()).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(anonId()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
  it("parses ck_<id>.<secret> only", () => {
    expect(parseServerKey(`${KEY_ID}.${SECRET}`)).toEqual({ id: KEY_ID, secret: SECRET });
    expect(parseServerKey("cp_01J8ZQ4K7M3N5P6R.test_secret_0123456789abcdef")).toBeNull();
    expect(parseServerKey(undefined)).toBeNull();
  });
});

// Vectors copied from Canvalytics core (packages/core/test/vectors); the ingest and core run the same ones.
describe("shared Canvalytics vectors", () => {
  for (const c of sigVectors.cases) {
    it(`signature: ${c.name}`, async () => {
      expect(await sha256Hex(c.body)).toBe(c.body_sha256);
      expect(await signBatch({ secret: c.secret, ts: c.ts, batchId: c.batch_id, body: c.body })).toBe(c.signature);
      expect(parseServerKey(c.key)).toEqual({ id: c.key_id, secret: c.secret });
    });
  }
  it("namespace", () => expect(idVectors.canvalytics_namespace).toBe(CANVALYTICS_NAMESPACE));
  for (const u of idVectors.uuid5) it(`uuid5 ${u.name}`, async () => expect(await uuid5(u.namespace, u.name)).toBe(u.uuid));
  for (const f of idVectors.fact_ids) it(`factId ${f.project}/${f.name}/${f.subject}`, async () => expect(await factId(f.project, f.name, f.subject)).toBe(f.id));
  for (const k of scrubVectors.keys.denied) it(`denies key ${k}`, () => expect(isDeniedKey(k)).toBe(true));
  for (const k of scrubVectors.keys.allowed) it(`allows key ${k}`, () => expect(isDeniedKey(k)).toBe(false));
  for (const x of scrubVectors.strings) it(`string: ${x.name}`, () => expect(scrubString(x.input)).toBe(x.expected));
  for (const x of scrubVectors.bodies) it(`body: ${x.name}`, () => expect(scrubBody(x.input)).toBe(x.expected));
  for (const x of scrubVectors.props) it(`props: ${x.name}`, () => expect(scrubProps(x.input)).toEqual(x.expected));
});

describe("one signed POST per invocation", () => {
  it("batches track/fact/log into a single request with the documented headers and a valid signature", async () => {
    const { calls } = mockFetch();
    const { ctx, done } = makeCtx();
    track(ENV, ctx, "cta_click", { label: "hero" });
    track(ENV, ctx, "model_selected", { model_id: "m1" }, { anon_id: "anon_12345678" });
    void fact(ENV, ctx, "signup", { user_id: "acc_1" });
    log(ENV, ctx, "error", "upstream_failed", "boom at step 3", { status: 502 });
    await done();
    const [c] = calls();
    expect(calls()).toHaveLength(1);
    expect(c!.url).toBe("https://ingest.example.test/v1/ingest");
    expect(c!.body.records.map((r) => r.kind).sort()).toEqual(["event", "event", "fact", "log"]);
    const h = c!.headers;
    expect(h["X-Canvalytics-Key"]).toBe(KEY_ID);
    expect(h["X-Canvalytics-Batch"]).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(h["X-Canvalytics-Lib"]).toMatch(/^cf-analytics\/1\.0 /);
    expect(h["X-Canvalytics-Trust"]).toBeUndefined();
    const ts = Number(h["X-Canvalytics-Timestamp"]);
    expect(Math.abs(ts - Date.now() / 1000)).toBeLessThan(5);
    // The signature is over `${ts}.${batch}.${sha256(raw body)}` with the secret; the secret never travels.
    const raw = JSON.stringify(c!.body);
    expect(h["X-Canvalytics-Signature"]).toBe(await signBatch({ secret: SECRET, ts, batchId: h["X-Canvalytics-Batch"]!, body: raw }));
    expect(JSON.stringify(c)).not.toContain(SECRET);
    for (const r of c!.body.records) expect(r.v).toBe(1);
  });

  it("chunks at 200 records, one batch id per chunk", async () => {
    const { calls } = mockFetch();
    const { ctx, done } = makeCtx();
    for (let i = 0; i < 201; i++) track(ENV, ctx, "tick", { n: i });
    await done();
    const c = calls();
    expect(c.map((x) => x.body.records.length)).toEqual([200, 1]);
    expect(new Set(c.map((x) => x.headers["X-Canvalytics-Batch"])).size).toBe(2);
    expect(chunks(Array.from({ length: 450 }, (_, i) => ({ id: String(i), kind: "event", name: "t", ts: 1, v: 1 }) as never)).map((x) => x.records.length)).toEqual([200, 200, 50]);
  });

  it("also splits by bytes so a request stays under 1 MB", () => {
    const big = Array.from({ length: 150 }, (_, i) => ({ id: String(i), kind: "log", name: "t", ts: 1, body: "x".repeat(8000), v: 1 }) as never);
    const out = chunks(big);
    expect(out.length).toBeGreaterThan(1);
    for (const o of out) expect(o.body.length).toBeLessThan(1_000_000);
  });

  it("flush() sends for crons without waiting for a tick or a ctx", async () => {
    const { calls } = mockFetch();
    const env = { ...ENV };
    track(env, null, "cron_ran", { n: 1 });
    await flush(env);
    expect(calls()).toHaveLength(1);
    await flush(env);
    expect(calls()).toHaveLength(1);
  });

  it("identify travels alone in a batch marked trust: client (the ingest takes $ names only from the client path)", async () => {
    const { calls } = mockFetch();
    const { ctx, done } = makeCtx();
    track(ENV, ctx, "cta_click");
    identify(ENV, ctx, { anon_id: "anon_12345678", user_id: "acc_9" });
    await done();
    const c = calls();
    expect(c).toHaveLength(2);
    const idf = c.find((x) => x.headers["X-Canvalytics-Trust"] === "client")!;
    expect(idf.body.records).toMatchObject([{ kind: "event", name: "$identify", anon_id: "anon_12345678", user_id: "acc_9" }]);
    expect(c.find((x) => !x.headers["X-Canvalytics-Trust"])!.body.records[0]!.name).toBe("cta_click");
  });
});

describe("fact ids are deterministic", () => {
  it("the same project, name and subject give the same id; retries and backfills dedupe", async () => {
    const { calls } = mockFetch();
    const a = makeCtx();
    const id1 = await fact(ENV, a.ctx, "signup", { user_id: "acc_123" });
    await a.done();
    const b = makeCtx();
    const id2 = await fact(ENV, b.ctx, "signup", { user_id: "acc_123", subject: "acc_123" });
    await b.done();
    expect(id1).toBe("6b376500-9f05-5cc7-bdb2-3f29b35971bf");
    expect(id2).toBe(id1);
    expect(calls().map((c) => c.body.records[0]!.id)).toEqual([id1, id1]);
    const other = makeCtx();
    const ids = await Promise.all([
      fact(ENV, other.ctx, "signup", { user_id: "acc_123", subject: "other" }),
      fact(ENV, other.ctx, "activation", { user_id: "acc_123" }),
      fact({ ...ENV, CANVALYTICS_PROJECT: "prj_other" }, other.ctx, "signup", { user_id: "acc_123" }),
    ]);
    await other.done();
    expect(new Set([id1, ...ids]).size).toBe(4);
  });

  it("drops (never throws) a fact with no project, no user or a bad name", async () => {
    const { spy } = mockFetch();
    const { ctx, done } = makeCtx();
    expect(await fact({ ...ENV, CANVALYTICS_PROJECT: undefined }, ctx, "signup", { user_id: "acc_1" })).toBeNull();
    expect(await fact(ENV, ctx, "Sign Up", { user_id: "acc_1" })).toBeNull();
    expect(await fact(ENV, ctx, "$pageview", { user_id: "acc_1" })).toBeNull();
    expect(await fact(ENV, ctx, "signup", { user_id: "" })).toBeNull();
    await done();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("scrub (vendored from @canvalytics/core, same vectors)", () => {
  // Built from parts so this file carries no key-shaped literal.
  const stripe = ["sk", "live", "A1b2C3d4E5f6G7h8I9j0K1l2"].join("_");
  const jwt = [btoa('{"alg":"HS256"}'), btoa('{"sub":"1234567890"}'), "c2lnbmF0dXJlLXNpZw"].map((s) => s.replace(/=+$/, "")).join(".");
  it("drops denylisted keys and keeps usage counts", () => {
    const p = scrub({ props: { prompt: "hi", system_prompt: "x", email: "a@b.co", password: "p", card_number: "1", wallet_address: "w", name: "Ann", prompt_tokens: 12, model: "m1" } }).props!;
    expect(p).toEqual({ prompt_tokens: 12, model: "m1" });
  });
  it("masks an email, IPv4, IPv6, a Stripe key, a JWT and a Luhn-valid card", () => {
    const p = scrub({ props: { a: "mail ann@example.com now", b: "from 203.0.113.7 ok", c: "v6 2001:db8::8a2e:370:7334 ok", d: `key ${stripe}`, e: `tok ${jwt}`, f: "card 4111 1111 1111 1111", g: 4111111111111111, h: "ts 1760000000000" } }).props!;
    expect(p).toEqual({
      a: "mail [email] now",
      b: "from [ip] ok",
      c: "v6 [ip] ok",
      d: "key [secret]",
      e: "tok [secret]",
      f: "card [card]",
      g: "[card]",
      h: "ts 1760000000000",
    });
  });
  it("caps props at 32 keys and strings at 256 chars; bodies at 4 KB, line by line", () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, "v"]));
    expect(Object.keys(scrub({ props: many }).props!)).toHaveLength(32);
    expect((scrub({ props: { s: "x".repeat(300) } }).props!.s as string).length).toBe(256);
    const body = scrub({ body: `line one a@b.co\n${"y".repeat(5000)}` }).body!;
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(4096);
    expect(body.split("\n")[0]).toBe("line one [email]");
  });
  it("track() scrubs before queueing, so secrets never leave the app", async () => {
    const { calls } = mockFetch();
    const { ctx, done } = makeCtx();
    track(ENV, ctx, "checkout", { note: "mail ann@example.com", prompt: "secret text", status: "ok", "Bad-Key": 1 });
    log(ENV, ctx, "info", "debug_line", `user ann@example.com sent ${stripe}`);
    await done();
    const recs = calls()[0]!.body.records;
    expect(recs[0]!.props).toEqual({ note: "mail [email]", status: "ok" });
    expect(recs[1]!.body).toBe("user [email] sent [secret]");
    expect(JSON.stringify(recs)).not.toContain("ann@example.com");
  });
});

function relayApp(withMiddleware = true) {
  const app = new Hono<{ Bindings: AnalyticsEnv; Variables: AnalyticsVariables }>();
  if (withMiddleware) app.use("*", analytics());
  app.post(RELAY_PATH, handleRelay);
  app.get("/hello", (c) => c.text("hi"));
  return app;
}
const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const URL0 = "https://app.example.test";

describe("relay", () => {
  it("accepts an allowlisted $pageview: 204, forwarded once as trust client with the server key", async () => {
    const { calls } = mockFetch();
    const { ctx, done } = makeCtx();
    const res = await relayApp().request(`${URL0}${RELAY_PATH}`, post({ name: "$pageview", props: { path: "/pricing?utm=x&email=a@b.co#top", ref: "https://news.example.org/a/b?q=1" } }), ENV, ctx);
    await done();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const c = calls();
    expect(c).toHaveLength(1);
    expect(c[0]!.headers["X-Canvalytics-Trust"]).toBe("client");
    expect(c[0]!.headers["X-Canvalytics-Key"]).toBe(KEY_ID);
    expect(c[0]!.body.records).toHaveLength(1);
    const r = c[0]!.body.records[0]!;
    expect(r).toMatchObject({ kind: "event", name: "$pageview", v: 1, props: { path: "/pricing", ref_domain: "news.example.org" } });
    expect(r.anon_id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(r.trust).toBeUndefined();
  });

  it("keeps only allowlisted props, strips query strings from href, scrubs values", async () => {
    const { calls } = mockFetch();
    const { ctx, done } = makeCtx();
    await relayApp().request(`${URL0}${RELAY_PATH}`, post([{ name: "cta_click", props: { label: "Start now", href: "/signup?ref=1", email: "a@b.co", user_id: "x", location: "ann@example.com" } }]), ENV, ctx);
    await done();
    expect(calls()[0]!.body.records[0]!.props).toEqual({ label: "Start now", href: "/signup", location: "[email]" });
  });

  it("rejects a server fact name and reserved names the client may not use; sends nothing", async () => {
    const { spy } = mockFetch();
    const { ctx, done } = makeCtx();
    for (const name of ["signup", "conversion", "$identify", "$other", "Bad Name"]) {
      const res = await relayApp().request(`${URL0}${RELAY_PATH}`, post({ name, props: {} }), ENV, ctx);
      expect(res.status, name).toBe(400);
    }
    expect((await relayApp().request(`${URL0}${RELAY_PATH}`, post("not json"), ENV, ctx)).status).toBe(400);
    await done();
    expect(spy).not.toHaveBeenCalled();
  });

  it("answers 413 over the 4 KB cap (declared or actual) and sends nothing", async () => {
    const { spy } = mockFetch();
    const { ctx, done } = makeCtx();
    const big = JSON.stringify({ name: "cta_click", props: { label: "x".repeat(RELAY_MAX_BYTES) } });
    expect((await relayApp().request(`${URL0}${RELAY_PATH}`, post(big), ENV, ctx)).status).toBe(413);
    expect((await relayApp().request(`${URL0}${RELAY_PATH}`, post("{}", { "content-length": "99999" }), ENV, ctx)).status).toBe(413);
    await done();
    expect(spy).not.toHaveBeenCalled();
  });

  it("does nothing under DNT or GPC: 204, no cookie, no request", async () => {
    const { spy } = mockFetch();
    const { ctx, done } = makeCtx();
    for (const h of [{ dnt: "1" }, { "sec-gpc": "1" }] as Record<string, string>[]) {
      for (const withMw of [true, false]) {
        const res = await relayApp(withMw).request(`${URL0}${RELAY_PATH}`, post({ name: "$pageview", props: { path: "/" } }, h), ENV, ctx);
        expect(res.status).toBe(204);
        expect(res.headers.get("set-cookie")).toBeNull();
      }
    }
    const page = await relayApp().request(`${URL0}/hello`, { headers: { dnt: "1" } }, ENV, ctx);
    expect(page.headers.get("set-cookie")).toBeNull();
    await done();
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin Origin with 403", async () => {
    const { spy } = mockFetch();
    const { ctx, done } = makeCtx();
    const res = await relayApp().request(`${URL0}${RELAY_PATH}`, post({ name: "$pageview", props: { path: "/" } }, { origin: "https://evil.example.net" }), ENV, ctx);
    const ok = await relayApp().request(`${URL0}${RELAY_PATH}`, post({ name: "$pageview", props: { path: "/" } }, { origin: URL0 }), ENV, ctx);
    await done();
    expect([res.status, ok.status]).toEqual([403, 204]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("sets the anon cookie once (middleware mounted or not) and reuses it as anon_id", async () => {
    const { calls } = mockFetch();
    for (const withMw of [true, false]) {
      const app = relayApp(withMw);
      const { ctx, done } = makeCtx();
      const first = await app.request(`${URL0}${RELAY_PATH}`, post({ name: "$pageview", props: { path: "/" } }), ENV, ctx);
      const setCookie = first.headers.getSetCookie();
      expect(setCookie, `mw=${withMw}`).toHaveLength(1);
      expect(setCookie[0]).toMatch(/^{{kit.cookieName}}=[A-Za-z0-9_-]{22}; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure$/);
      const value = /=([^;]+)/.exec(setCookie[0]!)![1]!;
      const second = await app.request(`${URL0}${RELAY_PATH}`, post({ name: "$pageview", props: { path: "/a" } }, { cookie: `x=1; {{kit.cookieName}}=${value}` }), ENV, ctx);
      expect(second.headers.getSetCookie()).toHaveLength(0);
      await done();
      const recs = calls().flatMap((c) => c.body.records);
      expect(recs.slice(-2).map((r) => r.anon_id)).toEqual([value, value]);
    }
  });

  it("middleware exposes c.var.analytics and carries user_id onto relayed events", async () => {
    const { calls } = mockFetch();
    const app = new Hono<{ Bindings: AnalyticsEnv; Variables: AnalyticsVariables }>();
    app.use("*", analytics());
    app.use("*", async (c, next) => {
      c.get("analytics").user_id = "acc_77";
      await next();
    });
    app.post(RELAY_PATH, handleRelay);
    app.get("/who", (c) => c.json(c.get("analytics")));
    const { ctx, done } = makeCtx();
    const who = (await (await app.request(`${URL0}/who`, {}, ENV, ctx)).json()) as { anon_id: string; dnt: boolean; user_id: string };
    expect(who).toMatchObject({ dnt: false, user_id: "acc_77" });
    await app.request(`${URL0}${RELAY_PATH}`, post({ name: "cta_click", props: { label: "x" } }), ENV, ctx);
    await done();
    expect(calls()[0]!.body.records[0]).toMatchObject({ user_id: "acc_77", name: "cta_click" });
  });
});

describe("failures never reach the response", () => {
  it("a network error is retried twice, then dropped; the relay and a page still answer normally", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network down"));
    const { ctx, done } = makeCtx();
    const app = relayApp();
    const r = await app.request(`${URL0}${RELAY_PATH}`, post({ name: "$pageview", props: { path: "/" } }), ENV, ctx);
    const p = await app.request(`${URL0}/hello`, {}, ENV, ctx);
    track(ENV, ctx, "page_rendered");
    await done();
    expect(r.status).toBe(204);
    expect([p.status, await p.text()]).toEqual([200, "hi"]);
    expect(spy).toHaveBeenCalledTimes(6); // two batches (browser-path and server), each tried 1 + 2 times
  });

  it("retries 5xx and 429 (same batch id, fresh signature), not 4xx", async () => {
    const statuses = [503, 429, 202];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: statuses.shift() ?? 202 }));
    const { ctx, done } = makeCtx();
    track(ENV, ctx, "retry_me");
    await done();
    expect(spy).toHaveBeenCalledTimes(3);
    const batches = spy.mock.calls.map(([, i]) => (i!.headers as Record<string, string>)["X-Canvalytics-Batch"]);
    expect(new Set(batches).size).toBe(1);

    spy.mockClear();
    spy.mockImplementation(async () => new Response(null, { status: 401 }));
    track(ENV, ctx, "no_retry");
    await done();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("without a key or URL it drops silently and does not call fetch", async () => {
    const { spy } = mockFetch();
    const { ctx, done } = makeCtx();
    track({ CANVALYTICS_URL: ENV.CANVALYTICS_URL }, ctx, "no_key");
    track({ [KEY_SECRET]: BASE[KEY_SECRET] } as AnalyticsEnv, ctx, "no_url");
    track({ ...ENV, [KEY_SECRET]: "cp_01J8ZQ4K7M3N5P6R.publishable_key_not_allowed" } as AnalyticsEnv, ctx, "client_key");
    await done();
    expect(spy).not.toHaveBeenCalled();
  });

  it("invalid input is dropped, never thrown", async () => {
    const { spy } = mockFetch();
    const { ctx, done } = makeCtx();
    expect(() => {
      track(ENV, ctx, "$pageview");
      track(ENV, ctx, "ok_name", { a: 1 }, { user_id: "has space" });
      log(ENV, ctx, "fatal" as never, "x", "y");
      identify(ENV, ctx, { anon_id: "", user_id: "" });
      track({ ...ENV }, undefined, null as never);
    }).not.toThrow();
    await done();
    await flush(ENV, ctx);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("transport", () => {
  it.runIf(TRANSPORT === "service-binding")("posts through the CANVALYTICS binding and never over the public fetch", async () => {
    const { spy } = mockFetch();
    const binding = { fetch: vi.fn(async (_u: string, _i?: RequestInit) => new Response('{"accepted":1}', { status: 202 })) };
    const { ctx, done } = makeCtx();
    track({ ...ENV, CANVALYTICS: binding }, ctx, "via_binding", { a: 1 });
    await done();
    expect(spy).not.toHaveBeenCalled();
    expect(binding.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = binding.fetch.mock.calls[0]!;
    expect(url).toBe(ENV.CANVALYTICS_URL);
    expect((init!.headers as Record<string, string>)["X-Canvalytics-Key"]).toBe(KEY_ID);
    expect(JSON.parse(String(init!.body)).records[0].name).toBe("via_binding");
  });

  it.runIf(TRANSPORT === "service-binding")("drops (with a warning) when the binding is missing", async () => {
    const { spy } = mockFetch();
    const { ctx, done } = makeCtx();
    track({ ...ENV, CANVALYTICS: undefined }, ctx, "no_binding");
    track({ ...ENV, CANVALYTICS: undefined }, ctx, "no_binding");
    await done();
    expect(spy).not.toHaveBeenCalled();
  });

  it.runIf(TRANSPORT === "https")("posts to CANVALYTICS_URL over fetch and ignores a binding", async () => {
    const { calls } = mockFetch();
    const binding = { fetch: vi.fn(async () => new Response(null, { status: 202 })) };
    const { ctx, done } = makeCtx();
    track({ ...ENV, CANVALYTICS: binding }, ctx, "over_https");
    await done();
    expect(binding.fetch).not.toHaveBeenCalled();
    expect(calls()[0]!.url).toBe("https://ingest.example.test/v1/ingest");
  });
});

describe("client snippet", () => {
  it("is under 1 KB, ES2019, has no absolute URL and honours DNT/GPC", () => {
    expect(new TextEncoder().encode(CLIENT_SNIPPET).length).toBeLessThan(1024);
    expect(CLIENT_SNIPPET).not.toMatch(/https?:|\/\/[a-z]/i);
    expect(CLIENT_SNIPPET).not.toMatch(/\?\.|\?\?|\bimport\b|=>|\blet\b|\bconst\b/);
    expect(CLIENT_SNIPPET).toContain(`"${RELAY_PATH}"`);
    for (const s of ["$pageview", "data-track", "__track", "doNotTrack", "globalPrivacyControl"]) expect(CLIENT_SNIPPET).toContain(s);
  });
});
