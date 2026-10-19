# Kitchen Sink

Hono + TypeScript Cloudflare Worker with D1 (sessions, profiles), private R2 uploads and a revision-keyed report cache (Cache API + optional KV).

## Run

```sh
pnpm install
pnpm db:local   # apply migrations to local D1
pnpm dev        # http://localhost:8787
pnpm typecheck
pnpm test       # vitest in workerd with real D1/R2/KV bindings
pnpm build      # wrangler deploy --dry-run
```

Demo login (only when `ENVIRONMENT=dev`): `alice@example.test` or `bob@example.test`, password `local-demo-password`.

## Layout

- `src/index.ts` – routes and origin/session middleware (`/api/*`)
- `src/profiles.ts` – validation and optimistic-concurrency storage
- `src/lib/session-cookie` – HMAC cookie + D1 revocable sessions (block)
- `src/lib/r2-private-uploads` – bounded uploads, 1 MiB limit (block)
- `src/lib/result-cache.ts` – tiered result cache (block)
- `public/` – browser UI
- `test/app.test.ts` – acceptance-style tests for this app

## Notes

- Unsafe methods require `Origin` equal to the request origin (403 otherwise).
- Report cache keys are `tenant + revision + per-write nonce`; the current revision is read from D1 before the cache is consulted.
- Session cookies are `HttpOnly; SameSite=Lax`, `Secure` on HTTPS; plain HTTP is accepted only on loopback.
