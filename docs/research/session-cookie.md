# Browser session extraction (2026-10-19)

Golden source: `/Users/coop/Workspace/inference-market` at `9231c25a2b7cbf9a04c428fe44324efaec3344f4`, `packages/web/src/auth/session.ts` and `packages/web/src/auth/crypto.ts`. It combines domain-separated HMAC cookies, a revocable D1 row and absolute expiry. Its billing/read-cache bump and account joins belong to that app and were removed.

Alternate: `/Users/coop/Workspace/mailcheap` at `6fd333e2b9a66d65785958de40061afa72fa6059`, `lib/session-token.js` and `tests/session-token.test.mjs`. Its production __Host- cookie and separate development name are useful. Its admin-credential JWT version is single-admin specific and does not provide this block's per-session revocation.

Changes beyond extraction: SHA-256 session identifiers at rest, Web Crypto verification, duplicate-cookie rejection, strict Origin protection for mutation routes, bounded expiry cleanup, and explicit host-owned account lifecycle hooks. The block intentionally omits cross-request auth memoization and KV caching so revocation semantics are clear.

Anti-patterns to avoid: weakening a __Host- cookie by removing Secure; issuing a cookie from an unverified body owner id; treating SameSite=Lax alone as complete login/mutation CSRF protection; returning session responses through public caches; leaving sessions active after account disable.

References checked: [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) for prefix restrictions; [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/) for binding and result semantics. Source links: [session](https://github.com/Disturbing/inference-market/blob/9231c25a2b7cbf9a04c428fe44324efaec3344f4/packages/web/src/auth/session.ts).

Verification: `KIT_E2E_ONLY=session-cookie node --test test-e2e/install.test.mjs` installs default and alternate configurations into fresh hono-d1 templates, applies real SQL migrations, runs traveling workerd tests and TypeScript checking through kit verify, checks lock records, and refuses a conflicting repeat install. Browser enforcement of cookie flags is not simulated by workerd; the generated headers and backend policy are tested. The feature remains experimental until host-app browser e2e and account lifecycle wiring are complete.
