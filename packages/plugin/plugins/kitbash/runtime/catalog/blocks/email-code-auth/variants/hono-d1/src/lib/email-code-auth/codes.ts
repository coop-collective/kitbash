// Six-digit email codes. A code is stored only as an HMAC (key derived from TOKEN_PEPPER for this purpose), so a D1
// leak alone does not let anyone brute-force the 10^6 space inside the code's lifetime. Codes are uniform
// (rejection-sampled), single use (conditional UPDATE), and limited to MAX_ATTEMPTS guesses, each counted atomically
// before the comparison. Sending is capped per address and across all addresses; past a cap the request is
// quietly dropped with the same reply, so the routes don't reveal which addresses exist or are limited.
import { newId, peppered, randomDigits, timingSafeEqual } from "{{paths.lib|rel}}/crypto-utils/crypto";
import { APP_NAME, escapeHtml, layout, MailError, sendMail, type Mail } from "{{paths.lib|rel}}/cf-email-sender/mail";
import { issueToken, normalEmail, pepperOf, upsertMember } from "./tokens";
import { AuthError, type AuthEnv, type Member } from "./types";

export const CODE_TTL_MIN = {{kit.codeTtlMin}};
export const CODE_TTL_MS = CODE_TTL_MIN * 60_000;
export const MAX_ATTEMPTS = 5;
/** codes one address can be sent per hour: enough for typos, too few to mail-bomb someone through the app */
export const PER_ADDRESS_PER_HOUR = 5;
/** codes sent across all addresses per ten minutes: sign-up is open, so this bounds what anyone can make the app mail */
export const GLOBAL_PER_10_MIN = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const codeHash = (pepper: string, email: string, code: string) => peppered(pepper, "login-code/v1", `${email}\n${code}`);

export function loginCodeMail(to: string, code: string): Mail {
  return {
    to,
    subject: `${code} is your ${APP_NAME} sign-in code`,
    text: `Your ${APP_NAME} sign-in code is ${code}\n\nIt works once, for ${CODE_TTL_MIN} minutes. If you did not ask for it, ignore this email.`,
    html: layout(`<p style="margin:0 0 10px;font-size:14px">Your sign-in code:</p>
<p style="margin:0 0 14px;font-size:30px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,Menlo,monospace">${escapeHtml(code)}</p>
<p style="margin:0;font-size:13px;color:#555">It works once, for ${CODE_TTL_MIN} minutes.</p>`),
  };
}

/**
 * Mails a code to any valid address (the account is made when the code is used). Throws AuthError 400 (bad address),
 * 500 (no pepper), 501 (no mailer) or 503 (send failed); otherwise resolves the same way whether or not a mail went out.
 */
export async function startCode(env: AuthEnv, emailIn: string): Promise<{ sent: true }> {
  const email = normalEmail(String(emailIn ?? ""));
  if (!EMAIL_RE.test(email) || email.length > 254) throw new AuthError(400, "bad_email", "a valid email address is required");
  const pepper = pepperOf(env);
  const now = Date.now();
  const recent = await env.DB.prepare(
    `SELECT (SELECT count(*) FROM {{kit.tablePrefix}}login_codes WHERE email = ? AND created_at > ?) AS mine,
            (SELECT count(*) FROM {{kit.tablePrefix}}login_codes WHERE created_at > ?) AS everyone`,
  )
    .bind(email, now - 3_600_000, now - 600_000)
    .first<{ mine: number; everyone: number }>();
  if ((recent?.mine ?? 0) >= PER_ADDRESS_PER_HOUR || (recent?.everyone ?? 0) >= GLOBAL_PER_10_MIN) {
    console.warn(JSON.stringify({ msg: "login code rate limited", scope: (recent?.mine ?? 0) >= PER_ADDRESS_PER_HOUR ? "address" : "global" }));
    return { sent: true };
  }
  const code = randomDigits(6);
  const id = newId("lc");
  await env.DB.prepare(`INSERT INTO {{kit.tablePrefix}}login_codes (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, email, await codeHash(pepper, email, code), now + CODE_TTL_MS, now)
    .run();
  try {
    await sendMail(env, loginCodeMail(email, code));
  } catch (err) {
    await env.DB.prepare(`DELETE FROM {{kit.tablePrefix}}login_codes WHERE id = ?`).bind(id).run();
    if (err instanceof MailError && err.code === "not_configured") throw new AuthError(501, "not_configured", "email sign-in is not configured here");
    throw new AuthError(503, "mail_failed", "the code could not be sent; try again in a moment");
  }
  return { sent: true };
}

export type SignIn = { token: string; member: Member; created: boolean };

/**
 * Uses up a code and returns the member, making the account on first use, without minting a token: for callers that
 * sign the person in some other way (an OAuth grant, a session). Null for a wrong, expired, used or exhausted code
 * (the caller answers 401 without saying which). The address is the verified one, normalized (trimmed, lowercased).
 */
export async function consumeCode(env: AuthEnv, emailIn: string, codeIn: string, name?: string): Promise<{ member: Member; created: boolean } | null> {
  const email = normalEmail(String(emailIn ?? ""));
  const code = String(codeIn ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code) || !EMAIL_RE.test(email)) return null;
  const pepper = pepperOf(env);
  const now = Date.now();
  // Count the attempt before comparing, in one statement: a crash, a race or a timing trick can't give a free guess.
  const row = await env.DB.prepare(
    `UPDATE {{kit.tablePrefix}}login_codes SET attempts = attempts + 1
     WHERE id = (SELECT id FROM {{kit.tablePrefix}}login_codes WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC, rowid DESC LIMIT 1)
       AND attempts < ?
     RETURNING id, code_hash`,
  )
    .bind(email, now, MAX_ATTEMPTS)
    .first<{ id: string; code_hash: string }>();
  if (!row) return null;
  if (!(await timingSafeEqual(row.code_hash, await codeHash(pepper, email, code)))) return null;
  // used_at IS NULL in the WHERE: of two verifies racing on one code, only one wins
  const used = await env.DB.prepare(`UPDATE {{kit.tablePrefix}}login_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`).bind(now, row.id).run();
  if (!used.meta.changes) return null;
  return upsertMember(env, email, name);
}

/**
 * Uses up a code (consumeCode) and mints a bearer token, making the account on first use. Null for a wrong, expired,
 * used or exhausted code (the caller answers 401 without saying which).
 */
export async function verifyCode(env: AuthEnv, emailIn: string, codeIn: string, label = "sign-in", name?: string): Promise<SignIn | null> {
  const r = await consumeCode(env, emailIn, codeIn, name);
  if (!r) return null;
  return { token: await issueToken(env, r.member.id, label), member: r.member, created: r.created };
}
