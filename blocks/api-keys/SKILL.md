---
name: api-keys
description: Use when a Hono + D1 Worker needs long-lived prefixed API keys that people can create and revoke, stored as HMAC.
license: MIT
metadata:
  kitbash: "@coop/api-keys@1.0.1"
---

# api-keys

## What it adds

Keys `ak_live_<id8>_<secret43>`; only an HMAC (with `KEY_PEPPER`) is stored. `requireApiKey` middleware, owner-scoped
create/list/rename/revoke routes, 50-key cap, optional scope labels, optional KV verify cache.

## Interface

- Table: `api_keys` (`tablePrefix`). Routes under `routePrefix` (default `/account/keys`): GET, POST, PATCH `/:id`, DELETE `/:id`.
- Exports (`lib/api-keys/`): `requireApiKey`, `authenticateKey(env, bearer)`, `createKey`, `listKeys`, `renameKey`,
  `revokeKey`, `hasScope`, `apiKeyRoutes(ownerOf)`.
- Params: `keyPrefix`, `tablePrefix`, `routePrefix`, `cacheTtlS` (60-3600), `maxActiveKeys`, `appSlug`.
- Needs: D1 `DB`, secret `KEY_PEPPER`; optional KV `KEY_CACHE`.

## Install

Dry run, then apply. The patch adds `DB` and a `KEY_CACHE` kv entry with a placeholder id (local tests ignore it).

## Adapt

1. Set `KEY_PEPPER` (`.dev.vars`; `wrangler secret put` in production).
2. `app.use("/v1/*", requireApiKey)`.
3. Mount `apiKeyRoutes((c) => owner id or null)` behind your own sign-in.
4. Create a KV namespace for `KEY_CACHE`, or delete the `kv_namespaces` entry: no cache, same behavior, D1 read per call.

## Verify

`npx vitest run test/api-keys.test.ts` and `npx tsc --noEmit`.

## Known limits

Without `KEY_CACHE` (or when KV errors) there is no cache. With it, a revoked key can pass at other colos for up to
`cacheTtlS`. No Durable Object revoked set. Scopes are labels only; a key with none fails `hasScope`. Changing the pepper
invalidates all keys. No per-key rate limit: pair with `d1-rate-limit`.
