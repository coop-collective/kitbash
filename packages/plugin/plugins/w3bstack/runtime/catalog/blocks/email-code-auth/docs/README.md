# email-code-auth

Passwordless sign-in for a Hono Worker on D1: a person asks for a code by email, types it in, and gets an opaque
bearer token for the API. The first verified code creates the account.

Depends on two smaller blocks: `crypto-utils` (HMAC, HKDF, constant-time compare, uniform digits) and
`cf-email-sender` (Cloudflare Email Service, printed in dev).

Why a pepper: Ideator stored `sha256(email:code)`. With a database dump, a six-digit code falls in a million
hashes, well inside its ten-minute life. Here every code and token hash is an HMAC under a key derived from the
`TOKEN_PEPPER` Worker secret, which never lives in D1.

Harvested from Ideator (`packages/api/src/auth.ts`, `index.ts`, `migrations/0001_schema.sql`, `test/auth.test.ts`)
and social-connector (`telegram-connector/src/auth/email-code.ts`). See `SKILL.md` for the contract.
