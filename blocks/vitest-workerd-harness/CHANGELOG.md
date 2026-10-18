## 1.0.1

- `e2e.json` is no longer declared in `files[]` (it was copied into projects as a doc/fixture); core allows it undeclared and the e2e harness reads it from the block directory.

## 1.0.0

- First release, harvested from Ideator's `vitest.config.ts`, `test/apply-migrations.ts` and `test/migration-upgrade.test.ts`.
- The default install matches the hono-d1 template byte for byte, so it installs as a no-op there.
- `prodSim=true` adds a generic replay test (snapshot-based, not tied to Ideator's tables) and `test/prod-seed.ts`.
