# Hono/D1 installation fixture

Internal host application for Kitbash installer, CLI and plugin tests. Reusable features live under `blocks/`; this fixture supplies the empty application they are installed into.

- `src/index.ts` and `src/routes/health.ts`: minimal Worker with a D1 health round trip.
- `migrations/0001_init.sql`: baseline table; installed blocks receive subsequent migration numbers.
- `vitest.config.ts` and `test/apply-migrations.ts`: workerd tests with real migrations.
- `.kit/project.json`: Hono/D1 project profile used by the planner.

From the repository root:

```sh
pnpm --filter @kitbash/fixture-hono-d1 test
pnpm --filter @kitbash/fixture-hono-d1 typecheck
KIT_E2E_ONLY=session-cookie pnpm --filter @kitbash/test-e2e test:e2e
```

The installer harness copies source/configuration into temporary directories, installs dependencies and performs a frozen reinstall. The database ID is a placeholder; local tests never contact a production database. Local workspace settings approve esbuild/workerd builds in those isolated copies.
