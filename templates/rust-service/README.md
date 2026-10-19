# Rust service starter

Copy this standalone Cargo workspace into a new project. `pnpm install` resolves its Cargo dependencies and installs the Rust 1.96.0 toolchain from `rust-toolchain.toml`. Direct Cargo commands remain supported through rustup. For pnpm installation in a standalone copy, first rename `pnpm-workspace.standalone.yaml` to `pnpm-workspace.yaml`. Keep the sample name inside Kitbash: a nested workspace boundary prevents pnpm 12 from discovering its Cargo graph from the repository root.

```sh
# From the repository root:
pnpm --filter kit-template-rust-service lint
pnpm --filter kit-template-rust-service test
pnpm --filter kit-template-rust-service build

# Direct Cargo commands from this directory:
cargo fmt --all --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
cargo run --locked -p service
cargo build --locked --release -p service
```

`GET /healthz` is an uncached JSON response. The default address is `127.0.0.1:8080`; `HOST` must be an IP and `PORT` a complete integer from 1 to 65535. For a container, explicitly set `HOST=0.0.0.0` behind your gateway. SIGTERM/SIGINT stop acceptance and drain connections with a ten-second deadline. Application routes and configuration parsing are testable without process-wide environment mutation.

Workspace dependencies, inherited lints, a committed lockfile, thin LTO and one release codegen unit provide a small reusable foundation. Router tests check responses; production authentication, storage, request limits, telemetry and Cloudflare container orchestration belong to separate features. This is a native Linux/macOS service, not a Wasm Worker. Run `cargo update` deliberately and commit Cargo.lock.
