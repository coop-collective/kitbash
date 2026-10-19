# Public edge cache

An installable Cache API fallback for an always-executed Worker gateway. New applications should first consider [Workers Cache](https://developers.cloudflare.com/workers/cache/) and its cached inner entrypoints. Use this block when the application's pinned runtime or explicit local-cache ownership requires the Cache API.

```ts
return withPublicEdgeCache(request, ctx, {
  version: 'v1',
  routes: { '/catalog': ['page', 'q'] },
  ttlSeconds: 30,
}, () => app.fetch(request, env, ctx));
```

Run the gate before calling the helper. Only list handlers whose body and headers do not depend on identity, language, Origin, experiments or other omitted request headers. A `public` directive is a contract, not proof that a handler is safe. Cookie and Authorization requests bypass even if their route could return public data.

Response storage requires status 200, explicit `public` with numeric max-age or s-maxage, no Set-Cookie, no Vary, no private/no-store/no-cache. The minimum of every supplied age and the policy cap wins. Unknown and duplicate query keys bypass; values are never truncated. Cache keys preserve origin and canonicalize query order.

No global invalidation, tiered caching, stampede lock or stale-while-revalidate. Change the representation version for new content; old keys age out. Read/write failure falls back to origin. Streams are cloned, not eagerly buffered; applications must still bound large responses. The actual Workers cache integration is covered by the traveling tests.

The TTL cap also applies to the initial eligible response sent to the client, so a long origin max-age cannot outlive the configured policy in downstream caches.
