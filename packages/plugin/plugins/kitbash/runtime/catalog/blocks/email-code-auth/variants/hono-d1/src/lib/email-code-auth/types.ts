// The bindings, vars and secrets this block reads. Declared here (not taken from the generated Env) so the block
// typechecks before `wrangler types` is re-run; the generated Env satisfies it.
import type { MailEnv } from "{{paths.lib|rel}}/cf-email-sender/mail";

export interface AuthEnv extends MailEnv {
  DB: D1Database;
  /** Secret, 32+ characters (openssl rand -hex 32). Keys the HMACs of codes and tokens. */
  TOKEN_PEPPER?: string;
}

export interface Member {
  id: string;
  email: string;
  name: string | null;
  created_at: number;
}

/** Hono variables set by requireBearer. */
export type AuthVariables = { member: Member; tokenId: string };

export type AuthErrorStatus = 400 | 401 | 500 | 501 | 503;

/** An auth failure with an HTTP status and a stable code; the routes map it to `{ error: code, message }`. */
export class AuthError extends Error {
  constructor(
    readonly status: AuthErrorStatus,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}
