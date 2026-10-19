# TypeScript 7 checks with bounded parallelism

```sh
pnpm install
pnpm test
pnpm typecheck
node scripts/typecheck.mjs --since origin/main --concurrency 2
```

Copy the scripts and project map into a pnpm/npm/Bun monorepo, pin `typescript@7.0.2` locally and declare every source dependency in `dependsOn`, including path aliases. Full checking is the default and belongs in required CI. `--since` is an optional developer optimization: it includes merge-base changes, staged/unstaged edits and untracked files, then checks all reverse transitive consumers. Unmapped paths or unavailable history trigger a complete check. Deleted/renamed files retain both old and new paths. Scripts never skip missing dependencies as success.

The native compiler is already parallel internally. Start with two concurrent packages and measure before increasing it. Each project gets its own `.cache/typecheck.tsbuildinfo`; do not share one build-info file across projects. For projects that consume built declarations, run a dependency-aware `tsc -b` build first; this runner is for source-based `--noEmit` checks. It invokes the local compiler with async spawn and forwards failures. It targets Unix development/CI environments.

TypeScript 7 ships as `typescript` with `tsc`; a package named `@typescript/native-preview` is not required. Tools importing the compiler's JavaScript API may still require the [documented TypeScript 6 alias arrangement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/). Do not silently replace those tools' dependency. Generate Wrangler binding types before Workers checks, use explicit `types`, and validate deprecated flags rather than suppressing diagnostics. Excluding a file does not exclude it when imported.

The map is a declared dependency graph, not a complete import analyzer. Missing edges can under-select optional changed-only checks; keep full CI checks. Tests use the real pinned compiler to prove failures propagate, and deterministic barriers to prove concurrency without timing guesses. No speedup is claimed without a repository-specific cold/warm measurement.

This recipe is a root pnpm workspace member. For a standalone copy, run `pnpm install` once and commit its generated lockfile; use `pnpm install --frozen-lockfile` in that project’s CI.
