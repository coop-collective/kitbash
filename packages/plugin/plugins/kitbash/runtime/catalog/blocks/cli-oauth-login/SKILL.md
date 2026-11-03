---
name: cli-oauth-login
description: Use when a Hono + D1 Worker should let a person's own CLI or MCP client sign in with their account over OAuth 2.1 (browser, PKCE) instead of a pasted token, with revocable per-CLI grants.
license: MIT
metadata:
  kitbash: "@coop/cli-oauth-login@2.0.0"
---

# cli-oauth-login

## What it adds

An OAuth 2.1 authorization server on `@cloudflare/workers-oauth-provider` (RFC 8414/9728 metadata, dynamic client
registration, client metadata documents, PKCE S256, refresh tokens) in front of your Hono app, plus:

- `/authorize`: sign in (paste a bearer token, or an email code when `emailSignIn`), then a consent page
  "Sign in <client> on your computer?". The pages are HTML template files (`lib/cli-oauth-login/templates/*.html`) with
  `brandName` and `brandColor`.
- `cli_logins`: one row per approval. The grant's userId is the row id; every call on the API route re-checks the row,
  so `DELETE /api/cli-logins/:id` signs that CLI out at once and kills its refresh token.
- `oauthWorker(app)`: bearers with your own `tokenPrefix` skip OAuth (desktop apps keep working); everything else goes
  through the provider; an OAuth caller reaches the app with `env.OAUTH_CALLER` set.
- `requirePerson`: accepts either an OAuth caller or your bearer; `c.get("member")` is the person.

## Interface

- Table: `<tablePrefix>cli_logins` (FK to email-code-auth's `<authTablePrefix>members`).
- Routes: `GET|POST /authorize`, `POST /authorize/signin/{token,email,code}`, provider routes `/oauth/register`,
  `/oauth/token`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource<apiRoute>`, the
  protected `<apiRoute>` (default `/mcp`), `GET /api/cli-logins`, `DELETE /api/cli-logins/:id`.
- Exports: `oauthWorker`, `requirePerson`, `oauthRoutes`, `cliLoginRoutes`, `revokeCliGrants`, `cliMember`.
- Needs: `@coop/email-code-auth` >= 2.0 installed first (`authenticate`, `requireBearer`, `startCode`,
  `consumeCode`, its members table); D1 `DB`; KV `OAUTH_KV`; optional var `PUBLIC_ORIGIN`.
- Params: `tokenPrefix` and `authTablePrefix` must equal email-code-auth's `tokenPrefix` and `tablePrefix`.

## Install

Install email-code-auth first. Dry run, then read the `wrangler.jsonc` hunk (adds `kv_namespaces` OAUTH_KV) and the
`package.json` patch (adds `@cloudflare/workers-oauth-provider`); run the package manager's install afterwards.

## Adapt

All in `src/index.ts`:

1. `app.route("/", oauthRoutes); app.route("/api", cliLoginRoutes);`
2. `app.all("/mcp", requirePerson, handler)` (your MCP or API handler; `c.get("member")`, `c.get("cliLogin")`).
3. `export default oauthWorker(app);` instead of `export default app`.
4. Production: `wrangler kv namespace create OAUTH_KV`, put the id in `wrangler.jsonc`, set `PUBLIC_ORIGIN`.

`lib/cli-oauth-login/identity.ts` is the only file that imports the auth block; change it if yours names things differently.

## Verify

`npx vitest run test/cli-oauth.test.ts` (the full browser flow scripted in workerd: register, sign in, consent, PKCE
exchange, API call, refresh, revoke) and `npx tsc --noEmit`.

## Known limits

- Signs in the person, not a limited agent identity: an approved CLI has the person's full access. Cloud agents with
  their own scopes (Ideator's agent_identities) are not included.
- No per-client rate limit on the API route; add `d1-rate-limit` if you need one.
- Over plain http only localhost can do OAuth; anything else needs https or `PUBLIC_ORIGIN`.

Browser sign-in POSTs require the exact same-origin Origin before sending/consuming a code or creating a cookie.
Missing, foreign and opaque origins return 403. Pages use Referrer-Policy: same-origin so native forms retain
their Origin while external redirect destinations receive no referrer. Preserve this policy when adapting templates.
