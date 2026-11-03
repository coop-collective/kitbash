# Changelog

## 2.0.0

Source payloads mirror installation paths.

### Upgrade

Use `src/lib/orgs-roles-invites/` and the declared route paths; update imports and catalog checkouts. HTTP URLs and database migrations are unchanged.

## 1.0.1

- `e2e.json` is no longer declared in `files[]` (it was copied into projects as a doc/fixture); core allows it undeclared and the e2e harness reads it from the block directory.
- Integrated with the real email-code-auth instead of core's fixture: the tests make people with its
  `upsertMember` (its `members.created_at` is NOT NULL). Invites already match on the lowercased address, and an
  account's address is the one its sign-in code was verified for (email-code-auth stores it normalized).

## 1.0.0

Harvested from Ideator's `src/orgs.ts`, migration 0033 and the `/api/orgs` routes. `org_default` special cases are
behind `legacyOrgId`, `productRole` behind `productRoles`; the default org lives in `org_defaults`; product records
(projects, tasks, agents) are left out.
