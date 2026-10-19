# TypeScript native checks

Reviewed 2026-10-19. Deliverable: executable recipe `recipes/typescript-native-checks`.

## Evidence and bug avoidance

`platform` at `8f8ed9c2a44507490912f8631806664c724be767`, `scripts/ci/build-tsc.mjs`, `scripts/ci/build-tsc-lib.mjs`, and root `package.json`, uses change-aware package selection and a compiler benchmark. The `runPackagesParallel` implementation calls synchronous `spawnSync` through `runPackageTypecheck` before its next iteration, so its async worker wrapper does not actually overlap compiler subprocesses. That implementation should not be copied as a parallelism pattern. Some package scripts also return success when dependencies are absent; a required check must fail instead.

`beanstalk` at `63dae2ccf2cf76d09384f525042c21f163f383fc`, root `package.json`, `pnpm-workspace.yaml` and `tsconfig.base.json`, already pins stable TypeScript 7.0.2 with explicit type settings. `enginebox/dashboard/tsconfig.json` uses incremental checking but retains generated Next paths; runtime-specific generated declarations require deliberate inclusion.

This original recipe retains the useful bounded fan-out and consumer closure ideas, uses real asynchronous subprocesses, fails when the compiler/config is missing, and falls back to a full check for uncertain history or unmapped changes. It includes real failing-compiler regression coverage. It does not modify any reviewed source repository.

## References and validation

- [TypeScript 7 stable and API compatibility](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [Incremental build information](https://www.typescriptlang.org/tsconfig/incremental.html)
- [Project references and build mode](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [Node asynchronous spawn](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options)

`npm ci`, `npm test`, `npm run typecheck`. Optional changed-only checks are explicitly not a substitute for the full CI gate. Benchmark your actual projects with cold and warm caches; no invented performance multiplier is attached to this recipe.
