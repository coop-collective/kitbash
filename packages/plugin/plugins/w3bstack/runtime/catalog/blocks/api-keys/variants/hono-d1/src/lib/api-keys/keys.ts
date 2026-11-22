// API keys: `{{kit.keyPrefix}}<id>_<secret>`.
//   id      8 lowercase base32 chars: the table's primary key, public, safe to show in a dashboard
//   secret  43 base62 chars (~256 bits), shown ONCE at creation and never stored
//   stored  key_hash = hex HMAC-SHA256(KEY_PEPPER, "apikey:" + secret), so a D1 dump alone cannot test guesses
//   lookup  parse id -> KV `key:<id>` (if the KEY_CACHE binding exists) -> D1 -> constant-time hash compare
//   revoke  revoked_ms in D1, then the KV entry is deleted. Other colos may serve a cached entry for up to
//           KEY_CACHE_TTL_S seconds; bind KEY_CACHE to nothing (no cache) when that window is unacceptable.
// Harvested from inference-market/packages/web/src/lib/api-keys/keys.ts with its accounts, buyback and OAuth coupling removed.
import { hmacHex, randomB32, randomB62, safeEqual } from "./crypto";

export const KEY_PREFIX = "{{kit.keyPrefix}}";
const KEY_RE = new RegExp(`^${KEY_PREFIX}([a-z2-7]{8})_([0-9A-Za-z]{43})$`);
/** Seconds a verified key stays in KV. Cloudflare KV needs at least 60. */
export const KEY_CACHE_TTL_S = {{kit.cacheTtlS}};
export const MAX_ACTIVE_KEYS = {{kit.maxActiveKeys}};
const TABLE = "{{kit.tablePrefix}}api_keys";
const kvKey = (id: string) => `key:${id}`;

/** The bindings this module reads. KEY_CACHE is optional: without it every call goes to D1. */
export interface ApiKeysEnv {
  DB: D1Database;
  KEY_PEPPER?: string;
  KEY_CACHE?: KVNamespace;
}

/** What a verified key resolves to. `owner_id` is whatever you passed to createKey (member, org or account id). */
export interface ApiKeyAuth {
  owner_id: string;
  key_id: string;
  scopes: string[];
}

/** What the KV cache holds per key id: enough for ApiKeyAuth plus the hash to compare. Never the secret. */
type CachedKey = { owner_id: string; key_hash: string; scopes: string[]; revoked: boolean };

export interface ApiKeyRow {
  id: string;
  owner_id: string;
  name: string;
  key_hash: string;
  scopes: string;
  created_ms: number;
  last_used_ms: number | null;
  revoked_ms: number | null;
}
export type KeyListItem = Omit<ApiKeyRow, "key_hash">;

function pepper(env: Pick<ApiKeysEnv, "KEY_PEPPER">): string {
  if (!env.KEY_PEPPER || env.KEY_PEPPER.length < 16) throw new Error("KEY_PEPPER is not configured");
  return env.KEY_PEPPER;
}

export const hashSecret = (env: Pick<ApiKeysEnv, "KEY_PEPPER">, secret: string) => hmacHex(pepper(env), `apikey:${secret}`);

/** Split `{{kit.keyPrefix}}<id>_<secret>` (an optional "Bearer " prefix is tolerated). Null for anything else. */
export function parseKey(bearer: string): { id: string; secret: string } | null {
  const m = KEY_RE.exec(bearer.trim().replace(/^Bearer\s+/i, ""));
  return m ? { id: m[1]!, secret: m[2]! } : null;
}

const splitScopes = (s: string): string[] => (s ? s.split(" ") : []);

// KV is a cache, never a dependency: any KV error is a miss (read) or ignored (write, delete).
async function cacheGet(env: ApiKeysEnv, id: string): Promise<CachedKey | null> {
  if (!env.KEY_CACHE) return null;
  try {
    return await env.KEY_CACHE.get<CachedKey>(kvKey(id), "json");
  } catch {
    return null;
  }
}
async function cachePut(env: ApiKeysEnv, id: string, c: CachedKey): Promise<void> {
  if (!env.KEY_CACHE) return;
  try {
    await env.KEY_CACHE.put(kvKey(id), JSON.stringify(c), { expirationTtl: KEY_CACHE_TTL_S });
  } catch {
    /* a failed cache write only costs a D1 read next time */
  }
}
async function cacheDelete(env: Pick<ApiKeysEnv, "KEY_CACHE">, id: string): Promise<void> {
  if (!env.KEY_CACHE) return;
  try {
    await env.KEY_CACHE.delete(kvKey(id));
  } catch {
    /* the entry expires within KEY_CACHE_TTL_S */
  }
}

