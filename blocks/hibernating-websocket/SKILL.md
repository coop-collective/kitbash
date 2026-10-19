---
name: hibernating-websocket
description: Install a tenant-scoped hibernating Durable Object room, authorized upgrade handler, browser client and real workerd tests into an existing Worker.
---

The block adds the room feature without replacing the host Worker entrypoint, auth provider, static asset setup or Vitest config. Parameters cover class/binding/file names, route and assets paths, DO migration tag and bounded resource limits. Wrangler bindings and SQLite-class migrations merge into existing configuration.

Use for tenant-scoped room broadcasts with a bounded recent-message snapshot. Do not use as an exactly-once protocol, complete auth system, immediate revocation mechanism or unbounded chat archive.

Adapt the host:

1. Export the rendered DO class from the actual Wrangler main module. Mount `handleRoomUpgrade` at the rendered route, passing the configured DO namespace.
2. Supply a callback that validates the session and access to the requested room. Return verified userId, tenantId and expiry, or null. The gateway enforces same-origin upgrades and replaces identity headers. The DO must remain reachable only through trusted binding callers.
3. Serve the rendered browser assets through the host's existing static setup, on the same origin. The included page imports its sibling client. Preserve unrelated asset routing.
4. Choose an unused migration tag and retain prior deployed migrations. Generate Worker types after exporting the class, then verify the host's bundle before deployment.

Connections use hibernation APIs and serialized session/rate attachments; SQLite holds bounded history. There are no server interval heartbeats or in-memory socket maps. Auth leases are checked on messages/broadcasts and when reclaiming idle capacity. Ping auto-response does not reauthorize. Immediate revocation requires additional host integration. The browser stops retrying policy closures and never replays sends.

The traveling Node tests use programmatic Miniflare and esbuild for real DO/WebSocket/SQL behavior without changing the host test config. The test-only entrypoint contains inspection controls and is never a production entrypoint. Browser-client tests use controlled sockets/timers. Constructor reconstruction does not prove actual eviction timing or billing reductions. The pinned Miniflare prerelease matches Wrangler's dependency; the host compatibility date remains untouched.
