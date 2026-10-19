# Workerd migration-history replay

Source: `~/Workspace/ideator` at `3faf4c64cc6e2fe279b2a48d5e8b01ca40443a73`, `packages/api/test/migration-upgrade.test.ts`, `test/migration-order.test.ts`, and `vitest.config.ts`. The source takes explicit snapshots of old columns, verifies foreign keys and reruns migrations. Existing Kitbash 1.0.1 lost those guarantees by skipping missing tables/columns. This patch repairs that existing block rather than creating a second harness.

The regression cases prove table/column removal, changed values and duplicate loss fail, while additive columns/rows and equivalent blob values pass. The optional real-D1 replay still applies shipped migrations, inserts production-shaped fixtures, then applies the entire history on a separate local database.

Primary references checked 2026-10-19: [Cloudflare test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/) and [isolation](https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/). Current docs describe the newer `@cloudflare/vitest-plugin`; this change intentionally retains the installed `@cloudflare/vitest-pool-workers@0.22` compatibility line.

Verification: `KIT_E2E_ONLY=vitest-workerd-harness node --test test-e2e/install.test.mjs` installs defaults and both production replay variants into clean Hono/D1 projects and runs all installed tests plus TypeScript checking. `node packages/cli/src/kit.ts validate blocks/vitest-workerd-harness` checks the manifest and scanner.

Limitations: fixtures must represent actual production data, and an intentional rename/backfill requires domain-specific assertions. Local SQLite replay does not validate remote resources, D1 limits, deployment ordering or concurrent migration runners. Existing custom Vitest config remains an explicit install conflict.