async function loadKey(env: ApiKeysEnv, id: string, now: number): Promise<CachedKey | null> {
  const hit = await cacheGet(env, id);
  if (hit) return hit;
  const row = await env.DB.prepare(`SELECT owner_id, key_hash, scopes, revoked_ms FROM ${TABLE} WHERE id = ?`)
    .bind(id)
    .first<Pick<ApiKeyRow, "owner_id" | "key_hash" | "scopes" | "revoked_ms">>();
  if (!row) return null;
  const c: CachedKey = { owner_id: row.owner_id, key_hash: row.key_hash, scopes: splitScopes(row.scopes), revoked: row.revoked_ms != null };
  await cachePut(env, id, c);
  if (!c.revoked) {
    // best effort, at most one write per key per minute
    await env.DB.prepare(`UPDATE ${TABLE} SET last_used_ms = ? WHERE id = ? AND (last_used_ms IS NULL OR last_used_ms < ?)`)
      .bind(now, id, now - 60_000)
      .run()
      .catch(() => {});
  }
  return c;
}

/**
 * Verifies a bearer value (with or without "Bearer "). Null for a malformed, unknown, wrong-secret or revoked key.
 * The hash is compared even on a miss, against a dummy, so timing does not reveal which ids exist.
 */
export async function authenticateKey(env: ApiKeysEnv, bearer: string | null | undefined, now = Date.now()): Promise<ApiKeyAuth | null> {
  const p = parseKey(bearer ?? "");
  if (!p) return null;
  const k = await loadKey(env, p.id, now);
  const want = await hashSecret(env, p.secret);
  const ok = safeEqual(want, k?.key_hash ?? "0".repeat(64));
  if (!k || !ok || k.revoked) return null;
  return { owner_id: k.owner_id, key_id: p.id, scopes: k.scopes };
}

/** Scopes are labels you enforce yourself. A key created without scopes has none; use ["*"] for full access. */
export const hasScope = (auth: Pick<ApiKeyAuth, "scopes">, scope: string): boolean => auth.scopes.includes("*") || auth.scopes.includes(scope);

// ---------------------------------------------------------------------------------------------------------------
// dashboard operations (always scoped to one owner)
// ---------------------------------------------------------------------------------------------------------------

export const cleanName = (v: unknown): string => {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64) : "";
  return s || "default";
};

const SCOPE_RE = /^(\*|[a-z][a-z0-9:._-]{0,31})$/;
/** Valid scope labels, deduplicated; null when any is malformed or there are more than 20. */
export function cleanScopes(v: unknown): string[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 20 || !v.every((s) => typeof s === "string" && SCOPE_RE.test(s))) return null;
  return [...new Set(v as string[])];
}

/** Creates a key. Returns the full key string: the ONLY time it exists outside the caller's hands. */
export async function createKey(
  env: ApiKeysEnv,
  ownerId: string,
  opts: { name?: unknown; scopes?: unknown } = {},
  now = Date.now(),
): Promise<{ ok: true; id: string; key: string } | { ok: false; error: string }> {
  const scopes = cleanScopes(opts.scopes);
  if (!scopes) return { ok: false, error: "invalid scopes" };
  const active = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${TABLE} WHERE owner_id = ? AND revoked_ms IS NULL`).bind(ownerId).first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_ACTIVE_KEYS) return { ok: false, error: `at most ${MAX_ACTIVE_KEYS} active keys` };
  const secret = randomB62(43);
  const hash = await hashSecret(env, secret);
  for (let attempt = 0; attempt < 4; attempt++) {
    const id = randomB32(8);
    try {
      await env.DB.prepare(`INSERT INTO ${TABLE} (id, owner_id, name, key_hash, scopes, created_ms) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(id, ownerId, cleanName(opts.name), hash, scopes.join(" "), now)
        .run();
      return { ok: true, id, key: `${KEY_PREFIX}${id}_${secret}` };
    } catch (e) {
      if (!String(e).includes("UNIQUE")) throw e;
    }
  }
  throw new Error("could not allocate a key id");
}

/** The owner's keys, active first, newest first. Never includes the hash. */
export async function listKeys(env: Pick<ApiKeysEnv, "DB">, ownerId: string): Promise<KeyListItem[]> {
  const r = await env.DB.prepare(
    `SELECT id, owner_id, name, scopes, created_ms, last_used_ms, revoked_ms FROM ${TABLE}
     WHERE owner_id = ? ORDER BY revoked_ms IS NOT NULL, created_ms DESC`,
  )
    .bind(ownerId)
    .all<KeyListItem>();
  return r.results;
}

/** Renames an active key; busts the cache so the change applies within one request. */
export async function renameKey(env: ApiKeysEnv, ownerId: string, id: string, name: unknown): Promise<boolean> {
  const r = await env.DB.prepare(`UPDATE ${TABLE} SET name = ? WHERE id = ? AND owner_id = ? AND revoked_ms IS NULL`).bind(cleanName(name), id, ownerId).run();
  await cacheDelete(env, id);
  return (r.meta.changes ?? 0) > 0;
}

/** Revokes (idempotent). D1 first, then the KV entry. Returns whether a key was newly revoked. */
export async function revokeKey(env: ApiKeysEnv, ownerId: string, id: string, now = Date.now()): Promise<boolean> {
  const r = await env.DB.prepare(`UPDATE ${TABLE} SET revoked_ms = ? WHERE id = ? AND owner_id = ? AND revoked_ms IS NULL`).bind(now, id, ownerId).run();
  await cacheDelete(env, id);
  return (r.meta.changes ?? 0) > 0;
}
