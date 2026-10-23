# Changelog

## 2.0.0

Source payloads mirror installation paths.

### Upgrade

Use `src/lib/d1-rate-limit/` and the declared route paths; update imports and catalog checkouts. HTTP URLs and database migrations are unchanged.

## 1.0.1

- `e2e.json` is no longer declared in `files[]` (it was copied into projects as a doc/fixture); core allows it undeclared and the e2e harness reads it from the block directory.

## 1.0.0

- First release, ported from JavaScript to TypeScript from mailcheap `lib/rate-limit.js` (MIT, Marc Lou).
- The table is plain `CREATE TABLE` with an optional `tablePrefix`; the in-memory fallback is dropped (workerd has no need of it).
- Added the Hono `rateLimit` middleware (429 + Retry-After), `purgeExpired`, and the policy "production fails closed, other environments throw".
