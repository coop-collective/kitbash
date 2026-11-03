# __PROJECT_NAME__

Hono on Cloudflare Workers. Requires Node 22.18+ and pnpm 12.14.0.

```sh
pnpm install
pnpm db:local
pnpm dev
pnpm check
pnpm smoke
```

Development listens on `http://__HOST__:__PORT__`. `pnpm check` generates binding types, checks TypeScript, runs tests inside workerd against local D1 migrations, and dry-runs the Worker bundle. `pnpm smoke` boots the Worker and checks `/health` over HTTP. No Cloudflare account is needed for these checks.

Block implementation files belong under `src/lib/<block>/`; entrypoint wiring stays in `src/index.ts`, integration tests in `test/`, migrations in `migrations/`. Install through Kitbash to resolve imports and bindings, then complete the adaptation checklist reported by `kit status` and the guide in `.kit/blocks/<block>/`. Preinstalled files are not a substitute for connecting routes or choosing authorization policy.

Before deploying, create a real D1 database for each environment and replace its placeholder ID under `env.staging` or `env.production` in `wrangler.jsonc`. Apply migrations to the selected database with `pnpm exec wrangler d1 migrations apply DB --remote --env staging`. Review this remote action separately from local checks. Cloudflare environment bindings do not inherit. Bootstrap copies each selected block binding into staging and production with distinct resource names/placeholders; provision and review those environment-specific resources before deployment.

Configure `.kitbash/secrets.json` and use the shared secrets commands to populate local values and staging/production secrets from Infisical. `pnpm run deploy --env staging` selects an explicit target and injects its runtime secrets during deployment. Keep runtime secrets in Infisical; commit only names and example documentation.

The worker-pool pattern follows [Cloudflare's Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/). Use the page-delivery skill explicitly when adding a frontend; this preset has no page-rendering strategy.

The compatibility date is pinned to 2026-08-22 because the registry-compatible `@cloudflare/vitest-pool-workers` 0.23.0 embeds a runtime with that maximum date. This legacy package has been renamed upstream to `@cloudflare/vitest-plugin`; update the registry block tests and runtime together before advancing the compatibility date.

`pnpm test` runs workerd TypeScript tests and installed `test/**/*.test.mjs` / `.test.cjs` Node suites. Native container builds and Docker smoke checks remain explicit steps in the container block adaptation checklist.
