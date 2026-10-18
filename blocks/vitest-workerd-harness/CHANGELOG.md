## 1.0.0

- First release, harvested from Ideator's `vitest.config.ts`, `test/apply-migrations.ts` and `test/migration-upgrade.test.ts`.
- The default install matches the hono-d1 template byte for byte, so it installs as a no-op there.
- `prodSim=true` adds a generic replay test (snapshot-based, not tied to Ideator's tables) and `test/prod-seed.ts`.
