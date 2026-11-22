// requirePerson: for the API route ({{kit.apiRoute}}) and anything else a CLI calls. It accepts either an OAuth caller
// (set by this block's provider wrapper after the access token and the sign-in row were checked) or the app's own
// bearer token (email-code-auth's requireBearer). Either way c.get("member") is the person.
import { createMiddleware } from "hono/factory";
import { requireBearer } from "{{paths.lib|rel}}/email-code-auth/middleware";
import type { CliLogin, OAuthEnv, OAuthMember } from "./types";

export type PersonVars = { member: OAuthMember; cliLogin: CliLogin | null };

export const requirePerson = createMiddleware<{ Bindings: OAuthEnv; Variables: PersonVars }>(async (c, next) => {
  const caller = c.env.OAUTH_CALLER;
  if (caller) {
    c.set("member", caller.member);
    c.set("cliLogin", caller.login);
    return next();
  }
  c.set("cliLogin", null);
  return (requireBearer as unknown as (cc: typeof c, n: typeof next) => Promise<Response | void>)(c, next);
});
