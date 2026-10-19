# Shared TypeScript lint bootstrap

A flat ESLint config for TypeScript Worker/library source and Node configuration scripts, extracted from the shared backend-config pattern in platform and generated-file ignores in mailcheap. The recipe has no project-specific logging restrictions. It keeps recommended correctness rules, explicit-any checks and unused-value checks enabled.

```sh
cd recipes/typescript-lint
npm ci
npm run lint
npm test
npm run lint:cached
```

Copy `eslint.config.mjs` and the listed dev dependencies into the target package, then add the two lint scripts. In a monorepo, choose either one root config/run or package-specific configs with shared exports. Run from the config's project root. The content cache is local and disposable; CI uses the uncached command unless caching is keyed by lockfile and lint config.

Generated Worker declarations, Wrangler state, build output and coverage are ignored recursively. The configuration tests prove ordinary source remains linted. There is no `projectService` or typed linting overhead; type checking remains a separate command. Typed promise checks can be added once each package has an accurate tsconfig. React/Next rules are intentionally separate and should extend framework presets.

The pinned parser is demonstrated with TypeScript 5.9, not a claim of TypeScript 7 parser support. Use a separate supported parser compiler version if the app uses the native TS7 checker. Node >=22.13 is required for the pinned ESLint major. This is a recipe because lint commands are outside the block verifier's allowlist.
