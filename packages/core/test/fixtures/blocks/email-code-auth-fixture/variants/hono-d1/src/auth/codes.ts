import { hmacHex, randomDigits, timingSafeEqualHex } from "./crypto";
import { sendCode } from "./mail";
import { issueToken, upsertMember } from "./tokens";
import type { AuthEnv } from "./types";

const CODE_TTL_SECONDS = {{kit.codeTtlMin}} * 60;
const MAX_ATTEMPTS = 5;
const PER_ADDRESS_PER_HOUR = 5;
const GLOBAL_PER_10_MIN = 200;

function pepper(env: AuthEnv): string {
  if (!env.TOKEN_PEPPER) throw new Error("TOKEN_PEPPER is not set");
  return env.TOKEN_PEPPER;
}

export async function startCode(env: AuthEnv, email: string): Promise<{ sent: true }> {
  const addr = email.trim().toLowerCase();
  const [perAddr, overall] = await Promise.all([
    env.DB.prepare(`SELECT count(*) AS n FROM {{kit.tablePrefix}}login_codes WHERE email = ? AND created_at > datetime('now', '-1 hour')`).bind(addr).first<{ n: number }>(),
    env.DB.prepare(`SELECT count(*) AS n FROM {{kit.tablePrefix}}login_codes WHERE created_at > datetime('now', '-10 minutes')`).first<{ n: number }>(),
  ]);
  if ((perAddr?.n ?? 0) >= PER_ADDRESS_PER_HOUR || (overall?.n ?? 0) >= GLOBAL_PER_10_MIN) return { sent: true }; // quiet drop
  const code = randomDigits(6);
  const codeHash = await hmacHex(pepper(env), `${addr}:${code}`);
  await env.DB.prepare(`INSERT INTO {{kit.tablePrefix}}login_codes (id, email, code_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+${CODE_TTL_SECONDS} seconds'))`)
    .bind(crypto.randomUUID(), addr, codeHash)
    .run();
  await sendCode(env, addr, code);
  return { sent: true };
}

export async function verifyCode(env: AuthEnv, email: string, code: string): Promise<{ token: string; member_id: string } | null> {
  const addr = email.trim().toLowerCase();
  const row = await env.DB.prepare(
    `SELECT id, code_hash, attempts FROM {{kit.tablePrefix}}login_codes WHERE email = ? AND used_at IS NULL AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(addr)
    .first<{ id: string; code_hash: string; attempts: number }>();
  if (!row || row.attempts >= MAX_ATTEMPTS) return null;
  // count the attempt before comparing, so a crash or a timing trick can't give a free try
  await env.DB.prepare(`UPDATE {{kit.tablePrefix}}login_codes SET attempts = attempts + 1 WHERE id = ?`).bind(row.id).run();
  const expected = await hmacHex(pepper(env), `${addr}:${code}`);
  if (!timingSafeEqualHex(expected, row.code_hash)) return null;
  const used = await env.DB.prepare(`UPDATE {{kit.tablePrefix}}login_codes SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`).bind(row.id).run();
  if (!used.meta.changes) return null; // single use, enforced by the conditional update
  const member = await upsertMember(env, addr);
  return { token: await issueToken(env, member.id, "sign-in"), member_id: member.id };
}
