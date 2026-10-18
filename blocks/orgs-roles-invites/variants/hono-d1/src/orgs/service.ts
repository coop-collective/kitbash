// Orgs, their people and roles, invitations. Ported from Ideator's src/orgs.ts without its product records.
//
// ROLES. owner | admin | member, per org. Admins rename the org, invite people and remove members; only owners change
// who is an owner or admin, and delete the org. An org always keeps at least one owner.
// PERSONAL. Every account gets one personal workspace on its first request (param personalOrgs): never deleted, never
// shared. INVITES. An existing account joins at once; any other address gets a pending invitation, accepted the first
// time that address signs in. An org invites at most {{kit.invitesPerDay}} people a day (each one can send a mail from your domain).
import { ORG_DATA_TABLES, ROLE_RANK } from "./scope";
import { ORG_ROLES, OrgError, type OrgRef, type OrgRole, type OrgsEnv, type Person } from "./types";

const INVITES_PER_DAY = {{kit.invitesPerDay}};
const MAX_TEAM_ORGS = {{kit.maxTeamOrgs}};
const PERSONAL_ORGS = {{#kit.if personalOrgs}}true{{kit.else}}false{{/kit.if}};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 86_400_000;

type OrgRow = { id: string; name: string; kind: "personal" | "team"; personal_of: string | null; created_at: number };

const now = () => Date.now();
function newId(prefix: string): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}_${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}
const notFound = (what: string, id: string) => new OrgError(404, "not_found", `${what} ${id} not found`);
const forbidden = (message: string) => new OrgError(403, "forbidden", message);
const badRequest = (message: string) => new OrgError(400, "bad_request", message);
const conflict = (message: string) => new OrgError(409, "conflict", message);
const displayName = (p: Pick<Person, "name" | "email">) => (p.name?.trim() || p.email.split("@")[0] || "Personal").slice(0, 60);

const orgOut = (o: OrgRow & { role?: OrgRole; members?: number }) => ({
  id: o.id,
  name: o.name,
  kind: o.kind,
  personal: o.kind === "personal",
  role: o.role ?? null,
  members: o.members ?? null,
  created_at: o.created_at,
});

/** Every org a person belongs to, with their role; their personal workspace first. */
export async function membershipsOf(env: OrgsEnv, memberId: string): Promise<OrgRef[]> {
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.name, o.kind, m.role FROM {{kit.tablePrefix}}org_members m JOIN {{kit.tablePrefix}}orgs o ON o.id = m.org_id WHERE m.member_id = ?
     ORDER BY o.kind = 'personal' DESC, o.created_at`,
  )
    .bind(memberId)
    .all<OrgRef>();
  return results;
}

/** The person's role in one org, or null when they are not in it. */
export async function roleIn(env: OrgsEnv, orgId: string, memberId: string): Promise<OrgRole | null> {
  const r = await env.DB.prepare("SELECT role FROM {{kit.tablePrefix}}org_members WHERE org_id = ? AND member_id = ?").bind(orgId, memberId).first<{ role: OrgRole }>();
  return r?.role ?? null;
}

/** Their personal workspace, made on first need. Safe when two first requests race (unique index on personal_of). */
export async function ensurePersonalOrg(env: OrgsEnv, person: Pick<Person, "id" | "name" | "email">): Promise<OrgRef> {
  const find = () =>
    env.DB.prepare(
      "SELECT o.id, o.name, o.kind, m.role FROM {{kit.tablePrefix}}orgs o JOIN {{kit.tablePrefix}}org_members m ON m.org_id = o.id AND m.member_id = ? WHERE o.personal_of = ?",
    )
      .bind(person.id, person.id)
      .first<OrgRef>();
  const found = await find();
  if (found) return found;
  const t = now();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO {{kit.tablePrefix}}orgs (id, name, kind, personal_of, created_by, created_at, updated_at) VALUES (?, ?, 'personal', ?, ?, ?, ?)").bind(
      newId("org"),
      displayName(person),
      person.id,
      person.id,
      t,
      t,
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO {{kit.tablePrefix}}org_members (org_id, member_id, role, created_at) SELECT id, ?, 'owner', ? FROM {{kit.tablePrefix}}orgs WHERE personal_of = ?",
    ).bind(person.id, t, person.id),
    env.DB.prepare("INSERT OR IGNORE INTO {{kit.tablePrefix}}org_defaults (member_id, org_id) SELECT ?, id FROM {{kit.tablePrefix}}orgs WHERE personal_of = ?").bind(person.id, person.id),
  ]);
  const made = await find();
  if (!made) throw new Error("personal workspace was not created");
  return made;
}

/** Turn every open invitation for this (verified) email into a membership. Returns the org ids joined. */
export async function acceptInvites(env: OrgsEnv, person: Pick<Person, "id" | "email">): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, org_id, role, invited_by FROM {{kit.tablePrefix}}org_invites WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL",
  )
    .bind(person.email.toLowerCase())
    .all<{ id: string; org_id: string; role: OrgRole; invited_by: string }>();
  const t = now();
  for (const inv of results) {
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO {{kit.tablePrefix}}org_members (org_id, member_id, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?)").bind(
        inv.org_id,
        person.id,
        inv.role,
        inv.invited_by,
        t,
      ),
      env.DB.prepare("UPDATE {{kit.tablePrefix}}org_invites SET accepted_at = ?, accepted_by = ? WHERE id = ?").bind(t, person.id, inv.id),
    ]);
  }
  return results.map((r) => r.org_id);
}

/**
 * Call after a sign-in (the code proves the address): the personal workspace (personalOrgs) and open invitations.
 * requireOrg also does this on a person's first request, so wiring it into sign-in is optional.
 */
export async function onSignIn(env: OrgsEnv, person: Pick<Person, "id" | "name" | "email">): Promise<string[]> {
  if (PERSONAL_ORGS) await ensurePersonalOrg(env, person);
  return acceptInvites(env, person);
}

/**
 * The org a request acts in: the one it names (the org header) if the person is in it, else their default org, else
 * their first org. Naming an org they are not in is a 403, never a silent fallback. null = the person has no org
 * (only possible with personalOrgs off).
 */
export async function resolveOrg(env: OrgsEnv, person: Pick<Person, "id" | "name" | "email">, requested: string | null): Promise<OrgRef | null> {
  if (requested) {
    const named = () =>
      env.DB.prepare(
        "SELECT o.id, o.name, o.kind, m.role FROM {{kit.tablePrefix}}org_members m JOIN {{kit.tablePrefix}}orgs o ON o.id = m.org_id WHERE m.org_id = ? AND m.member_id = ?",
      )
        .bind(requested, person.id)
        .first<OrgRef>();
    // a new account's first request may name the org that invited it
    const r = (await named()) ?? ((await acceptInvites(env, person)).includes(requested) ? await named() : null);
    if (!r) throw new OrgError(403, "not_in_org", `You are not a member of org ${requested}.`);
    return r;
  }
  const byDefault = () =>
    env.DB.prepare(
      `SELECT o.id, o.name, o.kind, m.role FROM {{kit.tablePrefix}}org_defaults x JOIN {{kit.tablePrefix}}org_members m ON m.org_id = x.org_id AND m.member_id = x.member_id
       JOIN {{kit.tablePrefix}}orgs o ON o.id = m.org_id WHERE x.member_id = ?`,
    )
      .bind(person.id)
      .first<OrgRef>();
  const d = await byDefault();
  if (d) return d;
  // no default yet: a new account's first request. Its personal workspace (which becomes the default) and the
  // invitations waiting for its address.
  await onSignIn(env, person);
  return (await byDefault()) ?? (await membershipsOf(env, person.id))[0] ?? null;
}

// ------------------------------------------------------------------ orgs and people (REST)

export async function listOrgs(env: OrgsEnv, person: Person, current: string | null) {
  const { results } = await env.DB.prepare(
    `SELECT o.*, m.role, (SELECT COUNT(*) FROM {{kit.tablePrefix}}org_members x WHERE x.org_id = o.id) AS members
     FROM {{kit.tablePrefix}}org_members m JOIN {{kit.tablePrefix}}orgs o ON o.id = m.org_id WHERE m.member_id = ? ORDER BY o.kind = 'personal' DESC, o.created_at`,
  )
    .bind(person.id)
    .all<OrgRow & { role: OrgRole; members: number }>();
  const def = await env.DB.prepare("SELECT org_id FROM {{kit.tablePrefix}}org_defaults WHERE member_id = ?").bind(person.id).first<{ org_id: string }>();
  return { orgs: results.map(orgOut), default_org_id: def?.org_id ?? null, current_org_id: current };
}

const cleanName = (name: unknown) => {
  const n = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!n || n.length > 60) throw badRequest("an org name is 1-60 characters");
  return n;
};

/** A new team org, with the creator as its owner. */
export async function createOrg(env: OrgsEnv, person: Person, input: { name?: unknown }) {
  const name = cleanName(input.name);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM {{kit.tablePrefix}}orgs WHERE created_by = ? AND kind = 'team'").bind(person.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_TEAM_ORGS) throw new OrgError(429, "too_many_orgs", `You have created ${MAX_TEAM_ORGS} orgs; delete one first.`);
  const id = newId("org");
  const t = now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO {{kit.tablePrefix}}orgs (id, name, kind, personal_of, created_by, created_at, updated_at) VALUES (?, ?, 'team', NULL, ?, ?, ?)").bind(id, name, person.id, t, t),
    env.DB.prepare("INSERT INTO {{kit.tablePrefix}}org_members (org_id, member_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(id, person.id, t),
  ]);
  return { org: orgOut({ id, name, kind: "team", personal_of: null, created_at: t, role: "owner", members: 1 }) };
}

/** The org and the caller's role in it, if that role is at least `min`. Not a member: 404 (the org's existence is not shown). */
export async function requireRole(env: OrgsEnv, person: Person, orgId: string, min: OrgRole): Promise<OrgRow & { role: OrgRole }> {
  const o = await env.DB.prepare(
    "SELECT o.*, m.role FROM {{kit.tablePrefix}}orgs o JOIN {{kit.tablePrefix}}org_members m ON m.org_id = o.id AND m.member_id = ? WHERE o.id = ?",
  )
    .bind(person.id, orgId)
    .first<OrgRow & { role: OrgRole }>();
  if (!o) throw notFound("org", orgId);
  if (ROLE_RANK[o.role] < ROLE_RANK[min]) throw forbidden(`only an org ${min === "admin" ? "owner or admin" : "owner"} can do that`);
  return o;
}

export async function updateOrg(env: OrgsEnv, person: Person, orgId: string, input: { name?: unknown }) {
  const o = await requireRole(env, person, orgId, "admin");
  const name = input.name === undefined ? o.name : cleanName(input.name);
  await env.DB.prepare("UPDATE {{kit.tablePrefix}}orgs SET name = ?, updated_at = ? WHERE id = ?").bind(name, now(), orgId).run();
  return { org: orgOut({ ...o, name }) };
}

/** Where the person lands when a request names no org. */
export async function setDefaultOrg(env: OrgsEnv, person: Person, orgId: string) {
  if (!(await roleIn(env, orgId, person.id))) throw notFound("org", orgId);
  await env.DB.prepare(
    "INSERT INTO {{kit.tablePrefix}}org_defaults (member_id, org_id) VALUES (?, ?) ON CONFLICT (member_id) DO UPDATE SET org_id = excluded.org_id",
  )
    .bind(person.id, orgId)
    .run();
  return { default_org_id: orgId };
}

/** Delete a team org: only when none of ORG_DATA_TABLES holds rows for it any more. */
export async function deleteOrg(env: OrgsEnv, person: Person, orgId: string) {
  const o = await requireRole(env, person, orgId, "owner");
  if (o.kind === "personal") throw forbidden("a personal workspace cannot be deleted");
  for (const table of ORG_DATA_TABLES) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error(`bad table name in ORG_DATA_TABLES: ${table}`);
    const held = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE org_id = ?`).bind(orgId).first<{ n: number }>();
    if (held?.n) throw conflict(`this org still holds ${held.n} rows in ${table}; move or delete them first`);
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM {{kit.tablePrefix}}org_defaults WHERE org_id = ?").bind(orgId),
    env.DB.prepare("DELETE FROM {{kit.tablePrefix}}org_invites WHERE org_id = ?").bind(orgId),
    env.DB.prepare("DELETE FROM {{kit.tablePrefix}}org_members WHERE org_id = ?").bind(orgId),
    env.DB.prepare("DELETE FROM {{kit.tablePrefix}}orgs WHERE id = ?").bind(orgId),
  ]);
  return { deleted: orgId };
}

