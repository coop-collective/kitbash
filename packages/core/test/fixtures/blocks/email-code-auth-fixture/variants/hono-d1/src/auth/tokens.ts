import { base64url, hmacHex } from "./crypto";
import type { AuthEnv, Member } from "./types";

export const TOKEN_PREFIX = "{{kit.tokenPrefix}}";

function pepper(env: AuthEnv): string {
  if (!env.TOKEN_PEPPER) throw new Error("TOKEN_PEPPER is not set");
  return env.TOKEN_PEPPER;
}

export async function upsertMember(env: AuthEnv, email: string): Promise<Member> {
  await env.DB.prepare(`INSERT INTO {{kit.tablePrefix}}members (id, email) VALUES (?, ?) ON CONFLICT(email) DO NOTHING`).bind(crypto.randomUUID(), email).run();
  const m = await env.DB.prepare(`SELECT id, email, name FROM {{kit.tablePrefix}}members WHERE email = ?`).bind(email).first<Member>();
  if (!m) throw new Error("member upsert failed");
  return m;
}

/** Issues an opaque token; only its HMAC is stored. The token is shown once. */
export async function issueToken(env: AuthEnv, memberId: string, label: string): Promise<string> {
  const token = `${TOKEN_PREFIX}${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  await env.DB.prepare(`INSERT INTO {{kit.tablePrefix}}member_tokens (id, member_id, token_hash, label) VALUES (?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), memberId, await hmacHex(pepper(env), token), label)
    .run();
  return token;
}

export async function authenticate(env: AuthEnv, bearer: string | null): Promise<Member | null> {
  if (!bearer || !bearer.startsWith(TOKEN_PREFIX)) return null;
  const hash = await hmacHex(pepper(env), bearer);
  const m = await env.DB.prepare(
    `SELECT m.id, m.email, m.name FROM {{kit.tablePrefix}}member_tokens t JOIN {{kit.tablePrefix}}members m ON m.id = t.member_id WHERE t.token_hash = ? AND t.revoked_at IS NULL`,
  )
    .bind(hash)
    .first<Member>();
  if (m) await env.DB.prepare(`UPDATE {{kit.tablePrefix}}member_tokens SET last_used_at = datetime('now') WHERE token_hash = ?`).bind(hash).run();
  return m ?? null;
}

export async function revokeToken(env: AuthEnv, token: string): Promise<void> {
  await env.DB.prepare(`UPDATE {{kit.tablePrefix}}member_tokens SET revoked_at = datetime('now') WHERE token_hash = ?`).bind(await hmacHex(pepper(env), token)).run();
}
