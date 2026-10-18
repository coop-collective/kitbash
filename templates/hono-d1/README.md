# hono-d1 reference template

Minimal Hono Worker with a D1 `DB` binding, the reference project for Kitbash blocks (variant `hono-d1`).

- `src/index.ts` app, `src/routes/health.ts` the `/health` route (D1 round trip)
- `migrations/0001_init.sql` a `meta` table; blocks add `0002+` (the installer renumbers)
- `vitest.config.ts` + `test/apply-migrations.ts` tests run in workerd with migrations applied (block #11)
- `.kit/project.json` the project profile the planner reads; `.dev.vars.example` env names

```
pnpm install --ignore-workspace   # or npm install
pnpm test        # vitest in workerd
pnpm typecheck
pnpm build       # wrangler deploy --dry-run (bundles, no network, no deploy)
```

The D1 `database_id` is a placeholder; local dev and tests never read it. No secrets live here.
