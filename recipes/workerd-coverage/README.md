# Workerd coverage with an enforced floor

This runnable reference measures the Worker that actually reads/writes local D1. Copy `test.coverage` into an existing `cloudflareTest` config and add `@vitest/coverage-istanbul` at exactly the same version as Vitest. It stays on this repository's Vitest 4 / workers-pool compatibility line.

```sh
cd recipes/workerd-coverage
npm ci
npm test
npm run typecheck
npm run test:guard
```

`coverage/index.html` is the local report; `coverage/lcov.info` works with CI coverage services. The gate applies to each source file and includes unimported files. Start project thresholds from an observed baseline; retain separate branch/function floors. The guard adds an unimported module in a disposable project and proves coverage fails with a zero-function report.

Workerd requires Istanbul rather than native V8 coverage. Instrumentation adds work; use plain Vitest during iteration and coverage at CI/review checkpoints. Coverage measures execution, not assertion quality, SQL quality, remote behavior or browser paths. This is a recipe because Kitbash's verifier does not allow `--coverage`; its allowlist is unchanged. See `docs/research/workerd-coverage.md` for provenance.

The compatibility date stays at 2026-08-22 because the pinned workers pool embeds a runtime with that maximum date. Advancing it requires upgrading/testing the pool, not just Wrangler.
