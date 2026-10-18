# api-keys

Key format `ak_live_<id8>_<secret43>` (`keyPrefix` is a param). `id` is the public primary key (shown in a dashboard);
the 43-char base62 secret (~256 bits) is returned once by `createKey` and stored only as
`HMAC-SHA256(KEY_PEPPER, "apikey:" + secret)`. A leaked D1 dump cannot be used to test guesses without the pepper.

## Verify path

`authenticateKey(env, bearer)`: parse the id, read KV `key:<id>` when `KEY_CACHE` is bound, else D1, then compare the hash
in constant time (against a dummy on a miss, so timing does not reveal which ids exist).

## Without a KV binding

`KEY_CACHE` is optional. When the binding is absent, every verification reads D1 and nothing is written to KV. KV errors
at runtime are treated the same way (a miss on read, ignored on write and delete). Tests cover both modes and a failing KV.
To remove the cache from a project, delete the `kv_namespaces` entry the block added to `wrangler.jsonc`.

## Revocation

D1 `revoked_ms` is set first, then the KV entry is deleted. With a cache bound, another colo may still hold the entry
for up to `cacheTtlS` seconds (minimum 60). Skip the cache if that window is not acceptable. The harvested source also
told a Durable Object revoked set; that part depends on the app's DO and is not included.

## Wiring

```ts
app.use("/v1/*", requireApiKey);                                                  // c.get("apiKey").owner_id
app.route("/account/keys", apiKeyRoutes((c) => c.get("member")?.id ?? null));      // your own sign-in decides the owner
```

Scopes are labels; `hasScope(auth, "read")` is false for a key created without scopes (use `["*"]` for full access).
Pair with `d1-rate-limit` to limit per key id.
