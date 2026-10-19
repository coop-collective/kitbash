# Kitchen Sink

Hono + TypeScript Worker with D1 (sessions, profiles), private R2 (`UPLOADS`), KV + Cache API (`RESULT_CACHE`) report cache, and a static UI in `public/`.

- `pnpm install`
- `pnpm db:local` – apply D1 migrations locally
- `pnpm dev` – run at http://localhost:8787 (demo login: alice@example.test / bob@example.test, password `local-demo-password`, only when `ENVIRONMENT=dev`)
- `pnpm typecheck`, `pnpm test`, `pnpm build`

Notes: sessions are server-side rows in D1; cookie `ks_session` is `<id>.<HMAC>` (HttpOnly, SameSite=Lax, Secure on HTTPS; HTTP login only allowed on loopback). Unsafe `/api` requests need an exact same-origin `Origin`. Report cache keys are `report/<user>/<revision>`, with the revision read from D1 on every request. `compatibility_date` was set to 2026-08-22 because the installed workerd rejects newer dates.
