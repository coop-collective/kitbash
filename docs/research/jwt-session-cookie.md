# JWT session cookie extraction

Reviewed canonical repositories read-only on 2026-10-19. No environment files, secret stores, worktree variants,
dependency copies or security-scan clones were used. The block is a new independent feature; the existing opaque
`session-cookie` block remains available.

## Local evidence

| Source | Exact revision and paths | Adopted or excluded |
| --- | --- | --- |
| mailcheap (golden) | `6fd333e2b9a66d65785958de40061afa72fa6059`: `lib/session-token.js`, `lib/auth.js`, `tests/session-token.test.mjs` | HKDF-SHA256 purpose separation, HS256 via jose, explicit algorithm allowlist, seven-day default, version invalidation, hardened cookie deletion, key-rotation tests. |
| platform (alternate) | `8f8ed9c2a44507490912f8631806664c724be767`: `packages/website/src/lib/jwt.ts` | Confirms the repeated Worker-compatible JWT wrapper. Generic arbitrary-payload signing, raw shared keys, missing application-specific required claims and caller-owned expiry are unsuitable as a portable browser session contract. |
| Kitbash inventory | `docs/HARVEST.md`, row 13 | Originally grouped the opaque and JWT families. Separate blocks keep these token formats and lifecycle requirements explicit. |

Sources: [mailcheap token service](https://github.com/coop-collective/mailcheap/blob/6fd333e2b9a66d65785958de40061afa72fa6059/lib/session-token.js),
[mailcheap tests](https://github.com/coop-collective/mailcheap/blob/6fd333e2b9a66d65785958de40061afa72fa6059/tests/session-token.test.mjs),
[mailcheap cookie adapter](https://github.com/coop-collective/mailcheap/blob/6fd333e2b9a66d65785958de40061afa72fa6059/lib/auth.js),
[platform JWT adapter](https://github.com/null-shot/platform/blob/8f8ed9c2a44507490912f8631806664c724be767/packages/website/src/lib/jwt.ts).

Mailcheap derives its version from the current admin email/password and caches only the derived signing key. This
extraction replaces those single-admin environment fields with a D1 owner version/disabled row, checked on every
request. Version rotation must be wired into the host's credential/account lifecycle. It also adds a bounded-expiry
token-id denylist so browser logout actually revokes a copied JWT. The source clears the browser cookie but does not
provide per-token server revocation. The extraction does not claim wire compatibility with either source.

## Current primary references

- [JWT BCP, RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html): enforce a fixed algorithm and distinguish token
  kinds using type, issuer, audience, required claims and separate keys. Do not use a human password as an HS256 secret.
- [jose JWT verification options](https://github.com/panva/jose/blob/main/docs/types/interfaces/JWTClaimVerificationOptions.md)
  and [SignJWT](https://github.com/panva/jose/blob/main/docs/jwt/sign/classes/SignJWT.md): issuer/audience/type checks,
  required claims, maximum age and explicit current time. The selected dependency is `jose@^6.2.12`, verified against
  the npm package on the review date; the installer locks the concrete resolved dependency in the target project.
- [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/): native HKDF and HMAC support.
- [D1 Sessions API](https://developers.cloudflare.com/d1/worker-api/d1-database/#withsession): `first-primary` directs
  the first query to the primary. A fresh session for each combined authorization query avoids a stale replica read.
- [Fetch Origin behavior](https://fetch.spec.whatwg.org/#append-a-request-origin-header): form hosts must preserve
  same-origin referrer information for strict Origin checks; the block does not install a global referrer policy.

The JWT claim choices, D1 tables and host lifecycle boundary are extraction decisions, not claims that the sources
already implement this exact combined design. No source-provided account privileges are cached or copied into JWTs.

## Verification and limits

The block's traveling tests cover HKDF/raw-key/purpose separation, algorithm/type/claim confusion, tampering, cookie
bounds and duplicate names, exact expiry, logout, same-second version rotation, disable/re-enable, primary queries,
database failure, cleanup and mounted Origin checks. Default and alternate table/route/cookie/TTL parameters run
through the real standalone Hono/D1 installer and verifier.

Passed validation:

- `node packages/cli/src/kit.ts validate blocks/jwt-session-cookie`: no blocking findings or warnings.
- `KIT_E2E_ONLY=jwt-session-cookie pnpm --filter @kitbash/test-e2e test:e2e`: 2/2 standalone installs passed,
  zero skips; each install runs 13 workerd tests and the TypeScript check using the generated Worker binding types.

No source application was changed or deployed. Workerd tests inspect cookie headers; actual browser enforcement and
the host's login/recovery/suspension flows are outside this block. Local D1 cannot model geographic replica lag.
Requests already authorized before a revocation can complete; credential changes and account state need consistent
host lifecycle hooks. JWTs are signed, not encrypted, and this block intentionally provides no OAuth/refresh service.
