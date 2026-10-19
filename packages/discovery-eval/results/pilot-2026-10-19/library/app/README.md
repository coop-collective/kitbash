# Kitchen Sink

Hono + TypeScript Worker with D1 (sessions, profiles), private R2 uploads and a revision-keyed report cache (Cache API + optional KV).

    pnpm install
    pnpm db:local     # apply migrations to local D1
    pnpm dev          # http://localhost:8787  (alice@example.test / bob@example.test, password local-demo-password)
    pnpm typecheck && pnpm test && pnpm build

Demo login works only when `ENVIRONMENT=dev` (wrangler.jsonc vars). Secrets live in `.dev.vars` (local fixture `SESSION_SECRET`).
Reused catalog blocks live in `src/lib/` (session-cookie, member-profiles with handle rule tightened to `[a-z0-9_]{3,30}`, r2-private-uploads capped at 1 MiB).
Note: `compatibility_date` is 2026-08-22, the newest the installed workerd supports.
