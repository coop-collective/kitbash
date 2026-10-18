// Scopes are orgs (DESIGN §4.1). Writes need membership; reads of private blocks need membership, and a private
// block of another org is reported as not found so its existence does not leak.
import { ApiError, type Bindings, type Caller, type OrgRef } from "./types";
import { scopeSlug, SLUG_RE } from "./util";

export interface OrgRow {
  id: string;
  slug: string;
  name: string;
  plan: string;
}

export async function orgBySlug(env: Bindings, scope: string): Promise<OrgRow | null> {
  const slug = scopeSlug(scope);
  if (!SLUG_RE.test(slug)) throw new ApiError("invalid_params", `bad scope ${JSON.stringify(scope)}`, { rule: "scope" });
  return env.DB.prepare("SELECT id, slug, name, plan FROM orgs WHERE slug = ?").bind(slug).first<OrgRow>();
}

export function membership(caller: Caller, orgId: string): OrgRef | undefined {
  return caller.orgs.find((o) => o.id === orgId);
}

/** The org named by `scope` (or the caller's default), which the caller must belong to. */
export async function requireOrgMember(env: Bindings, caller: Caller, scope: string | undefined | null): Promise<OrgRef> {
  if (!scope) {
    if (!caller.defaultOrg) throw new ApiError("forbidden", "you belong to no org; pass a scope");
    return caller.defaultOrg;
  }
  const org = await orgBySlug(env, scope);
  if (!org) throw new ApiError("not_found", `no scope @${scopeSlug(scope)}`);
  const m = membership(caller, org.id);
  if (!m) throw new ApiError("forbidden", `you are not a member of @${org.slug}`);
  return m;
}

export function whoami(caller: Caller) {
  return {
    member: caller.member.id,
    orgs: caller.orgs.map((o) => `@${o.slug}`),
    scope_default: caller.defaultOrg ? `@${caller.defaultOrg.slug}` : "",
    plan: caller.defaultOrg?.plan ?? "free",
  };
}
