# Authenticated container operations and temporary writes

Reviewed 2026-10-19. A standalone template keeps runtime/Docker/main-entrypoint ownership explicit; these files cannot be safely merged into an arbitrary existing app by the current block installer.

| Source | Commit | Finding |
| --- | --- | --- |
| `~/Workspace/platform/packages/remotion-renderer/src/index.ts`, `Dockerfile` | `8f8ed9c2a44507490912f8631806664c724be767` | Container class, port routing and lifecycle defaults recur around media jobs. The harvest isolates routing from product render/D1/R2 glue. |
| `~/Workspace/platform/packages/persona/services/persona-radar-cache/src/RadarCacheBox.ts` | same | Container lifecycle and selected environment forwarding; avoid copying product proxy secrets or broad environment forwarding. |
| `~/Workspace/platform/packages/playground/container/Dockerfile` | same | Non-root distroless image seeds writable `/tmp` because minimal images may not include it. Comments explain native library requirements for dynamically loaded compiler dependencies. |
| `~/Workspace/platform/packages/playground/container/go/repository/engine_css.go` | same | Same-directory temporary write/rename and private per-project workspace patterns. The example uses exclusive private files with unconditional cleanup; it does not download or execute tools. |

[Container class API](https://developers.cloudflare.com/containers/api/container-class/) validates the SDK configuration used here. This template intentionally stays on the class SDK used by existing portfolio projects; newer scheduling APIs have a different lifecycle contract and deserve a separate migration. The Worker authenticates and fixes the HTTP operation before routing. Container identity alone does not authenticate a caller.

[Cloudflare's lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/) documents Worker-to-DO-to-container routing. [Filesystem FAQ](https://developers.cloudflare.com/containers/faq/) says disk is ephemeral by default and distinguishes snapshots/FUSE persistence. Neither source promises that a directory named `/tmp` is RAM-backed. The template inspects the actual Linux filesystem, prefers writable shared-memory tmpfs where available, and otherwise reports a disk-backed fallback without requiring root or mount privileges. It does not conflate container `/tmp` with Workers `node:fs` virtual memory.

The sample enforces byte, concurrency and time bounds because putting temporary files in RAM turns unbounded disk growth into OOM risk. Do not mount tmpfs with a privileged entrypoint just to make a misleading speed claim. Keep durable artifacts outside scratch, remove app write ownership, avoid arbitrary network proxying, and make auth failure prevent instance allocation.

Verification: template typecheck, six Node tests (gateway policy, actual HTTP streaming, private temp permissions, cleanup, concurrent admission and timeout), Wrangler dry-run bundle, local Docker build/run as non-root under read-only rootfs and tmpfs scratch. Cloudflare deployment, scheduler behavior and platform egress policy are not locally proven. Exact commands and limitations are in the template README.
