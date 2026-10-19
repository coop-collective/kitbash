---
name: cloudflare-container
description: Install an authenticated Cloudflare Container with a Bun, Go or Rust runtime.
---

Use the selected variant to add a **block**, not a separately copied starter. `kit install ... --variant bun|go|rust` adds the native payload under `containers/<serviceName>/`, a Worker gateway, tests and a dedicated `container.<serviceName>.wrangler.jsonc`.

The dedicated config has its own entrypoint and Container export. Use `wrangler dev/deploy -c container.<serviceName>.wrangler.jsonc`; do not replace an existing host entrypoint. Merge the gateway deliberately if a single Worker is required. The config uses the supported legacy `migrations` flow; do not combine it with Wrangler `exports` provisioning.

Bind AUTH to an existing service that validates credentials and this operation's permission, then returns `{tenantId}`. Authentication is required for every request. Never derive routing identity from request headers. Public routing is one POST path, mapped to internal `/hash`; credentials, cookies, arbitrary ports and internal diagnostics are not forwarded. `enableInternet=false` is the Container egress policy.

Native services bind `0.0.0.0:8080` by default, accept at most 1 MiB, and allow two jobs per instance. Each private scratch directory is deleted on completion/failure. Prefer detected Linux tmpfs; writable ephemeral disk is a fallback. A directory named `/tmp` does not imply RAM. Persist results to a platform storage binding if needed.

Run the installed gateway tests and host typecheck with `kit verify`. Also install native dependencies and run `pnpm test`, `pnpm typecheck`, `pnpm build` inside the payload. Run the explicit installed Docker smoke, generate dedicated Wrangler types and perform a dedicated dry-run before deployment. The Docker smoke's read-only root, capability dropping, PID/memory limits and bounded tmpfs are **local test flags**, not promised Cloudflare configuration controls. No automatic deployment or provisioning runs during installation.
