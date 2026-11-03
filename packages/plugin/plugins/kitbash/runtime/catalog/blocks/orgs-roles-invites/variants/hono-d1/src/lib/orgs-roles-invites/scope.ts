// SCOPE. Every authenticated request acts in exactly one org. requireOrg (middleware.ts) resolves it and puts a copy
// of env with ORG_ID set on the context (inOrg); services read it with orgOf(env), which throws when it is missing, so
// code that forgot to scope fails loudly instead of reading another org's rows. Background code (cron, queues)
// runs per record and scopes with the record's own org_id: inOrg(env, row.org_id).
import type { OrgRole, OrgsEnv } from "./types";

/** The org this env is scoped to. Throws when unscoped: a background path must scope with the record's org first. */
export function orgOf(env: OrgsEnv): string {
  if (!env.ORG_ID) throw new Error("no org in scope: wrap env with inOrg(env, orgId) before calling an org-scoped service");
  return env.ORG_ID;
}

/** A copy of env scoped to one org (cheap: bindings are shared). */
export function inOrg<E extends OrgsEnv>(env: E, orgId: string): E {
  if (env.ORG_ID === orgId) return env;
  return { ...env, ORG_ID: orgId };
}

/**
 * Tables of your app that carry org_id. deleteOrg refuses while any of them still has rows for the org (move or
 * delete them first). Add yours here, e.g. ["projects", "notes"].
 */
export const ORG_DATA_TABLES: string[] = [];

/** An R2 or KV key in the scoped org: orgs/<id>/<key>.{{#kit.if legacyOrgId}} The legacy org keeps its unprefixed keys.{{/kit.if}} */
export function orgKey(env: OrgsEnv, key: string): string {
  const org = orgOf(env);
{{#kit.if legacyOrgId}}
  if (org === LEGACY_ORG_ID) return key;
{{/kit.if}}
  return `orgs/${org}/${key}`;
}

/** The Durable Object name for an org's instance (idFromName).{{#kit.if legacyOrgId}} The legacy org keeps "default".{{/kit.if}} */
export function doName(orgId: string): string {
{{#kit.if legacyOrgId}}
  if (orgId === LEGACY_ORG_ID) return "default";
{{/kit.if}}
  return orgId;
}
{{#kit.if legacyOrgId}}

/** The org that holds the data from before orgs existed (param legacyOrgId): it keeps unprefixed keys and the "default" DO. */
export const LEGACY_ORG_ID = "{{kit.legacyOrgId}}";
{{/kit.if}}

/** How roles compare: owner > admin > member. */
export const ROLE_RANK: Record<OrgRole, number> = { member: 0, admin: 1, owner: 2 };
{{#kit.if productRoles}}

/** The app's two-level role in an org: owner and admin have the owner powers there, a member does not (param productRoles). */
export const productRole = (role: OrgRole): "owner" | "member" => (role === "member" ? "member" : "owner");
{{/kit.if}}
