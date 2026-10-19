# Tiered result cache

This is a data-result standard for Worker services, separate from `public-edge-cache`, which handles public HTTP representations. The backing source can be **R2, D1, Durable Objects, Analytics Engine, another API, or a composition of sources**. The flow is named Cache API → optional KV → application-supplied `load(): Promise<unknown>`. Supply a synchronous `parse` function to validate the returned JSON projection.

## Choosing a loader

| Source | Example loader result | Key and freshness considerations |
| --- | --- | --- |
| [D1](https://developers.cloudflare.com/d1/worker-api/prepared-statements/) | A row from a tenant-scoped prepared query, bounded `results` from `all()`, or an aggregate | Include query identity and every result-changing parameter. For revision-based invalidation, check the expected revision in the same query/snapshot as the returned data. |
| [R2](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) | A small JSON document, manifest, or plain metadata projection from an object | Include bucket/object identity. For revision-based invalidation, use the expected object version/ETag and verify it against the object actually loaded; retry if it changed. |
| [Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/) | A JSON projection returned by an RPC method | Derive the DO identity from the verified tenant. Check an expected revision inside the method that produces the projection; the example below demonstrates this. |
| [Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/) | A bounded aggregate or report returned by an authenticated SQL query | Include account/dataset identity, query version, tenant filters, dimensions and explicit time-window bounds. Match those bounds in the query; a moving window needs an explicit refresh policy. |
| Other APIs or composed reads | A small JSON projection from a service binding, HTTP client, or multiple sources | Include all visibility/query inputs. A composed loader must define how its source versions relate; the cache does not create a cross-source snapshot. |

These are integration patterns for the same loader contract. The shipped end-to-end fixture exercises DO RPC/SQLite, Cache API and KV; dedicated R2, D1 and Analytics Engine loader fixtures are not included.

Use `version` as an authoritative data generation when implementing revision-based invalidation. For TTL-based queries without a data generation, use a query/schema version such as `report-v1` and accept the declared freshness window; that version alone does not invalidate data after writes. Canonicalize query parameters before forming `parts`, and hash large parameter sets to stay within the key bounds. Tenant scoping must constrain the source query as well as the cache key.

R2 loaders must project metadata into plain JSON or read a size-limited JSON body. Convert dates to strings and binary metadata to an explicit JSON representation. `R2ObjectBody`, `Response`, streams and large binary objects are not result-cache payloads. Bound the source read before parsing; the cache's envelope limit is applied after the loader returns.

Analytics Engine's `writeDataPoint` binding records events; cache the output of a query loader, never event writes. Keep query credentials in server-side secrets, reject unsuccessful query responses, constrain query construction to trusted templates/validated inputs, and bound rows and response bytes. Cached aggregates retain the query's sampling semantics; choose sampling-aware SQL where needed. A TTL or time bucket does not establish that ingestion is complete.

`bypass: true` forces the loader to run, but cannot strengthen the backing source's consistency, replica/session guarantees or ingestion freshness. A source failure must throw; avoid turning a failed query into an apparently successful empty report that could be cached.

## Durable Object example

```ts
// Authentication and current access checks have already completed.
const store = env.CATALOGS.getByName(JSON.stringify([member.organizationId, catalogId]));
const revision = await store.revision(); // authoritative generation, not a KV-cached pointer
const cache = createResultCache({
  origin: new URL(request.url).origin,
  context: ctx,
  kv: env.RESULT_CACHE, // optional
});
const result = await cache.get({
  key: { scope: 'catalog-summary', tenant: member.organizationId, version: String(revision), parts: [catalogId] },
  freshSeconds: 30,
  parse: parseCatalogSummary, // unknown -> validated CatalogSummary
  load: () => store.summary(revision), // DO atomically checks that the expected revision still matches
});
return Response.json(result.value, { headers: { 'cache-control': 'private, no-store' } });
```

Every call is authorized before entering the cache. Tenant is derived from the verified session; include user/role/projection visibility in the key if representations differ within a tenant. Do not cache auth, permission checks, revocation state, balances, secrets or other immediately consistent decisions. The helper never selects HTTP caching headers for your response.

KV is optional. The installer adds a `RESULT_CACHE` placeholder declaration; for edge-only use, remove that unused KV declaration from Wrangler configuration and omit `kv` from the factory options. No KV namespace needs to be provisioned. To use an existing namespace, pass its binding as `kv` and remove the unused placeholder declaration.

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

For revision-based invalidation, move to a new authoritative version/revision key. Old in-flight loads can only fill their old version. Obtain the revision from an authoritative mutation or read when immediate freshness matters; a KV-cached revision pointer is not an immediate invalidation mechanism. `bypass: true` provides a strict uncached loader call for read-after-write and recovery, subject to the source's own consistency guarantees. It does not purge other callers' bounded-stale entries. There is no global delete or generation-pointer helper because KV and per-colo cache deletion cannot provide that guarantee.

When the version key identifies a data snapshot, the loader must return that snapshot. If the store changes between reading its revision and loading its data, reject that load and retry with a new authoritative revision. The [DO fixture](../../../recipes/tiered-result-cache-do/README.md) implements that check with one bounded retry; it never stores a new snapshot under an old revision.

Create the factory per request. Only overlapping loaders within that request are deduplicated. The factory never shares request I/O promises across Workers requests, isolates or regions. Distinct requests can write the same KV key concurrently; KV rate limits may reject writes and those cache failures are reported. For hot mutable keys use a DO-owned read model, shorter edge-only caching, or immutable revision keys rather than assuming distributed stampede protection.

The parser is a trusted synchronous validator/decoder. Its output is returned to callers, while the JSON input returned by `load` is what the envelope stores. Project/redact sensitive fields in the loader before returning them; stripping fields only in a parser does not remove those fields from cache storage. A parser must accept the same JSON schema on both loader and cached reads.

The utility bounds cached UTF-8 reads and stored envelopes, not the authoritative loader's query/serialization memory. Keep loader results small. Named caches isolate internal envelopes from normal HTTP caching; do not route the synthetic key path to clients. Current [Workers Cache](https://developers.cloudflare.com/workers/cache/examples/) can cache inner HTTP entrypoints; this utility instead standardizes typed JSON tiering with an explicit KV backstop and a local bounded-freshness contract. [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/) does not implement stale directives itself; the envelope implements the stale policy here. [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/) and [write restrictions](https://developers.cloudflare.com/kv/api/write-key-value-pairs/) remain applicable.
