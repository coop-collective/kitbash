# Bun + TypeScript service starter

This Bun service is a Kitbash pnpm workspace member and can also be copied into its own project. pnpm installs its pinned Bun runtime through `devEngines.runtime`; Bun remains the runtime and bundler.

```sh
pnpm install
pnpm check
pnpm build
pnpm start
```

The server exposes `GET /healthz`, defaults to loopback port 3000, validates `PORT`, caps request bodies at 4 KiB, and drains connections on SIGTERM/SIGINT with a five-second deadline. Set `HOST=0.0.0.0` explicitly inside a container behind an authenticated gateway. Add application routes to `src/app.ts`; keep listener and environment reads in `src/server.ts`.

Bun executes TypeScript, while the pinned TypeScript 7 compiler performs the explicit typecheck. Tests include an actual ephemeral-port HTTP listener. `pnpm build` emits a Bun-target bundle, not a standalone executable. A standalone copy generates its own `pnpm-lock.yaml`; commit it and use frozen installs in CI. Inside Kitbash, use the root lockfile. Secrets and build output are ignored.

This is a Bun service/CLI foundation, not a Cloudflare Worker runtime. Worker bindings require workerd tests and Wrangler; use `test-e2e/fixtures/hono-d1` for that target. No remote service, authentication, deployment, or production application is included.
