# TypeScript lint bootstrap

Sources: `~/Workspace/platform` at `8f8ed9c2a44507490912f8631806664c724be767`, `packages/tools/eslint-backend.js` and `packages/api-proxy/eslint.config.mjs` demonstrate an exported shared TypeScript ESLint config. `~/Workspace/mailcheap` at `6fd333e2b9a66d65785958de40061afa72fa6059`, `eslint.config.mjs` and `.github/workflows/ci.yml` demonstrate generated-file ignores and lint in CI. The recipe deliberately omits platform's application-specific console restrictions and its disabled explicit-any rule.

Primary reference checked 2026-10-19: [typescript-eslint flat-config quickstart](https://typescript-eslint.io/getting-started/). Dependency versions are pinned and the lockfile is committed. This recipe uses the established ESLint ecosystem rather than assuming a migration to a different linter is beneficial without measurements.

Verification in `recipes/typescript-lint`: `npm ci`, `npm run lint`, `npm test`, `npm run lint:cached`. The tests invoke the real ESLint API and prove bad TS/JS is rejected, generated files are ignored, ordinary source remains covered, and Worker ambient symbols do not trigger false positives.

Limits: syntax linting does not replace type checking, typed promise rules, framework accessibility rules or runtime tests. The pinned parser is verified with TS5.9; native TS7 checking is a separate concern. Installer/verifier policy is unchanged.
