## 1.0.0

- First harvest. Structure, tables, limits and routes from Ideator `auth.ts`; code hygiene from social-connector
  `email-code.ts` (uniform codes, attempt counted atomically before the compare, HKDF purpose keys).
- Fixes the Ideator finding: codes and tokens are HMAC'd with a `TOKEN_PEPPER` secret instead of plain SHA-256.
- Adds `POST <routePrefix>/logout`, a 32-character minimum for the pepper, and 501/503 when mail can't be sent.
