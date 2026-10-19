# Workspace pattern review — 2026-10-19

This follow-up turns recurring implementation patterns from `~/Workspace` into independent, reviewable Kitbash contributions. The source repositories and the main checkout were not edited. The PRs are based on `2d68920`; all 18 PRs (including this catalog) were merged on 2026-10-19. They are not deployed services or published registry releases.

## Scope and evidence

Three research agents covered auth/data, runtime infrastructure, and testing/delivery. The coordinating review covered language bootstraps, TypeScript native checks, vinext and integration. A metadata pass inventoried **53 top-level Git roots**; deep code review focused on the relevant implementations, rather than claiming every tracked file was audited. [The inventory](research/workspace-inventory-2026-10-19.json) records commit IDs and manifest counts. It is a snapshot, not a recommendation to reuse every repository.

The metadata pass used tracked file lists, excluded worktree copies, security/audit/backup folders, dependency/build/vendor directories and duplicate platform variants. Nested source projects were inspected where a candidate pointed to them. Environment/credential files were not used as source material. Each contribution carries a `docs/research/<slug>.md` note with exact source commits/paths, differences from the source, current primary references, checks and limitations.

## Contribution map

Each row is one focused PR. Templates and recipes have their own README and verification commands; they are now mapped into the root pnpm workspace; see [workspace commands](WORKSPACE.md).

