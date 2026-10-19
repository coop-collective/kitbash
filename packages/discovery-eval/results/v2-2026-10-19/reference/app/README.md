# Kitchen Sink

Hono + TypeScript Cloudflare Worker with D1 (sessions, profiles), private R2 (uploads), Cache API + optional KV (report cache), and a static UI in `public/`.

## Run

```
pnpm install
pnpm db:local     # apply migrations to the local D1
pnpm dev          # http://localhost:8787
pnpm typecheck
pnpm test         # vitest in workerd with real local D1/R2/KV
pnpm build        # wrangler dry-run bundle
```

Demo login (only when `ENVIRONMENT=dev`): `alice@example.test` or `bob@example.test`, password `local-demo-password`.

## Design notes

- Sessions: random id, SHA-256 digest stored in D1 (`browser_sessions`), cookie is `id.HMAC` (`HttpOnly; SameSite=Lax`; `__Host-session` + `Secure` on HTTPS, `dev_session` on loopback HTTP). Logout revokes the row, so replayed cookies get 401. `SESSION_SECRET` comes from `.dev.vars`; a public fixture is used as fallback in dev only.
- Every unsafe `/api/*` request must carry an `Origin` equal to the request origin, otherwise 403.
- Profiles: owner comes from the session only; `PUT` uses optimistic concurrency (`revision`), stale or handle-conflicting writes return 409.
- Uploads: body is read in bounded chunks (1 MiB max, 413 otherwise); R2 key = `private-uploads/sha256(owner)/uuid`, so other owners get 404 and cannot delete the real owner's bytes.
- Report: the current revision is read from D1 first; cache key = tenant + `revision.nonce`, stored in Cache API and KV. `cacheTier` is `origin`, `edge`, or `kv`.

Adapted from catalog blocks `session-cookie`, `r2-private-uploads`, and `tiered-result-cache` (see `src/session.ts`, `src/uploads.ts`, `src/result-cache.ts`).
