// requireOrg: after the auth block's requireBearer (which sets c.get("member")). Resolves the org the request acts
// in (the {{kit.orgHeader}} header, else the person's default org; a new account gets its personal workspace and its
// waiting invitations here), then sets c.get("org") and replaces c.env with a copy scoped to it (orgOf(c.env) works).
// optionalOrg does the same but lets a person who is in no org yet through (the org routes use it, so such a person
// can still create an org); naming an org you are not in is a 403 either way.
import { createMiddleware } from "hono/factory";
import { inOrg } from "./scope";
import { resolveOrg } from "./service";
import { OrgError, type OrgRef, type OrgsEnv, type Person } from "./types";

export const ORG_HEADER = "{{kit.orgHeader}}";

export type OrgVars = { member: Person; org: OrgRef };

function orgMiddleware(required: boolean) {
  return createMiddleware<{ Bindings: OrgsEnv; Variables: OrgVars }>(async (c, next) => {
    const member = c.get("member");
    if (!member) return c.json({ error: { code: "unauthorized", message: "the org middleware runs after requireBearer" } }, 401);
    try {
      const org = await resolveOrg(c.env, member, c.req.header(ORG_HEADER)?.trim() || null);
      if (org) {
        c.set("org", org);
        c.env = inOrg(c.env, org.id);
      } else if (required) {
        return c.json({ error: { code: "no_org", message: "You are not in any org yet; create one or accept an invitation." } }, 403);
      }
    } catch (e) {
      if (e instanceof OrgError) return c.json({ error: { code: e.code, message: e.message } }, e.status);
      throw e;
    }
    await next();
  });
}

/** Scope the request to an org; 403 when the person is in none. */
export const requireOrg = orgMiddleware(true);
/** Scope the request to an org when the person has one; c.get("org") is undefined otherwise. */
export const optionalOrg = orgMiddleware(false);
