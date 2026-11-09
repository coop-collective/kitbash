# __PROJECT_NAME__

Vinext App Router on Cloudflare Workers. Requires Node 22.18+ and pnpm 12.14.0.

```sh
pnpm install
pnpm dev
pnpm check
pnpm smoke
```

Development listens on `http://__HOST__:__PORT__`. Pages live in `src/app/`, route handlers in `src/app/api/`, reusable blocks in `src/lib/<block>/`, and tests in `test/`. `pnpm check` generates binding types, checks TypeScript, runs module tests in workerd, and builds the app. `pnpm smoke` boots the built Worker and checks the actual home page and `/api/health`; module tests alone do not verify the vinext router.

This preset starts with framework-independent `crypto-utils`, `public-edge-cache`, and `tiered-result-cache` as selectable blocks. They require importing and configuring at the intended call site. Hono route blocks and Durable Object exports require a dedicated adapter and are not offered as turnkey vinext options. `src/cloudflare-extensions.d.ts` merges the Worker-specific `CacheStorage.default` and `SubtleCrypto.timingSafeEqual` declarations with browser DOM types; these APIs remain server-only.

The scaffold follows `create-vinext-app@1.1.0 --platform cloudflare --legacy-wrangler-cloudflare-init`, with pinned vinext 1.2.1, Cloudflare adapter 1.1.1 and Vite plugin 1.64.0. The upstream default now uses `cloudflare.config.ts`/`cf`; this explicit supported Wrangler mode keeps Kitbash binding merges and atomic Infisical deployment on one source `wrangler.jsonc`. Review adapter compatibility before upgrades. [Upstream setup](https://github.com/cloudflare/vinext/tree/main/packages/create-vinext-app), [Workers deployment](https://vinext.dev/docs/deploying/cloudflare).

Choose rendering and freshness per page when product behavior is known. This minimal scaffold does not enable a shared application cache or imply that every route should be statically generated. Consult the page-delivery skill explicitly for SSR, prerendering, data caches, client caches and invalidation decisions.

For staging, run `pnpm build:staging` followed by `pnpm run deploy --env staging`; production uses `pnpm build:production` and `pnpm run deploy --env production`. The built `dist/server/wrangler.json` already contains its selected environment, so deployment must not add Wrangler `--env`. The secrets helper checks the expected Worker name before using that flattened config. Configure Infisical in `.kitbash/secrets.json`. Add any selected block bindings to every deployed Wrangler environment because bindings do not inherit.

The compatibility date is pinned to 2026-08-22 because the registry-compatible `@cloudflare/vitest-pool-workers` 0.23.0 embeds a runtime with that maximum date. This legacy package has been renamed upstream to `@cloudflare/vitest-plugin`; update the registry block tests and runtime together before advancing the compatibility date.

`pnpm test` runs workerd TypeScript tests and installed `test/**/*.test.mjs` / `.test.cjs` Node suites. Native container builds and Docker smoke checks remain explicit steps in the container block adaptation checklist.

`pnpm ci:dry-run` rehearses D1 migrations in disposable local databases and packages each configured environment without deployment credentials. GitHub PR checks run it automatically. The trusted release workflow runs `pnpm db:migrate --env staging|production` after build and before deployment: it records a restore bookmark and stops on migration failure. Application-specific upgrade tests should verify preservation of existing records.

The Kitbash catalog also includes an optional `github-preview-production.yml` workflow for PR Previews as test and automatic production deployment from main. Adopt it after configuring explicit Preview bindings and authorization; keep shared remote database migrations out of PR jobs.
