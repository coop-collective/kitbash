// Orgs end to end: personal workspaces, invitations (existing accounts join at once, new addresses on their first
// request), roles and who may do what, the org header and scoping, the daily invite cap. Ported from Ideator's
// test/orgs-access.test.ts without the product records (projects, tasks, agents).
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { issueToken, upsertMember } from "{{paths.lib|rel}}/auth/tokens";
import { requireBearer } from "{{paths.lib|rel}}/auth/middleware";
import { setMailHook, type Mail } from "{{paths.lib|rel}}/orgs/invite-mail";
import { ORG_HEADER, requireOrg, type OrgVars } from "{{paths.lib|rel}}/orgs/middleware";
import { doName, inOrg, orgKey, orgOf, ORG_DATA_TABLES{{#kit.if productRoles}}, productRole{{/kit.if}}{{#kit.if legacyOrgId}}, LEGACY_ORG_ID{{/kit.if}} } from "{{paths.lib|rel}}/orgs/scope";
import { onSignIn } from "{{paths.lib|rel}}/orgs/service";
import type { OrgsEnv } from "{{paths.lib|rel}}/orgs/types";
import { orgRoutes } from "{{paths.routes|rel}}/orgs";

const testEnv = { ...(env as unknown as OrgsEnv), TOKEN_PEPPER: "test-pepper-not-a-secret-32-chars-min" } as OrgsEnv & { TOKEN_PEPPER: string };

// the app as a host project wires it: the org routes, and one org-scoped route of its own
const app = new Hono<{ Bindings: OrgsEnv; Variables: OrgVars }>();
app.route("{{kit.routePrefix}}", orgRoutes);
app.get("/app/where", requireBearer as never, requireOrg, (c) => c.json({ org: orgOf(c.env), role: c.get("org").role }));

type Res = { status: number; json: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(path: string, opts: { token?: string; method?: string; body?: unknown; org?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.org) headers[ORG_HEADER] = opts.org;
  const res = await app.request(
    path,
    { method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined },
    testEnv,
  );
  return { status: res.status, json: await res.json().catch(() => null) };
}
const api = (p: string) => `{{kit.routePrefix}}${p}`;

/** A person with a bearer token, made through the auth block's own upsertMember and issueToken (its members table). */
async function person(name: string, email?: string) {
  const authEnv = testEnv as unknown as Parameters<typeof issueToken>[0];
  const addr = (email ?? `${name}-${crypto.randomUUID().slice(0, 8)}@example.test`).toLowerCase();
  const { member: m } = await upsertMember(authEnv, addr, name);
  const token = await issueToken(authEnv, m.id, "test");
  return { id: m.id, email: addr, name, token };
}

async function withTeam(name: string) {
  const p = await person(name);
  const r = await call(api("/orgs"), { token: p.token, body: { name: `${name}'s team` } });
  expect(r.status).toBe(201);
  return { ...p, org: r.json.org.id as string };
}

const mails: Mail[] = [];
setMailHook(async (m) => void mails.push(m));
afterEach(() => {
  mails.length = 0;
});

describe("scope", () => {
  it("orgOf throws when unscoped; inOrg scopes a copy", () => {
    expect(() => orgOf(testEnv)).toThrow(/no org in scope/);
    const scoped = inOrg(testEnv, "org_a");
    expect(orgOf(scoped)).toBe("org_a");
    expect(testEnv.ORG_ID).toBeUndefined();
    expect(inOrg(scoped, "org_a")).toBe(scoped);
    expect(orgKey(scoped, "files/x.png")).toBe("orgs/org_a/files/x.png");
    expect(doName("org_a")).toBe("org_a");
  });
{{#kit.if legacyOrgId}}

  it("the legacy org keeps its unprefixed keys and the default Durable Object", () => {
    expect(orgKey(inOrg(testEnv, LEGACY_ORG_ID), "files/x.png")).toBe("files/x.png");
    expect(doName(LEGACY_ORG_ID)).toBe("default");
  });
{{/kit.if}}
{{#kit.if productRoles}}

  it("productRole maps owner and admin to the owner powers", () => {
    expect([productRole("owner"), productRole("admin"), productRole("member")]).toEqual(["owner", "owner", "member"]);
  });
{{/kit.if}}
});

describe("sign-up and invitations", () => {
{{#kit.if personalOrgs}}
  it("a new account gets one personal workspace on its first request", async () => {
    const p = await person("Solo");
    const where = await call("/app/where", { token: p.token });
    expect(where.status).toBe(200);
    expect(where.json.role).toBe("owner");
    const orgs = await call(api("/orgs"), { token: p.token });
    expect(orgs.json.orgs).toHaveLength(1);
    expect(orgs.json.orgs[0]).toMatchObject({ kind: "personal", personal: true, role: "owner", name: "Solo" });
    expect(orgs.json.default_org_id).toBe(orgs.json.orgs[0].id);
    await call("/app/where", { token: p.token });
    await onSignIn(testEnv, p);
    const n = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM {{kit.tablePrefix}}orgs WHERE personal_of = ?").bind(p.id).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it("a personal workspace is neither shared nor deleted", async () => {
    const p = await person("Mine");
    const mine = (await call(api("/org"), { token: p.token })).json.org.id as string;
    expect((await call(api(`/orgs/${mine}/invites`), { token: p.token, body: { email: "friend@example.test" } })).status).toBe(403);
    expect((await call(api(`/orgs/${mine}`), { method: "DELETE", token: p.token })).status).toBe(403);
    expect((await call(api(`/orgs/${mine}/members/${p.id}`), { method: "DELETE", token: p.token })).status).toBe(403);
  });
{{kit.else}}
  it("without personal workspaces a new account is in no org until it creates or joins one", async () => {
    const p = await person("Nobody");
    const r = await call("/app/where", { token: p.token });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("no_org");
    expect((await call(api("/org"), { token: p.token })).json.org).toBeNull();
    expect((await call(api("/orgs"), { token: p.token, body: { name: "First" } })).status).toBe(201);
    expect((await call("/app/where", { token: p.token })).json.role).toBe("owner");
  });
{{/kit.if}}

  it("a new address gets a pending invitation, mailed, and joins on its first request", async () => {
    const owner = await withTeam("Inviter");
    const email = `new-${crypto.randomUUID().slice(0, 8)}@example.test`;
    const inv = await call(api(`/orgs/${owner.org}/invites`), { token: owner.token, body: { email: email.toUpperCase(), role: "admin" } });
    expect(inv.status).toBe(201);
    expect(inv.json.invite).toMatchObject({ email, role: "admin" });
    expect(inv.json.emailed).toBe(true);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe(email);
    expect(mails[0]!.subject).toContain("Inviter's team");
    expect(mails[0]!.subject).toContain("{{kit.brandName}}");
    // the invitee signs up (an account with that address) and makes a request naming the org
    const p = await person("Newbie", email);
    const there = await call("/app/where", { token: p.token, org: owner.org });
    expect(there.json).toEqual({ org: owner.org, role: "admin" });
    const orgs = await call(api("/orgs"), { token: p.token });
    expect(orgs.json.orgs.map((o: { id: string }) => o.id)).toContain(owner.org);
    // the invitation is used up
    const people = await call(api(`/orgs/${owner.org}/people`), { token: owner.token });
    expect(people.json.invites).toEqual([]);
    expect(people.json.members.map((m: { id: string }) => m.id)).toContain(p.id);
  });

  it("inviting an existing account adds them at once; inviting them again is a conflict", async () => {
    const owner = await withTeam("Adder");
    const b = await person("Existing");
    const r = await call(api(`/orgs/${owner.org}/invites`), { token: owner.token, body: { email: b.email } });
    expect(r.status).toBe(201);
    expect(r.json.member).toMatchObject({ id: b.id, role: "member" });
    expect((await call("/app/where", { token: b.token, org: owner.org })).json.role).toBe("member");
    expect((await call(api(`/orgs/${owner.org}/invites`), { token: owner.token, body: { email: b.email } })).status).toBe(409);
  });

  it("a revoked invitation is not accepted", async () => {
    const owner = await withTeam("Revoker");
    const email = `gone-${crypto.randomUUID().slice(0, 8)}@example.test`;
    const inv = await call(api(`/orgs/${owner.org}/invites`), { token: owner.token, body: { email } });
    expect((await call(api(`/orgs/${owner.org}/invites/${inv.json.invite.id}`), { method: "DELETE", token: owner.token })).status).toBe(200);
    expect((await call(api(`/orgs/${owner.org}/invites/${inv.json.invite.id}`), { method: "DELETE", token: owner.token })).status).toBe(404);
    const p = await person("Late", email);
    expect((await call("/app/where", { token: p.token, org: owner.org })).status).toBe(403);
  });

  it("an org invites at most {{kit.invitesPerDay}} people a day", async () => {
    const owner = await withTeam("Busy");
    for (let i = 0; i < {{kit.invitesPerDay}}; i++) {
      expect((await call(api(`/orgs/${owner.org}/invites`), { token: owner.token, body: { email: `p${i}-${owner.id.slice(0, 6)}@example.test` } })).status).toBe(201);
    }
    const over = await call(api(`/orgs/${owner.org}/invites`), { token: owner.token, body: { email: `over-${owner.id.slice(0, 6)}@example.test` } });
    expect(over.status).toBe(429);
    expect(over.json.error.code).toBe("too_many_invites");
  });

  it("refuses a bad email or role", async () => {
    const owner = await withTeam("Strict");
    expect((await call(api(`/orgs/${owner.org}/invites`), { token: owner.token, body: { email: "nope" } })).status).toBe(400);
    expect((await call(api(`/orgs/${owner.org}/invites`), { token: owner.token, body: { email: "a@example.test", role: "god" } })).status).toBe(400);
  });
});

describe("the org header and isolation", () => {
  it("refuses an org you are not in, and hides its existence", async () => {
    const owner = await withTeam("Private");
    const stranger = await person("Stranger");
    const r = await call("/app/where", { token: stranger.token, org: owner.org });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("not_in_org");
    expect((await call(api(`/orgs/${owner.org}/people`), { token: stranger.token })).status).toBe(404);
  });

  it("without a header a request acts in the default org, which the person can change", async () => {
    const owner = await withTeam("Mover");
{{#kit.if personalOrgs}}
    expect((await call("/app/where", { token: owner.token })).json.org).not.toBe(owner.org);
{{/kit.if}}
    expect((await call(api(`/orgs/${owner.org}/default`), { token: owner.token, body: {} })).json.default_org_id).toBe(owner.org);
    expect((await call("/app/where", { token: owner.token })).json.org).toBe(owner.org);
    const stranger = await person("Other");
    expect((await call(api(`/orgs/${owner.org}/default`), { token: stranger.token, body: {} })).status).toBe(404);
  });

  it("needs a bearer token", async () => {
    expect((await call(api("/orgs"))).status).toBe(401);
  });
});

describe("org people and roles", () => {
  it("enforces who may do what", async () => {
    const owner = await withTeam("Boss");
    const admin = await person("Admin");
    const plain = await person("Plain");
    await call(api(`/orgs/${owner.org}/invites`), { token: owner.token, body: { email: admin.email, role: "admin" } });
    await call(api(`/orgs/${owner.org}/invites`), { token: owner.token, body: { email: plain.email } });
    // an admin cannot make owners, a member cannot invite, an admin cannot promote
    expect((await call(api(`/orgs/${owner.org}/invites`), { token: admin.token, body: { email: "x@example.test", role: "owner" } })).status).toBe(403);
    expect((await call(api(`/orgs/${owner.org}/invites`), { token: plain.token, body: { email: "y@example.test" } })).status).toBe(403);
    expect((await call(api(`/orgs/${owner.org}/members/${plain.id}`), { method: "PATCH", token: admin.token, body: { role: "admin" } })).status).toBe(403);
    // an admin invites members and renames the org; members see the people but not the invitations
    expect((await call(api(`/orgs/${owner.org}/invites`), { token: admin.token, body: { email: "z@example.test" } })).status).toBe(201);
    expect((await call(api(`/orgs/${owner.org}`), { method: "PATCH", token: admin.token, body: { name: "Renamed" } })).json.org.name).toBe("Renamed");
    expect((await call(api(`/orgs/${owner.org}`), { method: "PATCH", token: plain.token, body: { name: "Mine now" } })).status).toBe(403);
    const seen = await call(api(`/orgs/${owner.org}/people`), { token: plain.token });
    expect(seen.json.members).toHaveLength(3);
    expect(seen.json.invites).toEqual([]);
    expect((await call(api(`/orgs/${owner.org}/people`), { token: admin.token })).json.invites).toHaveLength(1);
    // an owner promotes; only owners delete the org
    expect((await call(api(`/orgs/${owner.org}/members/${plain.id}`), { method: "PATCH", token: owner.token, body: { role: "admin" } })).json.role).toBe("admin");
    expect((await call(api(`/orgs/${owner.org}`), { method: "DELETE", token: admin.token })).status).toBe(403);
    // the last owner cannot leave or step down; a member (or admin) can leave
    expect((await call(api(`/orgs/${owner.org}/members/${owner.id}`), { method: "DELETE", token: owner.token })).status).toBe(409);
    expect((await call(api(`/orgs/${owner.org}/members/${owner.id}`), { method: "PATCH", token: owner.token, body: { role: "member" } })).status).toBe(409);
    expect((await call(api(`/orgs/${owner.org}/members/${plain.id}`), { method: "DELETE", token: plain.token })).status).toBe(200);
    expect((await call("/app/where", { token: plain.token, org: owner.org })).status).toBe(403);
    // an owner removes an admin
    expect((await call(api(`/orgs/${owner.org}/members/${admin.id}`), { method: "DELETE", token: owner.token })).status).toBe(200);
  });

  it("a team org that still holds app data is not deleted; an empty one is", async () => {
    const owner = await withTeam("Holder");
    await testEnv.DB.prepare("CREATE TABLE IF NOT EXISTS test_org_data (id TEXT, org_id TEXT)").run();
    await testEnv.DB.prepare("INSERT INTO test_org_data (id, org_id) VALUES ('x', ?)").bind(owner.org).run();
    ORG_DATA_TABLES.push("test_org_data");
    try {
      const held = await call(api(`/orgs/${owner.org}`), { method: "DELETE", token: owner.token });
      expect(held.status).toBe(409);
      expect(held.json.error.message).toContain("test_org_data");
      const empty = await call(api("/orgs"), { token: owner.token, body: { name: "Empty" } });
      expect((await call(api(`/orgs/${empty.json.org.id}`), { method: "DELETE", token: owner.token })).status).toBe(200);
      expect((await call(api("/orgs"), { token: owner.token })).json.orgs.map((o: { id: string }) => o.id)).not.toContain(empty.json.org.id);
    } finally {
      ORG_DATA_TABLES.pop();
    }
  });

  it("org names are checked and a person creates at most {{kit.maxTeamOrgs}} team orgs", async () => {
    const p = await person("Maker");
    expect((await call(api("/orgs"), { token: p.token, body: { name: "  " } })).status).toBe(400);
    expect((await call(api("/orgs"), { token: p.token, body: "nope" })).status).toBe(400);
    for (let i = 0; i < {{kit.maxTeamOrgs}}; i++) expect((await call(api("/orgs"), { token: p.token, body: { name: `Team ${i}` } })).status).toBe(201);
    expect((await call(api("/orgs"), { token: p.token, body: { name: "One more" } })).status).toBe(429);
  });
});
