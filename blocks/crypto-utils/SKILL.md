---
name: crypto-utils
description: Use when Worker code must keyed-hash a secret (codes, tokens, API keys) with a pepper, compare secrets in constant time, or mint unbiased codes, tokens and ids.
license: MIT
metadata:
  kitbash: "@coop/crypto-utils@1.0.0"
---

# crypto-utils

## What it adds

One file, `<paths.lib>/crypto.ts`, with no dependencies (WebCrypto only), and its test.

## Interface

- `peppered(secret, purpose, message)`: HMAC-SHA256 hex under a key derived from `secret` with HKDF for `purpose`.
  Use one purpose string per use (`"login-code/v1"`, `"bearer-token/v1"`). `purposeKey(secret, purpose)` returns the
  `CryptoKey` (cached per isolate).
- `hmacSha256Hex(key, message)`, `sha256Hex(input)`, `hkdf(ikm, salt, info, length)`.
- `timingSafeEqual(a, b)`: async; hashes both sides, so neither content nor length leaks through timing.
- `randomDigits(n)` (rejection-sampled, no modulo bias), `randomToken(bytes = 32)` (base64url, 43 chars),
  `newId(prefix)` (`prefix_` + 16 hex; row ids, not secrets).
- `toHex`, `fromHex`, `base64url`, `fromBase64url`, `utf8`.

No tables, routes, bindings, env or params.

## Install

`kit install @coop/crypto-utils` (dry run), then `kit apply <plan_id>`. Two files are created; nothing is patched.

## Adapt

Import from the module with a relative path. Keep secrets (peppers) in Worker secrets, never in code or `vars`.

## Verify

`npx vitest run test/crypto.test.ts` (known-answer vectors from FIPS 180-2, RFC 4231, RFC 5869) and `pnpm typecheck`.

## Known limits

- Not for passwords: HMAC is fast by design. Use a slow KDF for anything a person chooses.
- No encryption (AES-GCM) or signatures (Ed25519) in this version.
- `timingSafeEqual` needs `crypto.subtle.timingSafeEqual` (Workers runtime; Node has `crypto.timingSafeEqual`).
