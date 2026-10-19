# Rust service starter

Copy this standalone Cargo workspace into a new project. Requires the pinned Rust 1.96.0 toolchain; rustup installs it from `rust-toolchain.toml`.

```sh
cargo fmt --all --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
cargo run --locked -p service
cargo build --locked --release -p service
```

`GET /healthz` is an uncached JSON response. The default address is `127.0.0.1:8080`; `HOST` must be an IP and `PORT` a complete integer from 1 to 65535. For a container, explicitly set `HOST=0.0.0.0` behind your gateway. SIGTERM/SIGINT stop acceptance and drain connections with a ten-second deadline. Application routes and configuration parsing are testable without process-wide environment mutation.

Workspace dependencies, inherited lints, a committed lockfile, thin LTO and one release codegen unit provide a small reusable foundation. Router tests check responses; production authentication, storage, request limits, telemetry and Cloudflare container orchestration belong to separate features. This is a native Linux/macOS service, not a Wasm Worker. Run `cargo update` deliberately and commit Cargo.lock.
