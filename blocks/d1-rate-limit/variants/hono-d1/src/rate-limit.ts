// Fixed-window rate limits in D1: one atomic UPSERT ... RETURNING per call, shared by every isolate and colo.
// Ported from mailcheap/lib/rate-limit.js (MIT, Copyright (c) 2026 Marc Lou; see LICENSE) from JavaScript to TypeScript.
//
// Fail closed: when ENVIRONMENT is "production" and D1 is unavailable or the table is missing, the request counts as
// limited, so a broken limiter never lets a login or code-spray attack through. Outside production the same error
// is thrown, so a forgotten migration shows up in development instead of silently allowing everything.
import { createMiddleware } from "hono/factory";

const TABLE = "{{kit.tablePrefix}}rate_limits";
const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

export interface RateLimitOptions {
  /** Which limit this is ("login", "api"); the same key under two names has two counters. */
  name: string;
  /** Requests allowed per window (a positive integer). */
  limit: number;
  /** "<amount> <unit>" with unit ms, s, m, h or d: "15 m", "1 h". The window starts at the first request. */
  window: string;
  /** Who is being limited: an IP, an API key id, a member id. */
  key: string;
}

/** The bindings this module reads. Declared here so it typechecks before `wrangler types` is re-run. */
export interface RateLimitEnv {
  DB?: D1Database;
  ENVIRONMENT?: string;
}

export function windowMs(window: string): number {
  const [amount, unit] = String(window).trim().split(/\s+/);
  const factor = UNIT_MS[unit as keyof typeof UNIT_MS];
  const duration = Number(amount) * (factor ?? Number.NaN);
  if (!Number.isSafeInteger(duration) || duration <= 0) throw new Error("Invalid rate limit window");
  return duration;
}

/**
 * Consumes one slot. Returns true when the caller is over the limit. One SQL statement atomically resets an expired
 * window or counts the hit; when the limit is already reached the UPSERT updates nothing and returns no row.
 */
export async function consumeRateLimit(db: D1Database, { name, limit, window, key }: RateLimitOptions, now = Date.now()): Promise<boolean> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid rate limit");
  const expiresAt = now + windowMs(window);
  const row = await db
    .prepare(
      `INSERT INTO ${TABLE} (key, hits, expires_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         hits = CASE WHEN expires_at <= ? THEN 1 ELSE hits + 1 END,
         expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
       WHERE expires_at <= ? OR hits < ?
       RETURNING hits`,
    )
    .bind(JSON.stringify([name, key]), expiresAt, now, now, now, limit)
    .first();
  return !row;
}

/** Cloudflare overwrites cf-connecting-ip at the edge; client-supplied forwarding headers are never an identity. */
export function getClientIp(headers: Headers): string {
  return headers.get("cf-connecting-ip") || "unknown";
}

/** consumeRateLimit with the production policy: fail closed in production, throw elsewhere. */
export async function isRateLimited(env: RateLimitEnv, options: RateLimitOptions, now = Date.now()): Promise<boolean> {
  try {
    if (!env.DB) throw new Error("DB binding is missing");
    return await consumeRateLimit(env.DB, options, now);
  } catch (error) {
    if (env.ENVIRONMENT !== "production") throw error;
    console.error(JSON.stringify({ event: "rate-limit-unavailable", name: options.name, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
}

/** Deletes expired windows; call it from a scheduled handler (wrangler `triggers.crons`). Returns the rows deleted. */
export async function purgeExpired(db: D1Database, now = Date.now()): Promise<number> {
  const r = await db.prepare(`DELETE FROM ${TABLE} WHERE expires_at <= ?`).bind(now).run();
  return r.meta.changes ?? 0;
}

/**
 * Hono middleware: 429 with Retry-After (the window length, an upper bound) when over the limit.
 * `key` defaults to the client IP; pass `(c) => c.req.header("authorization") ?? ""` style functions to limit by key.
 */
export function rateLimit(opts: { name: string; limit: number; window: string; key?: (c: { req: { raw: Request } }) => string }) {
  const retryAfter = String(Math.ceil(windowMs(opts.window) / 1000));
  return createMiddleware<{ Bindings: RateLimitEnv }>(async (c, next) => {
    const key = opts.key ? opts.key(c) : getClientIp(c.req.raw.headers);
    if (await isRateLimited(c.env, { name: opts.name, limit: opts.limit, window: opts.window, key })) {
      return c.json({ error: "rate_limited" }, 429, { "Retry-After": retryAfter });
    }
    await next();
  });
}
