## 1.1.0

- Adds `consumeCode(env, email, code, name?)`: uses up a code and returns `{member, created}` without minting a token
  (for blocks that sign the person in another way, such as cli-oauth-login's OAuth grant). `verifyCode` is now
  `consumeCode` + `issueToken`, unchanged in behaviour.
- `e2e.json` is no longer declared in `files[]` (it was copied into projects as a doc/fixture); core allows it undeclared and the e2e harness reads it from the block directory.

## 1.0.0

- First harvest. Structure, tables, limits and routes from Ideator `auth.ts`; code hygiene from social-connector
  `email-code.ts` (uniform codes, attempt counted atomically before the compare, HKDF purpose keys).
- Fixes the Ideator finding: codes and tokens are HMAC'd with a `TOKEN_PEPPER` secret instead of plain SHA-256.
- Adds `POST <routePrefix>/logout`, a 32-character minimum for the pepper, and 501/503 when mail can't be sent.
