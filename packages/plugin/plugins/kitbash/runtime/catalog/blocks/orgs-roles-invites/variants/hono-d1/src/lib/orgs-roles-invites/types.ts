// The bindings and vars this block reads. Declared here (not from the generated Env) so the block typechecks before
// `wrangler types` is re-run in the host project.
export interface OrgsEnv {
  DB: D1Database;
  /** The org this env is scoped to; set only by inOrg(). Never a binding in production. */
  ORG_ID?: string;
  /** Cloudflare Email Service binding for invitation mail (optional: without it invites stand but are not mailed). */
  EMAIL?: { send(message: { from: { email: string; name: string } | string; to: string; subject: string; text: string; html?: string }): Promise<unknown> };
  MAIL_FROM?: string;
  ENVIRONMENT?: string;
}

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** The person, as the auth block's members table has them. */
export interface Person {
  id: string;
  email: string;
  name: string | null;
}

/** An org as seen by one person: with their role in it. */
export interface OrgRef {
  id: string;
  name: string;
  kind: "personal" | "team";
  role: OrgRole;
}

/** An error with an HTTP status and a stable code; the routes answer { error: { code, message } }. */
export class OrgError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 429,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