| Area | Contribution | Form | Reusable behavior | Verification |
|---|---|---|---|---|
| Self-hosted browser sessions | `session-cookie` [#1](https://github.com/coop-collective/kitbash/pull/1) | Block | HMAC cookies, D1 revocation, Origin protection, cleanup | Clean-template workerd tests and typecheck |
| OAuth sign-in | `oauth-signin-origin` [#17](https://github.com/coop-collective/kitbash/pull/17) | Existing block fix | Reject cross-origin login submissions before consuming identity/code | OAuth workerd regressions and clean installation |
| Profiles | `member-profiles` [#12](https://github.com/coop-collective/kitbash/pull/12) | Block | Owner edits, public projection, atomic revisions and unique handles | Clean-template D1 tests and typecheck |
| Private R2 uploads | `r2-private-uploads` [#14](https://github.com/coop-collective/kitbash/pull/14) | Block | Actual-byte limits, tenant-derived keys, authenticated downloads/deletes | Clean-template R2/workerd tests and typecheck |
| Public caching | `public-edge-cache` [#13](https://github.com/coop-collective/kitbash/pull/13) | Block | Conservative eligibility, versioned keys, bounded TTL, safe bypasses | Real Cache API tests and two clean installs |
| Typed result caching (follow-up) | [tiered-result-cache](../blocks/tiered-result-cache/docs/README.md) [#20](https://github.com/coop-collective/kitbash/pull/20) | Block + DO integration fixture | Cache API → optional KV → authoritative loader, tenant/revision keys, bounded freshness, strict bypass | Two clean installs, four real DO RPC tests, typecheck and dry-run bundle |
| Hibernating fullstack WebSockets | `hibernating-websocket` [#15](https://github.com/coop-collective/kitbash/pull/15) | Template | Worker auth seam, tenant DO rooms, SQL snapshots, attachments and browser reconnect | Real workerd upgrade/broadcast tests and controlled client tests |
| Container exposure and scratch writes | `container-gateway` [#16](https://github.com/coop-collective/kitbash/pull/16) | Template | Narrow authenticated gateway, non-root runtime, bounded temporary files, tmpfs detection | Gateway/service tests, dry-run build and local Docker profile |
| Bun TypeScript bootstrap | `bun-typescript` [#4](https://github.com/coop-collective/kitbash/pull/4) | Template | Pinned Bun/TS7, pure HTTP handler, validation and shutdown | 4 tests, typecheck, frozen install and bundle build |
| Rust bootstrap | `rust-service` [#5](https://github.com/coop-collective/kitbash/pull/5) | Template | Pinned workspace, inherited lints, HTTP router and bounded shutdown | fmt, clippy, 3 tests, release build and HTTP/SIGTERM smoke |
| Go bootstrap | `go-service` [#6](https://github.com/coop-collective/kitbash/pull/6) | Template | Standard-library service, strict bounded JSON, timeouts and shutdown | vet, race tests, build; handler coverage 100%, startup 0% |
| SQL integration/migration history | `workerd-migration-replay` [#2](https://github.com/coop-collective/kitbash/pull/2) | Existing block fix | Detect table/column/value/duplicate loss and replay foreign-key checks | 4 clean-install cases and 7 preservation regressions |
| Browser e2e | `playwright-worker-e2e` [#10](https://github.com/coop-collective/kitbash/pull/10) | Recipe | Managed local Worker server and real migrated D1 browser flow | 2 Chromium tests, typecheck and launcher validation |
| Coverage | `workerd-coverage` [#9](https://github.com/coop-collective/kitbash/pull/9) | Recipe | Istanbul in workerd, per-file floors, unimported-source failure guard | 3 integration tests, 100% fixture coverage, negative guard |
| Linting | `typescript-lint` [#3](https://github.com/coop-collective/kitbash/pull/3) | Recipe | Shared ESLint flat config, generated-file exclusions and content cache | Lint and 4 config tests |
| Cloudflare CI/CD | `cloudflare-ci` [#11](https://github.com/coop-collective/kitbash/pull/11) | Recipe | Unprivileged checks, explicit environments, migration-before-deploy ordering | 4 runner tests, staging/production dry runs and actionlint |
| TypeScript 7 checks | `typescript-native-checks` [#7](https://github.com/coop-collective/kitbash/pull/7) | Recipe | Real bounded subprocess concurrency and reverse consumer selection | 6 tests, real compiler failures and real-Git selection checks |
| vinext guardrails | `vinext-guardrails` [#8](https://github.com/coop-collective/kitbash/pull/8) | Recipe | Configuration/data checks, measured client bundle budgets and runtime acceptance matrix | 6 tests; static validation only |

## Why these boundaries

Blocks preserve the registry contract: declared files/parameters, migrations and bindings, provenance, agent adaptation notes, and tests that travel to a clean Hono/D1 project. Existing auth and test blocks are improved where the feature already exists. Session cookies complement email-code sign-in and CLI OAuth; they do not replace those features.

Whole-project language and runtime scaffolds are templates. Lint, browser runners, coverage tooling and workflow bootstrap are recipes because their commands or target paths exceed the existing block verifier/installer allowlists. The extraction does not weaken those allowlists to make a workflow look installable. GitHub workflow examples are inert until an adopting project deliberately copies them into its workflow directory.

Authentication, authorization and tenancy remain explicit integration seams. The profile/upload blocks require a verified host identity; WebSockets and containers require an authorization service. Their tests prove the supplied boundary and behavior, not an unimplemented production identity provider.

## Findings that changed the extracted pattern

- OAuth sign-in handlers accepted cross-origin form submissions before identity/code side effects. Exact Origin checks fix the boundary, and changing the page referrer policy preserves valid native form headers.
- The previous migration replay skipped removed tables and columns; it could accept data loss. The fix checks schema presence and row multiplicity, plus unusual table names that SQL LIKE wildcards could accidentally exclude.
- Platform’s purported parallel typecheck runner invokes synchronous subprocesses. The reusable recipe uses asynchronous spawn, bounds concurrency and keeps complete CI checks as the default.
- Coverage must include source files that no test imports. The coverage recipe deliberately introduces such a file and expects the threshold gate to fail.
- A temporary directory name does not establish RAM backing. The container template detects Linux tmpfs, bounds concurrency and bytes, cleans up private job directories, and separates locally tested Docker flags from Cloudflare configuration.
- vinext compatibility, cache adapters and Vite environment selection vary by pinned version. The recipe enforces narrow mechanical checks and records the browser/runtime cases that static checks cannot establish.
- Native TypeScript CLI checks and JavaScript compiler-API consumers have different compatibility needs. The lint recipe keeps its tested parser compiler, while the native-check recipe pins TS7 explicitly.

## Adoption and validation limits

The browser and container examples require host-owned authorization wiring before interactive production use. Cookie headers are checked in workerd; browser enforcement still belongs in the adopting app’s journey tests. WebSocket attachment reconstruction is tested explicitly; that does not force a real platform eviction. Local Docker validates permissions and scratch behavior, not Cloudflare scheduling or egress enforcement.

Compatibility dates match each tested toolchain. The existing workers-pool 0.22 line cannot be assumed to support today’s runtime date; the coverage and migration recipes retain their verified version boundary. Newer WebSocket tests use the current plugin separately. Upgrading an integration should update its pinned tooling and runtime tests together.

No live deployment, production database migration or registry publication was performed. The initial review left the PRs open; the subsequent authorized integration merged all 18. CI workflows were syntax-checked and packaging was dry-run; hosted execution remains an adoption step. The vinext checker does not claim a production site build or measured speedup.

## Combined verification

The later [result-cache standard](research/tiered-result-cache.md) extends public HTTP caching with reusable typed computation caching. Its verification includes independent review of expiry races, lazy cache opening, revision-safe DO loads and request-local deduplication. The [repository fixture](../recipes/tiered-result-cache-do/README.md) renders the exact block rather than maintaining a second implementation. The initial review counts below remain the historical 17-branch verification; the follow-up contributes two additional installer cases and four DO integration tests.

All **17 implementation branches** applied together without conflicts in an isolated checkout. **347 core/API/CLI/plugin tests**, **15 contract-example checks**, typechecking and registry/plugin validation passed. The full installer suite passed **38/38 cases, zero failures and zero skips**, including defaults, alternate parameters, conflict handling and three multi-block chains. Standalone recipe/template checks are recorded in the table and individual PRs.

[The verification record](research/workspace-verification-2026-10-19.json) pins each tested branch commit and the commands. Auth/session/profile/upload/OAuth and TypeScript-selection code also received independent read-only review. The main checkout and all 17 implementation worktrees were clean at handoff. All 18 PRs were subsequently merged at the owner’s request; none was deployed.
