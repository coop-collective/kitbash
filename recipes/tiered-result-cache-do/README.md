# DO result cache integration fixture

This repository fixture renders the installable `tiered-result-cache` block's defaults through Kitbash's renderer; it does not maintain a second implementation. Run from the workspace with `pnpm --filter @kitbash/recipe-tiered-result-cache-do test`, `typecheck`, or `build`. Dependency installation is managed by the root pnpm workspace.

DO is this fixture's source choice. The same loader contract supports R2, D1, Analytics Engine and other JSON sources; the [source guide](../../blocks/tiered-result-cache/docs/README.md#choosing-a-loader) explains payloads, keys, freshness and the coverage boundary for each.

The Worker authorizes every request, scopes a real SQLite Durable Object by tenant/catalog, and caches its expensive summary projection. A lightweight authoritative revision RPC selects the cache generation. Mutations return a new revision, so subsequent reads cannot reuse a prior generation. If a mutation races the expensive load, the DO rejects the mismatched revision and the Worker retries once. This provides a coherent example without implying that an eventually consistent KV revision pointer makes reads immediately fresh.

A stricter `Cache-Control: no-cache` read bypasses all result-cache reads, writes and dedupe. Authentication responses are never cached. The HTTP response is private/no-store even when its internal data was reused. `AUTH` is a production integration seam: supply your application's credential and membership checks before using this outside tests. The permissive service in vitest.config.ts is test-only. No login provider is included.

Tests run the actual DO RPC/SQLite, named Cache API and KV in workerd. They check reuse, authorization on hits, authoritative revision invalidation, tenant isolation, bypass and mutations between the revision and summary RPCs. A repeated revision race exhausts the retry and becomes HTTP 409. The traveling block tests additionally exercise tier promotion, malformed/oversized data, absolute expiry, stale refresh, cache failures, overlap dedupe and old-generation races. No deployment or global KV propagation simulation is claimed.