/** The org's people; owners and admins also see the open invitations. */
export async function orgPeople(env: OrgsEnv, person: Person, orgId: string) {
  const o = await requireRole(env, person, orgId, "member");
  const [members, invites] = await Promise.all([
    env.DB.prepare(
      `SELECT x.id, x.name, x.email, m.role, m.created_at AS joined_at FROM {{kit.tablePrefix}}org_members m JOIN {{kit.authTablePrefix}}members x ON x.id = m.member_id
       WHERE m.org_id = ? ORDER BY m.role = 'owner' DESC, m.role = 'admin' DESC, x.name`,
    )
      .bind(orgId)
      .all(),
    o.role === "member"
      ? Promise.resolve({ results: [] })
      : env.DB.prepare(
          "SELECT id, email, role, created_at FROM {{kit.tablePrefix}}org_invites WHERE org_id = ? AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC",
        )
          .bind(orgId)
          .all(),
  ]);
  return { org: orgOut(o), members: members.results, invites: invites.results };
}

/**
 * Invite someone by email. An existing account joins at once; anyone else gets a pending invitation, accepted the
 * first time they sign in with that address. Either way `notify` is called (a failed mail never fails the invite).
 */
export async function inviteToOrg(
  env: OrgsEnv,
  person: Person,
  orgId: string,
  input: { email?: unknown; role?: unknown },
  notify?: (to: string, orgName: string) => Promise<void>,
) {
  const o = await requireRole(env, person, orgId, "admin");
  if (o.kind === "personal") throw forbidden("a personal workspace is yours alone; create an org to work with others");
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw badRequest("a valid email is required");
  const role = (input.role ?? "member") as OrgRole;
  if (!(ORG_ROLES as readonly string[]).includes(role)) throw badRequest(`role must be one of ${ORG_ROLES.join(", ")}`);
  if (role === "owner" && o.role !== "owner") throw forbidden("only an owner can make someone an owner");
  const t = now();
  // every invite can send an email from our domain: an org adds at most INVITES_PER_DAY people a day
  const recent = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM {{kit.tablePrefix}}org_invites WHERE org_id = ?1 AND created_at > ?2)
          + (SELECT COUNT(*) FROM {{kit.tablePrefix}}org_members WHERE org_id = ?1 AND invited_by IS NOT NULL AND created_at > ?2) AS n`,
  )
    .bind(orgId, t - DAY_MS)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= INVITES_PER_DAY) throw new OrgError(429, "too_many_invites", `An org can invite ${INVITES_PER_DAY} people a day; try again tomorrow.`);
  const existing = await env.DB.prepare("SELECT id, name, email FROM {{kit.authTablePrefix}}members WHERE email = ?").bind(email).first<Person>();
  let result: { member?: { id: string; name: string | null; role: OrgRole }; invite?: { id: string; email: string; role: OrgRole } };
  if (existing) {
    if (await roleIn(env, orgId, existing.id)) throw conflict(`${email} is already in ${o.name}`);
    await env.DB.prepare("INSERT INTO {{kit.tablePrefix}}org_members (org_id, member_id, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(orgId, existing.id, role, person.id, t)
      .run();
    result = { member: { id: existing.id, name: existing.name, role } };
  } else {
    const open = await env.DB.prepare("SELECT id FROM {{kit.tablePrefix}}org_invites WHERE org_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL")
      .bind(orgId, email)
      .first<{ id: string }>();
    const id = open?.id ?? newId("inv");
    if (open) await env.DB.prepare("UPDATE {{kit.tablePrefix}}org_invites SET role = ?, invited_by = ?, created_at = ? WHERE id = ?").bind(role, person.id, t, id).run();
    else
      await env.DB.prepare("INSERT INTO {{kit.tablePrefix}}org_invites (id, org_id, email, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, orgId, email, role, person.id, t)
        .run();
    result = { invite: { id, email, role } };
  }
  if (notify) {
    try {
      await notify(email, o.name);
    } catch (e) {
      console.warn(JSON.stringify({ msg: "invite email failed", org: orgId, error: String(e) }));
    }
  }
  return result;
}

export async function revokeInvite(env: OrgsEnv, person: Person, orgId: string, inviteId: string) {
  await requireRole(env, person, orgId, "admin");
  const r = await env.DB.prepare(
    "UPDATE {{kit.tablePrefix}}org_invites SET revoked_at = ? WHERE id = ? AND org_id = ? AND accepted_at IS NULL AND revoked_at IS NULL",
  )
    .bind(now(), inviteId, orgId)
    .run();
  if (!r.meta.changes) throw notFound("invite", inviteId);
  return { revoked: inviteId };
}

async function owners(env: OrgsEnv, orgId: string): Promise<number> {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM {{kit.tablePrefix}}org_members WHERE org_id = ? AND role = 'owner'").bind(orgId).first<{ n: number }>())?.n ?? 0;
}

export async function setMemberRole(env: OrgsEnv, person: Person, orgId: string, memberId: string, roleIn_: unknown) {
  const o = await requireRole(env, person, orgId, "admin");
  if (o.kind === "personal") throw forbidden("a personal workspace has one owner");
  const role = roleIn_ as OrgRole;
  if (!(ORG_ROLES as readonly string[]).includes(role)) throw badRequest(`role must be one of ${ORG_ROLES.join(", ")}`);
  const current = await roleIn(env, orgId, memberId);
  if (!current) throw notFound("member", memberId);
  // admins manage members; only owners make or unmake owners and admins
  if ((current !== "member" || role !== "member") && o.role !== "owner") throw forbidden("only an org owner changes who is an owner or admin");
  if (current === "owner" && role !== "owner" && (await owners(env, orgId)) <= 1) throw conflict("an org needs at least one owner; make someone else an owner first");
  await env.DB.prepare("UPDATE {{kit.tablePrefix}}org_members SET role = ? WHERE org_id = ? AND member_id = ?").bind(role, orgId, memberId).run();
  return { member_id: memberId, role };
}

/** Remove someone (an admin removes members, an owner anyone), or leave (memberId = yourself). */
export async function removeFromOrg(env: OrgsEnv, person: Person, orgId: string, memberId: string) {
  const self = memberId === person.id;
  const o = await requireRole(env, person, orgId, self ? "member" : "admin");
  if (o.kind === "personal") throw forbidden("you cannot leave your personal workspace");
  const current = await roleIn(env, orgId, memberId);
  if (!current) throw notFound("member", memberId);
  if (!self && current !== "member" && o.role !== "owner") throw forbidden("only an org owner removes an owner or admin");
  if (current === "owner" && (await owners(env, orgId)) <= 1) throw conflict("an org needs at least one owner; make someone else an owner first");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM {{kit.tablePrefix}}org_members WHERE org_id = ? AND member_id = ?").bind(orgId, memberId),
    env.DB.prepare("DELETE FROM {{kit.tablePrefix}}org_defaults WHERE member_id = ? AND org_id = ?").bind(memberId, orgId),
  ]);
  return { removed: memberId };
}
