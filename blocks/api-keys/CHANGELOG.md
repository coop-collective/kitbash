## 1.0.0

- First release, harvested from inference-market `packages/web/src/keys.ts` and `auth/crypto.ts`.
- Removed the account, buyback, Elite-tier and OAuth coupling: keys belong to an opaque `owner_id`; scopes are optional labels (`hasScope`).
- The KV cache is optional: without a `KEY_CACHE` binding (or when KV errors) every call reads D1. Tested both ways.
- The Durable Object revoked set is not included; revoke busts the KV entry and other colos catch up within `cacheTtlS`.
