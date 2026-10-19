# Root workspace

Kitbash pins **pnpm 12.14.0**. Use Node 22.18 or later, Go 1.26.4 and a C compiler for Go's race detector. `pnpm bootstrap` installs JavaScript dependencies, the Bun 1.4.3 runtime, Rust 1.96.0 with fmt/clippy, Cargo dependencies, and then invokes `go mod download` for the container payload.

## Package map

Reusable application setups are blocks. There is no public `templates/` tree. Run `pnpm workspace:map` for executable package names and paths.

| Path | Purpose | Dependency ownership |
| --- | --- | --- |
| `packages/*` | Registry core, API, CLI and plugin | Root JS lock; explicit workspace links |
| `blocks/*` | Installable features with manifests, parameters, provenance and traveling tests | Installed into a host with the kit CLI/MCP |
| `blocks/cloudflare-container/variants/{bun,go,rust}/container` | Native payloads of one container block; runnable pnpm workspace members | Root JS lock, native Cargo.lock and go.mod |
| `recipes/*` | Lint, coverage, browser, deployment and compiler references | Root JS lock; independent tested toolchains |
| `test-e2e/fixtures/hono-d1` | Internal minimal host for installer, CLI and plugin tests | Root JS lock; copied into isolated temporary projects |
| `test-e2e` | Block validation, real installation and Docker checks | Explicit longer-running checks |
| `docs/examples` | Executable registry contract examples | Root JS lock |

The [Cloudflare container block](../blocks/cloudflare-container/docs/README.md) installs a dedicated Wrangler configuration and Worker gateway plus a chosen Bun, Go or Rust service, Dockerfile and tests. Its native sources are directly runnable; Worker files with Kitbash parameters are rendered by installation. [Hibernating WebSockets](../blocks/hibernating-websocket/docs/README.md) installs a Durable Object, authorized upgrade handler and browser client into a host Worker.

## Commands

| Command at repository root | Runs |
| --- | --- |
| `pnpm bootstrap` | Workspace/native install followed by Go module download |
| `pnpm install --frozen-lockfile` | Reproducible JS and Cargo install; Go retains its own resolver |
| `pnpm workspace:map` | Executable workspace package names and locations |
| `pnpm check` | Lint, typecheck, tests and validation, stopping on failure |
| `pnpm test` | Registry/recipe/fixture tests plus Bun, Cargo and Go race tests |
| `pnpm test:core` | Registry's four original packages |
| `pnpm typecheck` | TS checks, generated Worker binding types, Cargo check and Go build checks |
| `pnpm lint` | ESLint recipe, Rust fmt/clippy and Go vet |
| `pnpm validate` | Registry schemas, plugin structure and every block's scanner |
| `pnpm build` | Native binaries, CLI/plugin/Bun bundles and Worker dry-run bundles |
| `pnpm test:e2e` | Browser journey and strict clean-host block installations, including runtime variants |
| `pnpm test:coverage-guard` | Prove an unimported source file fails the coverage gate |
| `pnpm test:docker` | Install each container variant, then build/run its traveling Docker smoke tests |

Docker tests require a running Docker engine. They check non-root execution, a local read-only root filesystem, bounded tmpfs and cleanup; these Docker flags are not claims about Cloudflare production configuration. Install Chromium once with `pnpm --filter kitbash-recipe-playwright-worker-e2e browsers:install` (Linux CI adds `--with-deps`). Browser, install and Docker suites are explicit because of their host requirements and duration. Recursive ordinary tasks use two concurrent projects; e2e projects run one at a time.

```sh
pnpm --filter @kitbash/container-rust test
pnpm --filter @kitbash/container-go build
pnpm --filter @kitbash/container-bun dev
pnpm --filter './recipes/*' -r --if-present run typecheck
KIT_E2E_ONLY=cloudflare-container pnpm --filter @kitbash/test-e2e test:e2e
KIT_E2E_ONLY=hibernating-websocket pnpm --filter @kitbash/test-e2e test:e2e
```

## Native resolution

pnpm's [Cargo support](https://github.com/pnpm/pnpm/blob/v12.14.0/pnpm/docs/cargo.md) is experimental and opt-in (`cargo.enabled: true`). It reads the runtime payload's Cargo.lock, verifies crate checksums, vendors sources into ignored `.pnpm/crates`, generates a Cargo configuration include and installs the pinned toolchain. Compilation remains Cargo's job; the crate graph stays in Cargo.lock. Direct Cargo can use its usual registry sources without generated includes. Generated `.cargo`, `.pnpm`, `target`, dependencies and build output are excluded from block bundles.

pnpm 12.14.0 does **not** implement a Go module resolver. The Go payload's scripts call the host Go toolchain; go.mod/go.sum, `go mod download`, `-mod=readonly` and the Go module cache remain authoritative. The Bun payload uses pinned `devEngines.runtime`, so a global Bun install is unnecessary. Native package scripts expose tasks to root pnpm without duplicating source under a separate starter tree.

## Installing blocks and using references

Install a runtime block through the normal kit dry-run/apply/verify flow, selecting its variant and parameters. Read its adaptation checklist for host authorization, exports and resource provisioning. The container block owns a private subproject under `containers/<serviceName>` and a dedicated Worker configuration; its explicit native scripts run only when invoked. Root package scripts, install hooks and package-manager configuration are not replaced by a block.

Recipes remain reference material. Copy their source/configuration deliberately, install dependencies and commit the resulting lockfile before frozen CI installs. Local recipe/fixture `pnpm-workspace.yaml` files approve esbuild/workerd builds in standalone copies; root installs use root settings and may warn that local settings are ignored.

`recipes/tiered-result-cache-do` is an integration fixture that renders the exact result-cache block; it requires this repository. To adopt the feature, install the [result-cache block](../blocks/tiered-result-cache/docs/README.md) and adapt the fixture's authorization/revision checks. Cloudflare workflow examples remain inert under their recipe directory. No root command performs a remote deployment or production database migration.
