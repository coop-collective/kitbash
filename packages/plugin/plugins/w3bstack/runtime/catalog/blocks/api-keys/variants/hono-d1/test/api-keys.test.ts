import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { KEY_CACHE_TTL_S, KEY_PREFIX, MAX_ACTIVE_KEYS, authenticateKey, cleanName, createKey, hasScope, listKeys, parseKey, renameKey, revokeKey, type ApiKeysEnv } from "{{paths.lib|rel}}/api-keys/keys";
import { requireApiKey } from "{{paths.lib|rel}}/api-keys/middleware";
import { apiKeyRoutes } from "{{paths.lib|rel}}/api-keys/routes";

const PEPPER = "test-pepper-not-a-secret-0123456789";
const TABLE = "{{kit.tablePrefix}}api_keys";
const cache = (env as unknown as { KEY_CACHE: KVNamespace }).KEY_CACHE;
/** With the KEY_CACHE binding, and without it (the degraded mode: every call goes to D1). */
const withCache: ApiKeysEnv = { DB: env.DB, KEY_PEPPER: PEPPER, KEY_CACHE: cache };
const noCache: ApiKeysEnv = { DB: env.DB, KEY_PEPPER: PEPPER };

async function make(e: ApiKeysEnv, owner: string, opts: { name?: string; scopes?: string[] } = {}) {
  const r = await createKey(e, owner, opts);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("key format and storage", () => {
  it("creates {{kit.keyPrefix}}<id8>_<secret43>, stores only an HMAC and never the secret", async () => {
    const k = await make(noCache, "own_format");
    expect(k.key).toMatch(new RegExp(`^${KEY_PREFIX}[a-z2-7]{8}_[0-9A-Za-z]{43}$`));
    expect(parseKey(`Bearer ${k.key}`)).toEqual({ id: k.id, secret: k.key.slice(-43) });
    const row = await env.DB.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).bind(k.id).first<{ key_hash: string }>();
    expect(row!.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(k.key.slice(-43));
    expect(parseKey("nope")).toBeNull();
    expect(parseKey(`${KEY_PREFIX}short_x`)).toBeNull();
  });

  it("refuses to run without a pepper of at least 16 characters", async () => {
    await expect(createKey({ DB: env.DB }, "own_pepper")).rejects.toThrow("KEY_PEPPER");
    await expect(createKey({ DB: env.DB, KEY_PEPPER: "short" }, "own_pepper")).rejects.toThrow("KEY_PEPPER");
  });

  it("cleans names and scopes", async () => {
    expect(cleanName("  my\u0000 key ")).toBe("my key");
    expect(cleanName(42)).toBe("default");
    expect(await createKey(noCache, "own_scope", { scopes: ["Bad Scope"] })).toEqual({ ok: false, error: "invalid scopes" });
  });
});

describe("authenticateKey", () => {
  for (const [label, e] of [["with the KV cache", withCache], ["without a KV binding (no cache)", noCache]] as const) {
    it(`accepts a good key and rejects wrong, malformed and revoked keys ${label}`, async () => {
      const k = await make(e, `own_auth_${label.length}`, { scopes: ["read"] });
      expect(await authenticateKey(e, k.key)).toEqual({ owner_id: `own_auth_${label.length}`, key_id: k.id, scopes: ["read"] });
      expect(await authenticateKey(e, `Bearer ${k.key}`)).not.toBeNull();
      expect(await authenticateKey(e, `${KEY_PREFIX}${k.id}_${"A".repeat(43)}`)).toBeNull();
      expect(await authenticateKey(e, `${KEY_PREFIX}zzzzzzzz_${"A".repeat(43)}`)).toBeNull();
      expect(await authenticateKey(e, "garbage")).toBeNull();
      expect(await authenticateKey(e, null)).toBeNull();
      expect(await revokeKey(e, `own_auth_${label.length}`, k.id)).toBe(true);
      expect(await revokeKey(e, `own_auth_${label.length}`, k.id)).toBe(false);
      expect(await authenticateKey(e, k.key)).toBeNull();
    });
  }

  it("with a KV binding, a verified key is cached and revoking busts the cache at once", async () => {
    const k = await make(withCache, "own_cache");
    expect(await cache.get(`key:${k.id}`)).toBeNull();
    expect(await authenticateKey(withCache, k.key)).not.toBeNull();
    expect(JSON.parse((await cache.get(`key:${k.id}`))!)).toMatchObject({ owner_id: "own_cache", revoked: false });
    expect(KEY_CACHE_TTL_S).toBeGreaterThanOrEqual(60);
    // the cache answers without D1: delete the row behind it
    await env.DB.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).bind(k.id).run();
    expect(await authenticateKey(withCache, k.key)).not.toBeNull();
    // and a revoke deletes the entry, so the next call reads D1 and finds nothing
    await revokeKey(withCache, "own_cache", k.id);
    expect(await cache.get(`key:${k.id}`)).toBeNull();
    expect(await authenticateKey(withCache, k.key)).toBeNull();
  });

  it("without a KV binding there is no cache: D1 is read on every call and nothing is stored in KV", async () => {
    const k = await make(noCache, "own_nocache");
    expect(await authenticateKey(noCache, k.key)).not.toBeNull();
    expect(await cache.get(`key:${k.id}`)).toBeNull();
    await env.DB.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).bind(k.id).run();
    expect(await authenticateKey(noCache, k.key)).toBeNull();
  });

  it("treats a failing KV as a cache miss instead of failing the request", async () => {
    const broken = { get: async () => { throw new Error("kv down"); }, put: async () => { throw new Error("kv down"); }, delete: async () => { throw new Error("kv down"); } } as unknown as KVNamespace;
    const e: ApiKeysEnv = { DB: env.DB, KEY_PEPPER: PEPPER, KEY_CACHE: broken };
    const k = await make(e, "own_kvdown");
    expect(await authenticateKey(e, k.key)).not.toBeNull();
    expect(await revokeKey(e, "own_kvdown", k.id)).toBe(true);
    expect(await authenticateKey(e, k.key)).toBeNull();
  });

  it("records last use at most once a minute", async () => {
    const k = await make(noCache, "own_used");
    await authenticateKey(noCache, k.key, 1_000_000);
    await authenticateKey(noCache, k.key, 1_000_500);
    const row = await env.DB.prepare(`SELECT last_used_ms FROM ${TABLE} WHERE id = ?`).bind(k.id).first<{ last_used_ms: number }>();
    expect(row!.last_used_ms).toBe(1_000_000);
  });

  it("hasScope is strict: none unless granted, or '*'", async () => {
    expect(hasScope({ scopes: [] }, "read")).toBe(false);
    expect(hasScope({ scopes: ["read"] }, "read")).toBe(true);
    expect(hasScope({ scopes: ["read"] }, "write")).toBe(false);
    expect(hasScope({ scopes: ["*"] }, "write")).toBe(true);
  });
});

