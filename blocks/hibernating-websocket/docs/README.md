# Hibernating WebSocket rooms

Install this block into an existing Cloudflare Worker. It adds a SQLite Durable Object, an upgrade handler, a browser page/client, local integration tests and a Wrangler merge. It preserves the host entrypoint, existing bindings, asset configuration and Vitest configuration.

Defaults install `src/lib/hibernating-room.ts`, `src/routes/hibernating-room.ts`, `public/room-chat/`, and tests. Class, binding, file names, route prefix, asset directory, migration tag and limits are parameters. Choose an unused `migrationTag`; Wrangler DO migration tags are independent of D1 SQL migration numbering.

Wire the host using the installed names:

```ts
// Existing Worker entrypoint: required for Wrangler to instantiate the configured class.
export { HibernatingRoom } from './lib/hibernating-room';

// Existing Hono application:
import { handleRoomUpgrade } from './routes/hibernating-room';
app.get('/rooms/:room', (c) => handleRoomUpgrade(c.req.raw, c.env.ROOM_SOCKETS,
  async (request, room) => {
    const session = await yourSessionProvider(request);
    if (!session || !await yourMembershipCheck(session, room)) return null;
    return { userId: session.userId, tenantId: session.tenantId, expiresAt: session.expiresAt };
  }));
```

The callback is a host integration seam: replace both example functions with real session and membership checks. Tenant/user identity must come from verified state. The gateway rejects foreign or missing Origins, query-bearing room URLs, malformed rooms and non-WebSocket requests. It replaces client identity headers before forwarding to a DO named by the authenticated tenant/room tuple. Do not expose the DO directly or trust identity headers from public callers.

Serve the installed asset directory with the application's existing static-asset setup. The example page is `/room-chat/index.html` when `public/` is mounted at `/`; it imports its sibling JavaScript file. Use the same origin for page and upgrade route. The block does not change the host's asset binding or routing precedence. After exporting the class and mounting the handler, generate Worker types and perform a Wrangler dry-run build before deployment.

The DO uses `acceptWebSocket`, serialized attachments, SQL and ping auto-response. It holds no socket map or interval heartbeat. Each reconnect receives a replacement snapshot; messages commit before broadcasting. History defaults to 100 rows, input to 4096 UTF-8 bytes/1000 text characters, admission to 100 sockets, and rate limiting to a burst of 10 refilling at 2/s. These are feature limits, not global account/IP abuse prevention.

Authorization leases last at most five minutes by default. Messages and broadcasts check expiry; new handshakes reclaim expired idle sockets. Auto-response pings do not reauthorize, and an expired idle socket may remain open until the next application event or handshake. Immediate revocation requires a host-owned revocation mechanism. This is bounded chat history, not durable replay or exactly-once delivery. The browser never automatically resends messages.

The traveling `node --test` suite bundles a test-only entrypoint with esbuild and uses real Miniflare/workerd WebSockets, SQLite and attachments. It also checks the installed Wrangler binding/tag. Separate browser-client tests use a fake socket and clock. No test config replaces the host's Vitest configuration. The Miniflare version is pinned to the version shipped with Wrangler 4.151.1; it is a prerelease test dependency. The test runtime uses compatibility date 2026-10-12; the host's date is unchanged. Production uses APIs available before the tested Hono fixture's 2026-08-22 date.

The fixture can inspect and expire connections to verify reconstruction and boundaries. It lives under the test directory and must never become the deployed Worker entrypoint. Constructor reconstruction demonstrates persistence without claiming actual platform eviction timing, billing savings, browser E2E coverage or hosted deployment.

Provenance: converted from Kitbash's tested `templates/hibernating-websocket` at `06d82a19f1cec574da5c603cb8378285b9399f6c`. That original implementation was informed by `sticks/src/hub.ts` at `f9a64263162283048ee09cd4b29e81678a24d50c` and platform reconnect/JamDO patterns at `8f8ed9c2a44507490912f8631806664c724be767`. No product-specific state machine or auth provider is included. The platform facet supervisor's lifecycle differs; reassess auto-response pings for virtualized/facet objects.

References: [Cloudflare hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [DO class exports and migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/), [Miniflare API](https://developers.cloudflare.com/workers/testing/miniflare/core/api/).
