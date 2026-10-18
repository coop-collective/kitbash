// The bindings and vars this block reads. Declared here (not from the generated Env) so the block typechecks
// before `wrangler types` is re-run in the host project.
export interface AuthEnv {
  DB: D1Database;
  TOKEN_PEPPER?: string;
  MAIL_FROM?: string;
  ENVIRONMENT?: string;
  EMAIL?: { send(message: { from: string; to: string; subject: string; text: string }): Promise<unknown> };
}

export interface Member {
  id: string;
  email: string;
  name: string | null;
}
