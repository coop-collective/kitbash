---
name: tiered-result-cache
description: Typed read-through result caching through edge Cache API, optional KV, and an authoritative loader including Durable Object RPC.
---

Create `createResultCache` once per incoming Worker request, after authentication and authorization. Pass the request origin, execution context, and optional KV binding. Its `get` accepts a trusted `{scope, tenant, version, parts}` key, freshSeconds, runtime parser and authoritative loader. The value is returned with tier and stale metadata.

The named edge Cache API stores internal JSON envelopes, not HTTP responses exposed to clients. Fresh edge hits win; fresh KV hits promote without extending expiry; misses call the loader. UTF-8 envelopes are bounded. Cache read/write failures fall through or are reported; store failures propagate and never become cached error values. Fresh-only is default. `staleSeconds` explicitly permits a bounded stale value while refresh runs in waitUntil. There is no stale serving beyond the hard deadline.

Key versioning is the invalidation mechanism. Use a revision returned by the authoritative mutation. A revision read from KV may itself be stale. `bypass: true` executes the loader with no cache reads, writes or dedupe; use it for strict read-after-write. Best-effort delete cannot safely implement distributed invalidation, so no purge helper is provided.

The factory holds request-local in-flight loader promises. It must never be module-global or reused across requests. There is no distributed request collapse. Prefer a DO-owned read model or an immutable revision for hot keys. KV's write limits and eventual consistency still apply.

Do not cache authentication, permissions, authorization decisions, revocation state, or secret-bearing results. Authorize every call before cache lookup and derive tenant/visibility keys on the server. The loader must produce bounded JSON; stored payload bounds do not constrain the upstream query's own memory use. Same key means same loader/schema/visibility; change version when any changes.

The parser validates/decodes synchronously. Cache storage contains the loader JSON, so project and redact inside the loader; parser-only field stripping is not a storage redaction boundary.
