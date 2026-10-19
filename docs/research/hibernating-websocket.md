# Hibernating fullstack rooms

Reviewed 2026-10-19. New minimal implementation informed by these local sources:

| Source | Commit | Retained / excluded |
| --- | --- | --- |
| `~/Workspace/sticks/src/hub.ts` | `f9a64263162283048ee09cd4b29e81678a24d50c` | Hibernation API, serialized per-socket state and snapshots. Exclude market snapshots, dirty coalescing and shared alarm clocks. |
| `~/Workspace/platform/packages/client/src/realtime/reconnect-policy.ts` | `8f8ed9c2a44507490912f8631806664c724be767` | Stable-open reset, capped retry, jitter and app ping. Exclude product-specific room phases and reconnect ownership. |
| `~/Workspace/platform/packages/jams/src/jam-do.ts` | `8f8ed9c2a44507490912f8631806664c724be767` | Evidence of hibernating room architecture; no Jam-specific state machine is copied. |

The current JamDO constructor deliberately disables auto-response pings: its loaded-facet supervisor needs ping events to keep that facet resident. The shared reconnect-policy comment still describes the older auto-response behavior. This is an important divergence, not a pattern to copy blindly. This template owns ordinary platform Durable Objects and has no facet supervisor, so auto-response ping is appropriate; virtualized/facet deployments must reassess that lifecycle.

[Hibernation guidance](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) describes `acceptWebSocket` and attachment persistence. The template avoids regular server WebSocket event listeners, connection maps and interval heartbeats. SQL owns the durable message history; attachments own only live-connection metadata.

[Test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/) support running assertions in the actual Durable Object. Tests open real upgrade connections, exercise broadcast/tenant isolation, and reconstruct the class using the same storage and sockets. This deliberately makes a narrower claim than an actual platform eviction test.

[Current test setup](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/) uses the renamed `@cloudflare/vitest-plugin`. The repository's older pool package embeds an August workerd that rejects an October compatibility date; this standalone template uses plugin 1.4.4 and the newer runtime rather than silently downgrading its compatibility target.

Authorization is a narrow service-binding seam, not invented authentication. The application must validate session and room membership. Tenant routing is server-derived, origins are checked before the auth call, and expired sockets are excluded from every broadcast. The leased authorization model cannot revoke an idle session instantly. Browser retries stop on policy closure and never replay writes.

Verification from `templates/hibernating-websocket`: `pnpm typecheck`, `pnpm test`, `pnpm build`. The template includes generated-type instructions, bounded snapshots and browser lifecycle tests. It is a template rather than an installer block because main exports, asset ownership and production auth binding are app-specific. No deployment, billing measurement or browser E2E claim is made.
