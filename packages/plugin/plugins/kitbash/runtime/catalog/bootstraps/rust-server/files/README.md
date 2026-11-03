# __PROJECT_NAME__

Local Axum server using Tokio, structured tracing, and graceful shutdown. Inspired by Omniscient's local service entrypoints and root pnpm-to-Cargo commands; no game logic or Cloudflare container runtime is included.

Uses the tested Rust 1.96.0 toolchain with rustfmt/clippy, Node 22.18+, and pnpm 12.14.0. Rustup reads `rust-toolchain.toml`; Cargo.lock pins native dependencies.

```sh
pnpm install
pnpm dev
pnpm check
pnpm smoke
```

Development listens on `http://__HOST__:__PORT__`. Override `HOST`, `PORT`, and `RUST_LOG` in the process environment. `pnpm build` builds the release binary; `pnpm start` runs it. `pnpm check` runs formatting, Clippy, compilation, Cargo tests and a release build. `pnpm smoke` runs the built server on a temporary local port, checks `/health` over HTTP, and stops the process.

Keep entrypoint configuration in `src/main.rs`; reusable native modules belong under `src/lib/<block>/` and must be wired with Rust module declarations. Current Kitbash TypeScript/Worker blocks cannot be copied into this native runtime; the bootstrap picker intentionally offers none until native variants exist. Cargo.lock pins the native graph, and root pnpm scripts remain the common command entrypoint.

Use the generated Infisical helper for environment-scoped secrets. Local values synchronize to ignored `.env.local`; Cargo does not load dotenv files automatically. Run `pnpm secrets:run --env local -- pnpm dev` to fetch and inject the configured Infisical values when starting the service. This local preset has no deployment target or Worker secret synchronization.
