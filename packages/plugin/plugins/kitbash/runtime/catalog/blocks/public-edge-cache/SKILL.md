---
name: public-edge-cache
description: Explicit Cache API fallback for public GET representations behind an always-executed Worker gateway.
---

Adds `withPublicEdgeCache(request, ctx, policy, produce)` and `publicCacheKey`.

Use when an existing Worker needs explicit per-colo Cache API control after its gate runs. Prefer current Workers Cache and cached inner entrypoints for new designs that can use them. This fallback has no tiered caching, stale serving, distributed request collapse or global purge.

Adapt: call after access checks. Supply exact public paths, every accepted query key, a representation version and TTL. The producer must return the same representation for every allowed request header and must explicitly return `public, max-age=N`. Cookies, authorization, range/conditional requests, unknown queries, duplicated queries, Set-Cookie, Vary and private responses bypass caching. Never remove these guards to cache user-specific content.

Change the policy version after representation changes. Existing entries expire locally. TTL is bounded by both policy and origin directives. Tests exercise workerd's actual cache plus negative cases. Cache read/write failures serve the producer response. Writes use waitUntil and streams; very large responses still require application-specific size policy because cloning tees the body.

The TTL cap also applies to the initial eligible response sent to the client, so a long origin max-age cannot outlive the configured policy in downstream caches.
