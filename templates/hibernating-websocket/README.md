# Hibernating WebSocket rooms

Copy this directory as a standalone project. It includes a Worker gateway, a SQLite Durable Object, a browser chat UI and tests. It is a template because installing the main entrypoint, static assets and DO exports requires application ownership that a generic block cannot safely patch.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

Before browser connections work, bind your application's `room-auth` Worker. Its `POST /authorize-room` endpoint receives the session cookie plus `{room}` and must validate both session and room membership. A successful response is `{userId, tenantId, expiresAt}` (expiry in milliseconds); failures are non-2xx. This template ships no production login provider. The permissive authorizer inside `vitest.config.ts` is test-only and never part of a deployment. Configure your real session cookie and auth Worker for local interactive testing as well.

The gateway requires an exact same-origin WebSocket upgrade, validates room names, rejects query parameters and replaces all identity headers. The DO name is a JSON tuple of authenticated tenant and room. Identity never comes from client frames. The browser uses cookies, not a token in a URL.

`acceptWebSocket`, `getWebSockets`, serialized attachments and auto-response ping/pong preserve the hibernation path. There are no server-side intervals. SQLite holds the last 100 messages; each reconnect replaces the browser list with a snapshot. This is bounded chat history, not a replay log or an exactly-once delivery protocol. Messages are committed before broadcast. The client never automatically resends messages after a disconnect.

Limits: 100 connections per room, 4096-byte input frames, 1000 text characters, a per-connection burst of 10 messages refilling at 2/s. Add account/IP admission limits in the gateway for a public application. Auth leases last at most five minutes and are checked on application messages and before broadcasts. Ping auto-responses do not reauthorize. An idle socket may remain open after expiry until an application event; no protected broadcast is sent to it. Immediate revocation needs a separate session-revocation mechanism.

The client uses capped exponential retry with jitter and resets only after ten stable seconds. Policy closure 1008 stops retries; the user signs in again or manually reconnects. DOM messages use textContent.

Tests use `@cloudflare/vitest-plugin` (the current successor to `vitest-pool-workers`) and the actual workerd DO/SQLite/WebSocket APIs. Constructor reconstruction checks persisted attachments and SQL, but does not prove platform eviction timing or billing behavior. Browser lifecycle/backoff tests use a controlled socket and clock, not Playwright. Production transport, auth integration and load testing remain deployment-specific.
