// The one seam to the auth block (email-code-auth, BLOCK-SPEC section 10 interface): who a pasted bearer token is,
// who a member id is, and (optionally) email-code sign-in on the authorize page. If your auth block names these
// differently, this is the only file to change.
import { authenticate } from "{{paths.lib|rel}}/auth/tokens";
{{#kit.if emailSignIn}}
import { startCode, verifyCode } from "{{paths.lib|rel}}/auth/codes";
{{/kit.if}}
import type { OAuthEnv, OAuthMember } from "./types";

type AuthEnvOf = Parameters<typeof authenticate>[0];
const authEnv = (env: OAuthEnv) => env as unknown as AuthEnvOf;

/** The person a bearer token belongs to, or null (unknown, revoked, or malformed). Never throws. */
export async function memberByToken(env: OAuthEnv, token: string): Promise<OAuthMember | null> {
  try {
    const m = await authenticate(authEnv(env), token);
    return m ? { id: m.id, email: m.email, name: m.name ?? null } : null;
  } catch {
    return null;
  }
}

export async function memberById(env: OAuthEnv, id: string): Promise<OAuthMember | null> {
  return env.DB.prepare("SELECT id, email, name FROM {{kit.authTablePrefix}}members WHERE id = ?").bind(id).first<OAuthMember>();
}

/** Whether the authorize page offers email-code sign-in (param emailSignIn). Token sign-in is always offered. */
export const EMAIL_SIGN_IN = {{#kit.if emailSignIn}}true{{kit.else}}false{{/kit.if}};

export async function sendSignInCode(env: OAuthEnv, email: string): Promise<void> {
{{#kit.if emailSignIn}}
  await startCode(authEnv(env), email);
{{kit.else}}
  void env;
  void email;
  throw new Error("email sign-in is off (param emailSignIn)");
{{/kit.if}}
}

/** Check a sign-in code; the person on success, else null. */
export async function memberByCode(env: OAuthEnv, email: string, code: string): Promise<OAuthMember | null> {
{{#kit.if emailSignIn}}
  // verifyCode also mints a bearer token labelled "sign-in"; it is never shown (only its HMAC is stored).
  const r = await verifyCode(authEnv(env), email, code);
  return r ? memberById(env, r.member_id) : null;
{{kit.else}}
  void env;
  void email;
  void code;
  return null;
{{/kit.if}}
}
