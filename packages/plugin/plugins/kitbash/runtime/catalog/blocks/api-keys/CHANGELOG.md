# Changelog

## 2.0.0

Source payloads mirror installation paths.

### Upgrade

Use `src/lib/api-keys/` and the declared route paths; update imports and catalog checkouts. HTTP URLs and database migrations are unchanged.

## 1.0.1

- `e2e.json` is no longer declared in `files[]` (it was copied into projects as a doc/fixture); core allows it undeclared and the e2e harness reads it from the block directory.

## 1.0.0

- First release, harvested from inference-market `packages/web/src/keys.ts` and `auth/crypto.ts`.
- Removed the account, buyback, Elite-tier and OAuth coupling: keys belong to an opaque `owner_id`; scopes are optional labels (`hasScope`).
- The KV cache is optional: without a `KEY_CACHE` binding (or when KV errors) every call reads D1. Tested both ways.
- The Durable Object revoked set is not included; revoke busts the KV entry and other colos catch up within `cacheTtlS`.
