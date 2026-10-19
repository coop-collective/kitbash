# Rust bootstrap

Current deliverable: the **rust variant** of [cloudflare-container](../../blocks/cloudflare-container/docs/README.md). The standalone starter described in this original review was replaced by an installable Wrangler/Cloudflare Containers block; its payload is mapped into root pnpm. Historical evidence and initial checks follow.

Reviewed 2026-10-19. Deliverable: standalone `templates/rust-service`.

## Evidence

- `beanstalk` at `63dae2ccf2cf76d09384f525042c21f163f383fc`: root `Cargo.toml`, `scripts/rust-check.mjs`, `packages/runner/{Cargo.toml,src/main.rs,Dockerfile}`. Useful pattern: inherited workspace dependencies/lints, axum router separated from the executable, SIGTERM handling, fmt → clippy → test, and release profiles. The runner's git/process execution and cross-compilation Docker stages are product-specific.
- `thoughtless-agent` at `6e3bb89029d082fe654b09b4168f0d1370059c45`: `Cargo.toml`, `rust-toolchain.toml`, `crates/ta-api/src/main.rs`. Useful contrast: explicitly pinned toolchain and loopback defaults. Its fat LTO is appropriate to measured compute workloads, not an automatic default for every HTTP service.

The template is original code; it does not copy the source-available Beanstalk runner or financial application logic. It takes architectural conventions, with a bounded drain deadline and isolated config parsing added. It is a whole-project template because Kitbash currently manages npm dependency installation, not Cargo workspaces.

## Verification and limits

Run the README's fmt, clippy and test commands with the lockfile. Tests exercise the actual axum router including HEAD/405/404 and malformed bind configuration. A release build checks native packaging; no Cloudflare deployment or platform-specific container build is claimed.

Primary references: [Cargo workspaces and lint inheritance](https://doc.rust-lang.org/cargo/reference/workspaces.html), [Cargo profiles](https://doc.rust-lang.org/cargo/reference/profiles.html), [axum serve](https://docs.rs/axum/latest/axum/fn.serve.html), [Tokio signal](https://docs.rs/tokio/latest/tokio/signal/index.html). Test-only unwraps fail tests; startup and serving propagate errors.
