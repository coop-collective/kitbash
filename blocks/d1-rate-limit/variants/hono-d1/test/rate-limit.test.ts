import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeRateLimit, getClientIp, isRateLimited, purgeExpired, rateLimit, windowMs, type RateLimitEnv } from "{{paths.lib|rel}}/rate-limit";

const LOGIN = { name: "login", limit: 3, window: "15 m", key: "203.0.113.7" };
const TABLE = "{{kit.tablePrefix}}rate_limits";

afterEach(() => vi.restoreAllMocks());

describe("consumeRateLimit", () => {
  it("is atomic: concurrent callers share one counter and reopen after the window", async () => {
    const now = 100_000;
    const results = await Promise.all(Array.from({ length: 8 }, () => consumeRateLimit(env.DB, LOGIN, now)));
    expect(results.filter((limited) => !limited)).toHaveLength(3);
    expect(await consumeRateLimit(env.DB, { ...LOGIN, key: "other" }, now)).toBe(false);
    expect(await consumeRateLimit(env.DB, { ...LOGIN, name: "other" }, now)).toBe(false);
    expect(await consumeRateLimit(env.DB, LOGIN, now + 15 * 60_000)).toBe(false);
  });

  it("rejects an invalid limit or window", async () => {
    await expect(consumeRateLimit(env.DB, { ...LOGIN, limit: 0 })).rejects.toThrow("Invalid rate limit");
    await expect(consumeRateLimit(env.DB, { ...LOGIN, window: "soon" })).rejects.toThrow("Invalid rate limit window");
    expect(windowMs("2 h")).toBe(7_200_000);
  });

  it("purgeExpired deletes only expired windows", async () => {
    const now = 5_000_000;
    await consumeRateLimit(env.DB, { name: "purge", limit: 1, window: "1 m", key: "old" }, now);
    await consumeRateLimit(env.DB, { name: "purge", limit: 1, window: "1 h", key: "fresh" }, now);
    expect(await purgeExpired(env.DB, now + 120_000)).toBeGreaterThanOrEqual(1);
    const left = await env.DB.prepare(`SELECT key FROM ${TABLE} WHERE key LIKE '["purge"%'`).all<{ key: string }>();
    expect(left.results.map((r) => r.key)).toEqual([JSON.stringify(["purge", "fresh"])]);
    expect(await purgeExpired(env.DB, now + 120_000)).toBe(0);
  });
});

describe("getClientIp", () => {
  it("trusts only Cloudflare's connecting IP", () => {
    expect(getClientIp(new Headers({ "x-forwarded-for": "spoofed" }))).toBe("unknown");
    expect(getClientIp(new Headers({ "cf-connecting-ip": "203.0.113.8", "x-forwarded-for": "spoofed" }))).toBe("203.0.113.8");
  });
});

describe("failure policy", () => {
  const outage = { prepare() { throw new Error("database offline"); } } as unknown as D1Database;

  it("fails closed in production when D1 is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await isRateLimited({ DB: outage, ENVIRONMENT: "production" }, LOGIN)).toBe(true);
    expect(await isRateLimited({ ENVIRONMENT: "production" }, LOGIN)).toBe(true);
  });

  it("fails closed in production when the table is missing, and works again once it exists", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = [`CREATE TABLE ${TABLE} (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL)`];
    await env.DB.prepare(`DROP TABLE ${TABLE}`).run();
    try {
      const prod: RateLimitEnv = { DB: env.DB, ENVIRONMENT: "production" };
      expect(await isRateLimited(prod, { ...LOGIN, key: "no-table" })).toBe(true);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("rate-limit-unavailable"));
      // outside production the same error is thrown so a missing migration is noticed in development
      await expect(isRateLimited({ DB: env.DB, ENVIRONMENT: "dev" }, LOGIN)).rejects.toThrow();
      await expect(isRateLimited({ DB: env.DB }, LOGIN)).rejects.toThrow();
    } finally {
      await env.DB.prepare(create[0]!).run();
    }
    expect(await isRateLimited({ DB: env.DB, ENVIRONMENT: "production" }, { ...LOGIN, key: "back" })).toBe(false);
  });
});

describe("rateLimit middleware", () => {
  const app = new Hono<{ Bindings: RateLimitEnv }>();
  app.use("/limited", rateLimit({ name: "mw", limit: 2, window: "1 m" }));
  app.get("/limited", (c) => c.json({ ok: true }));

  it("answers 429 with Retry-After once the IP is over the limit; other IPs are unaffected", async () => {
    const call = (ip: string) => app.request("/limited", { headers: { "cf-connecting-ip": ip } }, env);
    expect((await call("198.51.100.1")).status).toBe(200);
    expect((await call("198.51.100.1")).status).toBe(200);
    const blocked = await call("198.51.100.1");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    expect((await call("198.51.100.2")).status).toBe(200);
  });
});
