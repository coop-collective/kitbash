# Tiered result cache

This is a data-result standard for Worker services, separate from `public-edge-cache`, which handles public HTTP representations. It supports expensive DO RPC, D1 queries and other JSON projections:

```ts
// Authentication and current access checks have already completed.
const cache = createResultCache({
  origin: new URL(request.url).origin,
  context: ctx,
  kv: env.RESULT_CACHE, // optional
});
const result = await cache.get({
  key: { scope: 'catalog-summary', tenant: member.organizationId, version: knownRevision, parts: [catalogId] },
  freshSeconds: 30,
  parse: parseCatalogSummary, // unknown -> validated CatalogSummary
  load: () => env.CATALOGS.getByName(JSON.stringify([member.organizationId, catalogId])).summary(),
});
return Response.json(result.value, { headers: { 'cache-control': 'private, no-store' } });
```

Every call is authorized before entering the cache. Tenant is derived from the verified session; include user/role/projection visibility in the key if representations differ within a tenant. Do not cache auth, permission checks, revocation state, balances, secrets or other immediately consistent decisions. The helper never selects HTTP caching headers for your response.

| Situation | Behavior |
| --- | --- |
| Fresh edge hit | Return validated result |
| Edge miss/stale, fresh KV | Return KV and promote its remaining lifetime to edge |
| Both miss or hard-expired | Await authoritative loader, validate, schedule writes |
| Only stale candidate, staleSeconds > 0 | Return newest candidate; refresh from store in waitUntil |
| Stale refresh fails | Report error; original deadline remains unchanged |
| Cache error, malformed/oversized envelope, schema mismatch | Treat that tier as a miss |
| Store throws or returns invalid data | Propagate; cache no error value |
| Valid but too-large/non-JSON result | Return loader data, skip storage and report encode failure |
| bypass: true | Skip cache reads/writes and pending loads; always execute store |

Fresh-only is the default. Both cache tiers store absolute creation/fresh/stale deadlines. Promotions never restart TTL. Shorter read policies can further restrict an existing envelope; longer policies cannot extend it. KV has a minimum expiration TTL, so short-lived entries can remain physically present after their logical deadline; the envelope still rejects them. Null is a cacheable JSON value if the parser accepts it, so absence caching has the same freshness tradeoff.

Invalidate by moving to a new authoritative version/revision key. Old in-flight loads can only fill their old version. Obtain the revision from an authoritative mutation or read when immediate freshness matters; a KV-cached revision pointer is not an immediate invalidation mechanism. `bypass: true` provides a strict uncached read for read-after-write and recovery. It does not purge other callers' bounded-stale entries. There is no global delete or generation-pointer helper because KV and per-colo cache deletion cannot provide that guarantee.

Create the factory per request. Only overlapping loaders within that request are deduplicated. The factory never shares request I/O promises across Workers requests, isolates or regions. Distinct requests can write the same KV key concurrently; KV rate limits may reject writes and those cache failures are reported. For hot mutable keys use a DO-owned read model, shorter edge-only caching, or immutable revision keys rather than assuming distributed stampede protection.

The parser is a trusted synchronous validator/decoder. Its output is returned to callers, while the JSON input returned by `load` is what the envelope stores. Project/redact sensitive fields in the loader before returning them; stripping fields only in a parser does not remove those fields from cache storage. A parser must accept the same JSON schema on both loader and cached reads.

The utility bounds cached UTF-8 reads and stored envelopes, not the authoritative loader's query/serialization memory. Keep loader results small. Named caches isolate internal envelopes from normal HTTP caching; do not route the synthetic key path to clients. Current [Workers Cache](https://developers.cloudflare.com/workers/cache/examples/) can cache inner HTTP entrypoints; this utility instead standardizes typed JSON tiering with an explicit KV backstop and a local bounded-freshness contract. [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/) does not implement stale directives itself; the envelope implements the stale policy here. [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/) and [write restrictions](https://developers.cloudflare.com/kv/api/write-key-value-pairs/) remain applicable.
