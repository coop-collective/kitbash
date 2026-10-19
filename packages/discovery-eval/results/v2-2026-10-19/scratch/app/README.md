# Kitchen Sink

Hono + TypeScript Worker with D1 (sessions, profiles, upload metadata), private R2 (`UPLOADS`) and KV + Cache API (`RESULT_CACHE`) for a revision-keyed report.

```
pnpm install
pnpm db:local   # apply migrations to local D1
pnpm dev        # http://localhost:8787 (demo login: alice@example.test / bob@example.test, password local-demo-password)
pnpm typecheck
pnpm test
pnpm build
```

Notes: demo login works only when `ENVIRONMENT=dev`. Sessions are stored in D1 and referenced by an HMAC-signed HttpOnly cookie. Unsafe API methods require an `Origin` header exactly matching the request origin. Report cache keys are `tenant + profile revision`, so a profile update immediately bypasses old entries.
