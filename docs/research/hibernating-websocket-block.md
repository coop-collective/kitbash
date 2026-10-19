# Hibernating WebSocket block conversion

Reviewed 2026-10-19. This converts the original Kitbash starter at commit `06d82a19f1cec574da5c603cb8378285b9399f6c` (`templates/hibernating-websocket/{src,public,test}`) into an installable block. The earlier source research remains in `docs/research/hibernating-websocket.md`: sticks hub at `f9a64263162283048ee09cd4b29e81678a24d50c` and platform reconnect/JamDO architecture at `8f8ed9c2a44507490912f8631806664c724be767`. This is original code informed by those patterns, not a copied authentication provider.

The block owns a configurable DO class/binding, upgrade route, browser assets and bounded behavior. It adds only DO binding/migration configuration through the existing JSONC merge. The host retains its Worker entrypoint, static-asset configuration, auth provider and Vitest configuration. `handleRoomUpgrade` supports host-specific routing/auth closures; `createRoomRoutes` provides the configured Hono router. Host class export and session/membership authorization are explicit adaptation steps.

Verification:

- `node packages/cli/src/kit.ts validate ./blocks/hibernating-websocket --json`: passed with no findings.
- `KIT_E2E_ONLY=hibernating-websocket node --test test-e2e/install.test.mjs`: two clean-template installer cases passed with no skips. The alternate changes class, binding, migration tag, route, output names, asset directory and resource limits.
- Each installed case runs 11 Node/Miniflare integration tests and two browser-client tests, then the host TypeScript check through `kit verify`.
- Integration tests bundle the installed library/router into a test-only Worker and exercise real workerd upgrades, tenant isolation, identity-header replacement, SQL snapshots/history bounds, ping auto-response, attachment reconstruction, expiry and admission/rate/message bounds. They assert the rendered Wrangler DO binding and migration.
- Browser-client tests exercise reconnect timing, ping, teardown and no message replay using controlled sockets/timers. They do not claim Playwright coverage.

The test entrypoint has connection-inspection controls and belongs only under tests. It is never patched into Wrangler's production main entrypoint. Programmatic Miniflare avoids overwriting or migrating host Vitest configuration; `node --test` is an existing allowlisted verification command. Miniflare `5.20261012.1-beta` is the exact dependency shipped by Wrangler 4.151.1, paired with esbuild 0.28.2. The test runtime date is 2026-10-12; the block does not change the host compatibility date.

Limits remain explicit: authorization is leased, not instantly revocable; idle expired sockets close on an application event or new handshake; automatic ping replies do not reauthorize; no replay acknowledgments or global abuse protection are provided. Constructor reconstruction does not prove platform eviction timing or billing savings. No deployment was performed.

Primary references: [Cloudflare WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Durable Object class exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/), [Miniflare API](https://developers.cloudflare.com/workers/testing/miniflare/core/api/).
