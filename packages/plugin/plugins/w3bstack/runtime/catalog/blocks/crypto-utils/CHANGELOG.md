# Changelog

## 2.0.0

Source payloads mirror installation paths.

### Upgrade

Use `src/lib/crypto-utils/` and the declared route paths; update imports and catalog checkouts. HTTP URLs and database migrations are unchanged.

## 1.0.0

- First harvest: encodings, SHA-256, HMAC-SHA256, HKDF and pepper-derived purpose keys, constant-time compare,
  rejection-sampled digits, random tokens and ids (from Ideator `util.ts` and social-connector `lib/crypto.ts`).
