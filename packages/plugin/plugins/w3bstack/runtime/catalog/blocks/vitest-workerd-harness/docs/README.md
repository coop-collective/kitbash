# vitest-workerd-harness

Tests run inside workerd (`@cloudflare/vitest-pool-workers`) against a local Miniflare D1 that has every migration
in `./migrations` applied before each test file.

## Files

- `vitest.config.ts`: `cloudflareTest` reads `wrangler.jsonc`; `readD1Migrations("./migrations")` is exposed to tests as the
  `TEST_MIGRATIONS` binding.
- `test/apply-migrations.ts`: setupFile calling `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` (idempotent).
- `test/harness.test.ts`: checks the harness itself (D1 reachable, every migration applied).
- With `prodSim=true`: a second D1 `PROD_SIM_DB` in the config, `test/prod-seed.ts` and `test/migration-upgrade.test.ts`.

## Existing harness

The hono-d1 template already ships Ideator's harness. With default params this block renders `vitest.config.ts` and
`test/apply-migrations.ts` byte for byte like the template, so the planner reports them as identical and skips them: the
install adds only `test/harness.test.ts` and the lock entry. With `prodSim=true` the config differs by the
`PROD_SIM_DB` lines, so the plan reports a clean file conflict with the diff; rerun with `--on-conflict overwrite` after
reading it. A project with its own, different `vitest.config.ts` gets the same conflict and nothing is overwritten.

## Replay test

`shippedThrough=N` means production has run migrations 1..N. The test applies those to `PROD_SIM_DB`, inserts the rows in
`prod-seed.ts`, applies all migrations, then checks that each seeded row still exists with its values (including all original tables and columns) and that `PRAGMA foreign_key_check` is empty. Reapplying migrations must preserve the resulting rows too. Raise `shippedThrough` when a release ships; it must match an existing migration. Duplicate rows count separately. Intentional destructive changes require domain-specific assertions.

`history-snapshot.test.ts` exercises the preservation guard, including table/column removal, changed values, duplicate loss and blobs.
