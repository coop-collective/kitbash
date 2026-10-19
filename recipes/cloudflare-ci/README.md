# Cloudflare CI and environment deployment bootstrap

This template separates credential-free PR checks from a manual, environment-scoped deployment of the same checked main-branch commit. Workflows are inert under `workflows/`; copy them to `.github/workflows/` only in the project adopting the pattern. Kitbash's installer intentionally cannot write workflow paths.

```sh
cd recipes/cloudflare-ci
pnpm install
pnpm test
pnpm typecheck
pnpm build --env staging
pnpm build --env production
node scripts/deploy.mjs staging
```

The last command prints the exact migration/deployment plan. `--execute` performs remote writes, is used by the deployment workflow, and is not part of local verification. Its preflight requires a token/account and distinct provisioned D1 databases. Both migration and deploy always pass the same `--env`; there is no implicit production default. Migration failure stops deploy. Environment deploys serialize and are not cancelled midway.

Adoption checklist:

1. Bring the scripts/workflows and package manifest into the app root. Run `pnpm install` and commit the generated `pnpm-lock.yaml` before enabling CI. The example uses pnpm 12.14.0; both workflows install that exact version and use frozen installs. In this repository, dependency versions come from the root lockfile.
2. Configure both Wrangler environments with separately provisioned bindings; replace both placeholder database IDs. Bindings are not inherited automatically. Configure any Worker secrets separately.
3. Create GitHub environments `staging` and `production`; add environment-scoped `CLOUDFLARE_API_TOKEN` secrets and `CLOUDFLARE_ACCOUNT_ID` variables. Set production reviewers/branch restrictions in GitHub settings; YAML alone does not create those protections.
4. Add application lint, workerd integration/migration-history tests and browser checks to the check job. Require it in branch protection. Audit/pin action revisions according to repository policy.
5. Use additive expand/contract migrations so old code remains compatible after migration but before deploy. A Worker rollback cannot reverse D1 schema/data. Backfills and destructive migrations need a release-specific procedure.

The fixture's tests prove command ordering and failure handling; dry runs only validate packaging. This recipe does not assert a live deployment or hosted workflow run. For Cloudflare Vite or vinext, select the environment at build time (`CLOUDFLARE_ENV`) and deploy its generated config instead of copying this raw-Worker deploy command.

Compatibility date 2026-09-28 matches the maximum supported by the pinned Wrangler runtime. Upgrade and test the toolchain before advancing the date.

This recipe is a root pnpm workspace member. For a standalone copy, run `pnpm install` once and commit its generated lockfile; use `pnpm install --frozen-lockfile` in that project’s CI.
