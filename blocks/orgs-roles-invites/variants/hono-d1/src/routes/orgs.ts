// REST for orgs, people, roles and invitations. Mount under {{kit.routePrefix}}: app.route("{{kit.routePrefix}}", orgRoutes).
// Each route runs requireBearer (the auth block) then optionalOrg; nothing here applies to your other routes.
import { Hono, type Context } from "hono";
import { requireBearer } from "{{paths.lib|rel}}/auth/middleware";
import { inviteMail, mailer } from "{{paths.lib|rel}}/orgs/invite-mail";
import { optionalOrg, type OrgVars } from "{{paths.lib|rel}}/orgs/middleware";
import {
  createOrg,
  deleteOrg,
  inviteToOrg,
  listOrgs,
  orgPeople,
  removeFromOrg,
  revokeInvite,
  setDefaultOrg,
  setMemberRole,
  updateOrg,
} from "{{paths.lib|rel}}/orgs/service";
import { OrgError, type OrgsEnv } from "{{paths.lib|rel}}/orgs/types";

type C = Context<{ Bindings: OrgsEnv; Variables: OrgVars }>;

export const orgRoutes = new Hono<{ Bindings: OrgsEnv; Variables: OrgVars }>();

for (const path of ["/org", "/orgs", "/orgs/*"]) orgRoutes.use(path, requireBearer as never, optionalOrg);

orgRoutes.onError((e, c) => {
  if (e instanceof OrgError) return c.json({ error: { code: e.code, message: e.message } }, e.status);
  throw e;
});

async function body(c: C): Promise<Record<string, unknown>> {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new OrgError(400, "bad_request", "a JSON object body is required");
  return b as Record<string, unknown>;
}

/** The org this request acts in, and my role there. */
orgRoutes.get("/org", (c) => c.json({ org: c.get("org") ?? null }));
orgRoutes.get("/orgs", async (c) => c.json(await listOrgs(c.env, c.get("member"), c.get("org")?.id ?? null)));
orgRoutes.post("/orgs", async (c) => c.json(await createOrg(c.env, c.get("member"), await body(c)), 201));
orgRoutes.patch("/orgs/:id", async (c) => c.json(await updateOrg(c.env, c.get("member"), c.req.param("id"), await body(c))));
orgRoutes.delete("/orgs/:id", async (c) => c.json(await deleteOrg(c.env, c.get("member"), c.req.param("id"))));
orgRoutes.post("/orgs/:id/default", async (c) => c.json(await setDefaultOrg(c.env, c.get("member"), c.req.param("id"))));
orgRoutes.get("/orgs/:id/people", async (c) => c.json(await orgPeople(c.env, c.get("member"), c.req.param("id"))));
orgRoutes.post("/orgs/:id/invites", async (c) => {
  const me = c.get("member");
  const send = mailer(c.env);
  // the email is a courtesy: an invite stands even when no mail could be sent (inviteToOrg logs the failure)
  const notify = send ? (to: string, org: string) => send(inviteMail(to, org, me.name ?? me.email)) : undefined;
  return c.json({ ...(await inviteToOrg(c.env, me, c.req.param("id"), await body(c), notify)), emailed: !!send }, 201);
});
orgRoutes.delete("/orgs/:id/invites/:inviteId", async (c) => c.json(await revokeInvite(c.env, c.get("member"), c.req.param("id"), c.req.param("inviteId"))));
orgRoutes.patch("/orgs/:id/members/:memberId", async (c) => {
  const b = await body(c);
  return c.json(await setMemberRole(c.env, c.get("member"), c.req.param("id"), c.req.param("memberId"), b.role));
});
orgRoutes.delete("/orgs/:id/members/:memberId", async (c) => c.json(await removeFromOrg(c.env, c.get("member"), c.req.param("id"), c.req.param("memberId"))));
