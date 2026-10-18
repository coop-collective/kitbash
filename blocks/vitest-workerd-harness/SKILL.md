---
name: vitest-workerd-harness
description: Use when a Hono + D1 Worker needs tests that run in workerd with migrations applied, or a test proving new migrations keep production rows.
license: MIT
metadata:
  kitbash: "@coop/vitest-workerd-harness@1.0.0"
---

# vitest-workerd-harness

## What it adds

`vitest.config.ts` (cloudflareTest + `readD1Migrations` -> `TEST_MIGRATIONS`), `test/apply-migrations.ts` (setupFile that
applies `./migrations` to the test D1 before each file), `test/harness.test.ts` (self-check). Optional `prodSim`: a second
D1 `PROD_SIM_DB`, `test/prod-seed.ts`, `test/migration-upgrade.test.ts` (replay of production history plus newer migrations).

## Interface

- Params: `prodSim` (boolean, default false), `shippedThrough` (integer, default 1; highest migration production has run).
- Needs: D1 binding `DB` in `wrangler.jsonc`; dev deps `@cloudflare/vitest-pool-workers@^0.22`, `vitest@^4.1`.
- No tables, routes, env or secrets. Export: `PROD_SEED` (prodSim only).

## Install

Dry run first. On the hono-d1 template the default install is a no-op for the two harness files (identical content is
skipped); only `test/harness.test.ts` is written. With `prodSim=true` the plan reports a conflict on `vitest.config.ts`
(it adds the `PROD_SEED` D1 lines); read the diff, then rerun with `--on-conflict overwrite`. A different existing
`vitest.config.ts` also stops the install; nothing is overwritten silently.

## Adapt

1. Install dependencies if the project lacked the dev deps.
2. prodSim only: put real production-shaped INSERTs in `test/prod-seed.ts` and set `shippedThrough`.

## Verify

`npx vitest run` and `npx tsc --noEmit` (run `wrangler types` first so `Env` exists).

## Known limits

Migrations must be numbered `NNNN_name.sql`. The replay test compares seeded rows column by column; a column a later
migration removed is ignored, a changed value fails. Tables dropped by a later migration are skipped. It needs a second
local D1, so it does not run against remote databases.
