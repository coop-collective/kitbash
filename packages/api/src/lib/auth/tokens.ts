// Opaque bearer tokens: `kit_` + 32 random bytes (base64url, 43 chars). Only an HMAC of the token is stored,
// under a key derived from TOKEN_PEPPER for this purpose, so neither a D1 leak nor a pepper leak alone yields a
// working token. Lookup is by that hash: there is no string comparison to time.
import { newId, peppered, randomToken } from "../crypto";
import { AuthError, type AuthEnv, type Member } from "./types";

export const TOKEN_PREFIX = "kit_";
export const TOKEN_RE = /^kit_[A-Za-z0-9_-]{43}$/;
/** last_used_at is written at most once a minute per token, not on every request. */
const LAST_USED_RESOLUTION_MS = 60_000;

/** The pepper, or a 500 `not_configured`: the block never hashes with an empty or short key. */
export function pepperOf(env: AuthEnv): string {
  const p = env.TOKEN_PEPPER;
  if (!p || p.length < 32) throw new AuthError(500, "not_configured", "TOKEN_PEPPER is missing or shorter than 32 characters");
  return p;
}

export const tokenHash = (env: AuthEnv, token: string) => peppered(pepperOf(env), "bearer-token/v1", token);

/** The token in an `Authorization: Bearer …` header, or null. */
export function bearerOf(header: string | null | undefined): string | null {
  const m = header ? /^Bearer\s+(\S+)$/i.exec(header.trim()) : null;
  return m ? m[1]! : null;
}

export const normalEmail = (e: string) => e.trim().toLowerCase();

/** Finds or creates the member for a (normalized) address. */
export async function upsertMember(env: AuthEnv, email: string, name?: string): Promise<{ member: Member; created: boolean }> {
  const fresh = await env.DB.prepare(
    `INSERT INTO members (id, email, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING RETURNING id, email, name, created_at`,
  )
    .bind(newId("mem"), email, name?.trim().slice(0, 80) || null, Date.now())
    .first<Member>();
  if (fresh) return { member: fresh, created: true };
  const member = await env.DB.prepare(`SELECT id, email, name, created_at FROM members WHERE email = ?`).bind(email).first<Member>();
  if (!member) throw new Error("member upsert failed");
  return { member, created: false };
}

/** Stores a new token for a member and returns the plaintext (show it once). */
export async function issueToken(env: AuthEnv, memberId: string, label = ""): Promise<string> {
  const token = TOKEN_PREFIX + randomToken(32);
  await env.DB.prepare(`INSERT INTO member_tokens (id, member_id, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(newId("tok"), memberId, await tokenHash(env, token), label.slice(0, 80), Date.now())
    .run();
  return token;
}

/** The member and token id behind a live token, or null. */
export async function resolveBearer(env: AuthEnv, token: string | null): Promise<{ member: Member; tokenId: string } | null> {
  if (!token || !TOKEN_RE.test(token)) return null;
  const row = await env.DB.prepare(
    `SELECT m.id, m.email, m.name, m.created_at, t.id AS token_id, t.last_used_at
     FROM member_tokens t JOIN members m ON m.id = t.member_id
     WHERE t.token_hash = ? AND t.revoked_at IS NULL`,
  )
    .bind(await tokenHash(env, token))
    .first<Member & { token_id: string; last_used_at: number | null }>();
  if (!row) return null;
  const now = Date.now();
  if (row.last_used_at === null || now - row.last_used_at > LAST_USED_RESOLUTION_MS) {
    await env.DB.prepare(`UPDATE member_tokens SET last_used_at = ? WHERE id = ?`).bind(now, row.token_id).run();
  }
  return { member: { id: row.id, email: row.email, name: row.name, created_at: row.created_at }, tokenId: row.token_id };
}

/** The member behind a live token, or null. */
export async function authenticate(env: AuthEnv, token: string | null): Promise<Member | null> {
  return (await resolveBearer(env, token))?.member ?? null;
}

/** Revokes a token by its plaintext. Returns whether a live token was revoked. */
export async function revokeToken(env: AuthEnv, token: string): Promise<boolean> {
  if (!TOKEN_RE.test(token)) return false;
  const r = await env.DB.prepare(`UPDATE member_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`)
    .bind(Date.now(), await tokenHash(env, token))
    .run();
  return r.meta.changes > 0;
}

/** Revokes a token by id (as set by requireBearer in `tokenId`). */
export async function revokeTokenId(env: AuthEnv, tokenId: string): Promise<boolean> {
  const r = await env.DB.prepare(`UPDATE member_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).bind(Date.now(), tokenId).run();
  return r.meta.changes > 0;
}
