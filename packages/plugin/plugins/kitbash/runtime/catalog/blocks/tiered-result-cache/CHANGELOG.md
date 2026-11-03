# Changelog

## 2.0.0

Source payloads mirror installation paths.

### Upgrade

Use `src/lib/tiered-result-cache/` and the declared route paths; update imports and catalog checkouts. HTTP URLs and database migrations are unchanged.

## 1.0.0

Shared typed result cache with named edge Cache API, optional KV, authoritative loaders, absolute freshness/staleness bounds, request-local dedupe, tenant/version keys and strict bypass.

Loader documentation covers R2, D1, Durable Objects, Analytics Engine and other JSON sources, including source-specific bounds, query keys, TTL versus revision-based invalidation and the scope of integration coverage.
