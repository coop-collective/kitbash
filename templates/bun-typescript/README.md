# Bun + TypeScript service starter

Copy this directory to a new project. It is an independent Bun project, outside Kitbash's pnpm workspace.

```sh
bun install --frozen-lockfile
bun run check
bun run build
bun run start
```

The server exposes `GET /healthz`, defaults to loopback port 3000, validates `PORT`, caps request bodies at 4 KiB, and drains connections on SIGTERM/SIGINT with a five-second deadline. Set `HOST=0.0.0.0` explicitly inside a container behind an authenticated gateway. Add application routes to `src/app.ts`; keep listener and environment reads in `src/server.ts`.

Bun executes TypeScript, while the pinned TypeScript 7 compiler performs the explicit typecheck. Tests include an actual ephemeral-port HTTP listener. `bun run build` emits a Bun-target bundle, not a standalone executable. Commit `bun.lock` after dependency updates and use frozen installs in CI. Secrets and build output are ignored.

This is a Bun service/CLI foundation, not a Cloudflare Worker runtime. Worker bindings require workerd tests and Wrangler; use `templates/hono-d1` for that target. No remote service, authentication, deployment, or production application is included.
