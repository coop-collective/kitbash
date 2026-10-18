## 1.0.0

- First release, ported from JavaScript to TypeScript from mailcheap `lib/rate-limit.js` (MIT, Marc Lou).
- The table is plain `CREATE TABLE` with an optional `tablePrefix`; the in-memory fallback is dropped (workerd has no need of it).
- Added the Hono `rateLimit` middleware (429 + Retry-After), `purgeExpired`, and the policy "production fails closed, other environments throw".
