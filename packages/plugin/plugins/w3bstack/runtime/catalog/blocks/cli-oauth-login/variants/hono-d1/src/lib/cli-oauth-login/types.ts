// The bindings and vars this block reads. Declared here (not from the generated Env) so the block typechecks before
// `wrangler types` is re-run in the host project.
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface OAuthEnv {
  DB: D1Database;
  /** The OAuth provider's storage: clients, grants, tokens (hashed), and the authorize page's sign-in sessions. */
  OAUTH_KV: KVNamespace;
  /** Set by the provider on requests it hands to the app (the authorize routes use it). */
  OAUTH_PROVIDER?: OAuthHelpers;
  /** The origin tokens are bound to (https://app.example.com). Unset: the request's own (https, or http on loopback). */
  PUBLIC_ORIGIN?: string;
  /** Read by email-code-auth's token functions, which this block calls with the same env. */
  TOKEN_PEPPER?: string;
  ENVIRONMENT?: string;
  /** Set only by this block's API handler on a request that carried a valid OAuth access token (src: provider.ts). */
  OAUTH_CALLER?: OAuthCaller;
}

/** The person, as email-code-auth's members table has them. */
export interface OAuthMember {
  id: string;
  email: string;
  name: string | null;
}

export interface CliLogin {
  id: string;
  member_id: string;
  label: string;
  client_id: string | null;
  client_name: string | null;
  redirect_host: string | null;
  loopback: number;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

/** What an OAuth grant carries (its props): a person's CLI. */
export type CliProps = { kind: "cli"; cli_id: string; member_id: string };

/** Who an OAuth access token stands for, after the sign-in row was checked. */
export interface OAuthCaller {
  member: OAuthMember;
  login: CliLogin;
}
