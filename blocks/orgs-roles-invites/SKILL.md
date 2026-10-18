---
name: orgs-roles-invites
description: Use when a Hono + D1 app needs workspaces shared by several people, with owner/admin/member roles, email invitations and every request scoped to one org.
license: MIT
metadata:
  kitbash: "@coop/orgs-roles-invites@1.0.1"
---

# orgs-roles-invites

## What it adds

- A personal workspace per account (made on its first request; never deleted or shared) and team orgs anyone creates.
- Roles per org: owner (everything, incl. deleting the org and changing owners/admins), admin (rename, invite, remove
  members), member. An org always keeps one owner.
- Invitations by email: an existing account joins at once; a new address gets a pending invite, accepted on its first
  request after sign-up. At most `invitesPerDay` per org per day. Mailed through the `EMAIL` binding when bound.
- Scoping: `requireOrg` resolves the org (header `orgHeader`, else the person's default) and replaces `c.env` with a
  copy where `orgOf(c.env)` returns the org id. `orgOf` throws when a service was called unscoped.

## Interface

- Tables: `orgs`, `org_members`, `org_invites`, `org_defaults` (prefix `tablePrefix`; FKs to email-code-auth's
  `<authTablePrefix>members`).
- Routes under `routePrefix` (default `/api`): `GET /org`, `GET|POST /orgs`, `PATCH|DELETE /orgs/:id`,
  `POST /orgs/:id/default`, `GET /orgs/:id/people`, `POST /orgs/:id/invites`, `DELETE /orgs/:id/invites/:inviteId`,
  `PATCH|DELETE /orgs/:id/members/:memberId`. Errors are `{ error: { code, message } }`.
- Exports: `requireOrg`, `optionalOrg`, `orgOf`, `inOrg`, `orgKey`, `doName`, `ORG_DATA_TABLES`, `onSignIn`, `roleIn`, `orgRoutes`.
- Needs: `@coop/email-code-auth` first (`requireBearer` setting `c.get("member")`, `issueToken` in tests, its members
  table); D1 `DB`; optional `EMAIL` + `MAIL_FROM`.
- Params: `authTablePrefix` must equal email-code-auth's `tablePrefix`.

## Install

Install email-code-auth first. No config patches. Set `legacyOrgId` only when retrofitting orgs onto existing data
(that org keeps unprefixed keys and the "default" Durable Object); `productRoles` exports `productRole()`.

## Adapt

1. `app.route("/api", orgRoutes)` in `src/index.ts`.
2. Your own routes: `app.use("/things/*", requireBearer, requireOrg)`; add `org_id` to your tables; services filter
   by `orgOf(c.env)`. Background jobs: `inOrg(env, row.org_id)`.
3. Optional: list your org-owned tables in `ORG_DATA_TABLES` (deleting an org that holds rows answers 409).
4. Optional: call `onSignIn(env, member)` right after sign-in (requireOrg does it on the first request anyway).

## Verify

`npx vitest run test/orgs.test.ts` and `npx tsc --noEmit`.

## Known limits

- Three fixed roles; no per-action permission table or per-record ACLs.
- Moving records between orgs is app-specific and not included.
- Invites are matched by email address; the auth block must only create members with verified addresses.
