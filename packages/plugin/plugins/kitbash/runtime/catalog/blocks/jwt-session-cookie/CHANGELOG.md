# Changelog

## 2.0.0

Source payloads mirror installation paths.

### Upgrade

Use `src/lib/jwt-session-cookie/` and the declared route paths; update imports and catalog checkouts. HTTP URLs and database migrations are unchanged.

## 1.0.0

Extract the house HKDF/HS256/version JWT cookie pattern with a strict JWT profile, uncached D1 owner state, per-token
logout revocation, hardened cookies, Origin protection and traveling workerd integration tests.
