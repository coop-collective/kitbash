# Changelog

## 2.0.0

Source payloads mirror installation paths.

### Upgrade

Use `src/lib/cli-oauth-login/` and the declared route paths; update imports and catalog checkouts. HTTP URLs and database migrations are unchanged.

## 1.1.1

- Reject foreign, missing and opaque Origin on browser sign-in POSTs before credentials, email-code effects or session creation.
- Use Referrer-Policy: same-origin so native form POSTs keep a verifiable Origin without leaking authorization URLs cross-origin.
- Add traveling regressions for all sign-in methods, untouched valid codes and the form header policy; retain the full PKCE/refresh/revoke flow.

## 1.1.0

- Integrated with the real email-code-auth (>= 1.1) instead of core's fixture: email-code sign-in on the authorize page
  uses `consumeCode`, so no unseen bearer token is minted; the tests make people with the auth block's `upsertMember`
  (its `members.created_at` is NOT NULL).
- `e2e.json` is no longer declared in `files[]` (it was copied into projects as a doc/fixture); core allows it undeclared and the e2e harness reads it from the block directory.

## 1.0.0

Harvested from Ideator's `src/oauth.ts` and `src/cli-logins.ts` (provider-lib approach). CLI sign-in only; consent
pages moved to `templates/*.html` with brand params; `remoteClients` param; the auth block is reached only through
`lib/oauth/identity.ts`.
