# cli-oauth-login

Lets a person's own CLI (Claude Code, Codex, Cursor, Grok, any MCP client) sign in with their account through the
browser, OAuth 2.1 with PKCE, instead of pasting a token. Each approval is a row in `cli_logins` that the person can
revoke; a revoke signs that CLI out on its next call and its refresh token stops working.

## How a sign-in goes

1. The CLI calls your protected route (default `/mcp`) with no token and gets `401` with
   `WWW-Authenticate: Bearer … resource_metadata=".../.well-known/oauth-protected-resource/mcp"`.
2. It discovers the authorization server, registers itself (`POST /oauth/register`), and opens
   `/authorize?…&code_challenge=…` in the browser on a loopback redirect (`http://127.0.0.1:<port>/callback`).
3. The person signs in (a pasted bearer token, or an email code) and sees "Sign in Claude Code on your computer?".
4. Approve makes the `cli_logins` row and redirects with a code; the CLI exchanges it with its PKCE verifier.
5. Every call with the access token re-checks the row, then reaches your app as that person
   (`requirePerson` sets `c.get("member")`).

Bearers with your own token prefix (the desktop app's tokens) never go through OAuth.

## Branding

The pages are `src/lib/oauth/templates/*.html`. `brandName` and `brandColor` are filled at install; edit the HTML freely
afterwards. Placeholders at runtime: `{{name}}` (escaped), `{{{name}}}` (raw, only HTML built by `pages.ts`),
`{{#name}}…{{/name}}` and `{{^name}}…{{/name}}`.

## Configuration

| What | Where |
|---|---|
| `OAUTH_KV` KV namespace | `wrangler.jsonc` (patched with a placeholder id) |
| `PUBLIC_ORIGIN` | `vars`, production: the origin tokens are bound to |
| `remoteClients` | param: `warn` (default) or `refuse` redirects that are not this computer |
| `emailSignIn` | param: offer email codes on the authorize page |

## Origin

Harvested from Ideator (`packages/api/src/oauth.ts`, `cli-logins.ts`), where it signs CLIs in to the HQ MCP server.
