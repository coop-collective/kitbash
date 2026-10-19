# Root workspace

Kitbash pins **pnpm 12.14.0** in the root `package.json`. Use Node 22.18 or later, Go 1.26.4, and a C compiler for Go's race detector. `pnpm bootstrap` installs the JavaScript dependencies, the Bun 1.4.3 runtime, Rust 1.96.0 with fmt/clippy, Cargo dependencies, and then invokes `go mod download`. The Go starter currently uses only the standard library.

## Package map

Run `pnpm workspace:map` for actual package names and paths. Directory names retain their purpose; all runnable projects are root workspace members.

| Path | Purpose | Dependency ownership |
| --- | --- | --- |
| `packages/*` | Registry core, API, CLI and plugin | Root `pnpm-lock.yaml`, explicit `workspace:*` links |
| `templates/*` | Copyable Bun, Worker, WebSocket, container, Rust and Go applications | Root JS lock; Rust's `Cargo.lock`; Go's `go.mod` and future `go.sum` |
| `recipes/*` | Lint, coverage, browser, deployment and compiler examples | Root JS lock, independent version constraints |
| `docs/examples` | Executable contract examples | Root JS lock; included in `pnpm test` |
| `test-e2e` | Block installation into independent temporary applications | Explicit `pnpm test:e2e` |
| `blocks/*` | Parameterized source templates, not executable packages | Installed and verified by the e2e harness |

Cloudflare workers-pool/Vitest 4 and newer plugin examples keep their tested dependency combinations. Sharing the lockfile does not force a common compiler, test runner or runtime version.

## Commands

| Command at repository root | Runs |
| --- | --- |
| `pnpm bootstrap` | Workspace/native dependency install followed by Go module download |
| `pnpm install --frozen-lockfile` | Reproducible JS and Cargo install; does not resolve Go modules |
| `pnpm workspace:map` | Workspace package names and locations |
| `pnpm check` | Lint, typecheck, tests and validation, stopping on a failure |
| `pnpm test` | Node, Bun, workerd, Rust and Go race tests, plus contract/recipe/harness unit tests |
| `pnpm test:core` | Only the registry's four packages |
| `pnpm typecheck` | TS checks, generated Worker binding types, Cargo check and Go build checks |
| `pnpm lint` | The ESLint recipe, Rust fmt/clippy and Go vet |
| `pnpm validate` | Generated schemas and plugin structure |
| `pnpm build` | Native binaries, CLI/plugin/Bun bundles and Worker dry-run bundles (the container image build requires Docker) |
| `pnpm test:e2e` | Local browser→Worker→D1 journey and clean-template block installation |
| `pnpm test:coverage-guard` | Prove an unimported source file fails the coverage gate |
| `pnpm test:docker` | Container rights, read-only root, bounded tmpfs and cleanup; requires Docker |

Install Chromium once with `pnpm --filter kitbash-recipe-playwright-worker-e2e browsers:install` (Linux CI: `pnpm --filter kitbash-recipe-playwright-worker-e2e exec playwright install --with-deps chromium`). Browser, block-install and Docker suites are explicit because they have additional host requirements or run substantially longer. The workerd coverage recipe's coverage floors run during ordinary `pnpm test`.

Recursive commands limit concurrent projects to two; e2e projects run one at a time. Use pnpm's filters to select work:

```sh
pnpm --filter kit-template-rust-service test
pnpm --filter kit-template-go-service build
pnpm --filter kit-template-bun-typescript dev
pnpm --filter './recipes/*' -r --if-present run typecheck
KIT_E2E_ONLY=session-cookie pnpm --filter @kitbash/test-e2e test:e2e
```

## Native resolution

pnpm's [Cargo support](https://github.com/pnpm/pnpm/blob/v12.14.0/pnpm/docs/cargo.md) is experimental and opt-in (`cargo.enabled: true`). It reads the starter's existing `Cargo.lock`, verifies crate checksums, vendors sources into ignored `.pnpm/crates`, and generates an optional `.cargo/config.toml` include. It also installs the pinned toolchain into `.pnpm/rust`. Compilation remains Cargo's job; the crate graph stays in `Cargo.lock`, not the JavaScript lockfile. Without the generated files, direct Cargo can use its usual registry sources.

pnpm 12.14.0 does **not** implement a Go module resolver. The Go package's scripts call the host Go toolchain; `go.mod`/`go.sum`, `go mod download`, `-mod=readonly` and the Go module cache remain authoritative. There is no synthetic npm representation of Go or Rust library dependencies. The package wrappers expose build/test/dev tasks for root orchestration.

The Bun template uses [`devEngines.runtime`](https://github.com/pnpm/pnpm/blob/v12.14.0/pnpm/docs/package_json.md#devenginesruntime). pnpm installs its exact runtime and supplies it to package scripts, so a global Bun install is unnecessary.

## Copying a template or recipe

Run root installs in this repository; the root JS lock is the single reviewed dependency graph. Copy only source/configuration, leaving out `node_modules`, `.pnpm`, `target`, `.wrangler`, build output, generated types and secrets. In the new directory, run `pnpm install`, commit the generated `pnpm-lock.yaml`, then use frozen installs in its CI. Native `Cargo.lock` remains part of the Rust template. Direct Cargo and Go commands also work independently of pnpm.

Worker templates and recipes retain local `pnpm-workspace.yaml` files to approve esbuild/workerd's install scripts after copying. Root installs intentionally use the root settings and pnpm prints a warning about those local settings being ignored. The Rust template instead supplies `pnpm-workspace.standalone.yaml`; rename it after copying. A nested workspace file would hide its Cargo manifest from root native discovery in pnpm 12.14.0.

Cloudflare workflow recipes remain inert under `recipes/cloudflare-ci/workflows/`. Their standalone adoption instructions require committing the new project's lockfile before enabling frozen-install CI. No recursive root command performs a remote deployment or database migration.
