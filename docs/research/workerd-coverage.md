# Workerd coverage

Local evidence: `~/Workspace/ideator` at `3faf4c64cc6e2fe279b2a48d5e8b01ca40443a73`, `packages/api/vitest.config.ts`; `~/Workspace/inference-market` at `9231c25a2b7cbf9a04c428fe44324efaec3344f4`, `packages/web/vitest.config.ts`. Both run production migrations in workerd; neither config establishes a coverage floor. This is an original tested companion recipe, not a claim that coverage was already harvested from either app.

Primary references checked 2026-10-19: [Cloudflare coverage limitation](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#coverage), [Vitest coverage](https://vitest.dev/guide/coverage.html). Istanbul is required for workerd. The installed 4.1.11 provider matches Vitest 4.1.11; current online docs can describe newer major versions.

Verification from `recipes/workerd-coverage`: `npm ci`, `npm test`, `npm run typecheck`, `npm run test:guard`. The guard tests a real threshold failure for an unimported file in an isolated scratch directory. The fixture exercises Worker fetch and migrated D1.

Limitations: code coverage cannot establish adequate assertions or production parity. Thresholds need a real app baseline. This standalone recipe changes no Kitbash allowlist and adds no coverage upload service.

Observed version constraint: a first run at today's compatibility date failed before tests because pool 0.22 embeds workerd with maximum date 2026-08-22. The fixture now explicitly uses that compatible date; an upgrade to the renamed plugin is separate work.