describe("owner operations", () => {
  it("lists only the owner's keys, never a hash; renames and revokes only the owner's keys", async () => {
    const a = await make(noCache, "own_list_a", { name: "first" });
    const b = await make(noCache, "own_list_b");
    const list = await listKeys(noCache, "own_list_a");
    expect(list.map((x) => x.id)).toEqual([a.id]);
    expect(JSON.stringify(list)).not.toContain("key_hash");
    expect(await renameKey(noCache, "own_list_a", b.id, "stolen")).toBe(false);
    expect(await revokeKey(noCache, "own_list_a", b.id)).toBe(false);
    expect(await authenticateKey(noCache, b.key)).not.toBeNull();
    expect(await renameKey(noCache, "own_list_a", a.id, "renamed")).toBe(true);
    expect((await listKeys(noCache, "own_list_a"))[0]!.name).toBe("renamed");
  });

  it("allows at most MAX_ACTIVE_KEYS active keys per owner; revoking frees a slot", async () => {
    const first = await make(noCache, "own_max");
    for (let i = 1; i < MAX_ACTIVE_KEYS; i++) await make(noCache, "own_max");
    expect(await createKey(noCache, "own_max")).toEqual({ ok: false, error: `at most ${MAX_ACTIVE_KEYS} active keys` });
    await revokeKey(noCache, "own_max", first.id);
    expect((await createKey(noCache, "own_max")).ok).toBe(true);
  }, 60_000);
});

describe("middleware and routes", () => {
  const app = new Hono<{ Bindings: ApiKeysEnv; Variables: { apiKey: { owner_id: string } } }>();
  app.use("/v1/*", requireApiKey);
  app.get("/v1/whoami", (c) => c.json({ owner: c.get("apiKey").owner_id }));
  // the host app's own sign-in: here a test header
  app.route("/account/keys", apiKeyRoutes((c) => c.req.header("x-test-owner") ?? null));
  const call = (path: string, init: RequestInit = {}) => app.request(path, init, { ...noCache });

  it("requireApiKey answers 401 without a valid key and sets the caller otherwise", async () => {
    const k = await make(noCache, "own_mw");
    expect((await call("/v1/whoami")).status).toBe(401);
    expect((await call("/v1/whoami", { headers: { authorization: "Bearer nope" } })).headers.get("WWW-Authenticate")).toContain("Bearer");
    const ok = await call("/v1/whoami", { headers: { authorization: `Bearer ${k.key}` } });
    expect(await ok.json()).toEqual({ owner: "own_mw" });
  });

  it("dashboard routes create (key shown once), list, rename and revoke for the signed-in owner only", async () => {
    const as = (owner: string, method = "GET", body?: unknown, path = "/account/keys") =>
      call(path, { method, headers: { "x-test-owner": owner, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect((await call("/account/keys")).status).toBe(401);
    const created = await as("own_dash", "POST", { name: "ci", scopes: ["read"] });
    expect(created.status).toBe(201);
    const { id, key } = (await created.json()) as { id: string; key: string };
    expect(key.startsWith(KEY_PREFIX)).toBe(true);
    const listed = (await (await as("own_dash")).json()) as { keys: { id: string; name: string }[] };
    expect(listed.keys.map((x) => x.id)).toEqual([id]);
    expect(JSON.stringify(listed)).not.toContain(key.slice(-43));
    expect((await as("own_dash_other", "PATCH", { name: "x" }, `/account/keys/${id}`)).status).toBe(404);
    expect((await as("own_dash", "PATCH", { name: "renamed" }, `/account/keys/${id}`)).status).toBe(200);
    await as("own_dash_other", "DELETE", undefined, `/account/keys/${id}`);
    expect(await authenticateKey(noCache, key)).not.toBeNull();
    await as("own_dash", "DELETE", undefined, `/account/keys/${id}`);
    expect(await authenticateKey(noCache, key)).toBeNull();
    expect((await as("own_dash", "POST", { scopes: "read" })).status).toBe(400);
  });
});
