# Public GET cache harvest

Reviewed 2026-10-19. This is a new implementation of recurring local patterns, not a verbatim copy.

| Source | Commit | Evidence and decision |
| --- | --- | --- |
| `~/Workspace/sticks/src/edge-cache.ts` | `f9a64263162283048ee09cd4b29e81678a24d50c` | Exact route policies, TTLs, waitUntil writes and explicit expiry. Retain those boundaries; reject unknown query keys instead of silently dropping them, preserve full values instead of truncating at 40 characters, and reject Set-Cookie rather than stripping it. |
| `~/Workspace/inference-market/packages/web/src/edge_cache.ts` | `9231c25a2b7cbf9a04c428fe44324efaec3344f4` | Separate shared/anonymous pages, versioned keys, stale refresh and KV generation memo. Retain versioning; omit app-specific header swapping, feature flags and eventual-consistency generation claims. |
| `~/Workspace/platform/packages/website/src/server/http/colo-cache-key.ts` | `8f8ed9c2a44507490912f8631806664c724be767` | Further evidence of repeated explicit colo-cache ownership; the block keeps its own namespace and origin. |

[Current Workers Cache](https://developers.cloudflare.com/workers/cache/) can avoid Worker execution and supports cached inner entrypoints. It is the preferred starting point for new compatible applications. Older source comments claiming Worker responses can never be cached are no longer generally valid. This block deliberately targets existing applications requiring explicit local Cache API ownership; a gate still runs before the lookup. It does not claim Workers Cache is unable to support gates.

[Cache API documentation](https://developers.cloudflare.com/workers/runtime-apis/cache/) states that `put`/`match` do not implement stale directives. No stale header is presented as an implementation. Cache API entries are local, not a replacement for authoritative state or cross-region invalidation.

The strict public-only boundary avoids harvesting the source's personalized header rewriting. Every identity, unknown-query, response-cookie and Vary guard travels with the code. Origins remain in keys; values remain intact. Positive public directives cannot prove handler purity, so the app must still classify representations correctly.

Verification: `KIT_E2E_ONLY=public-edge-cache node --test test-e2e/install.test.mjs` installs defaults and custom namespace/TTL into clean `hono-d1` projects and runs traveling workerd tests plus TypeScript. Tests cover actual Cache API storage, conservative bypasses, stale metadata, non-public responses and cache failures. No deployed edge hit-rate or load benchmark is claimed.
