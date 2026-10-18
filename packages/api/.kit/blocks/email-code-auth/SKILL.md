---
name: email-code-auth
description: Use when a Hono + D1 Worker needs passwordless email-code sign-in (sign-up included) and opaque, revocable bearer tokens for apps, CLIs or MCP clients.
license: MIT
metadata:
  kitbash: "@coop/email-code-auth@1.1.0"
---

# email-code-auth

## What it adds

- Migration `NNNN_auth.sql`: `<tablePrefix>members`, `<tablePrefix>member_tokens`, `<tablePrefix>login_codes`
  (times in epoch ms).
- `<paths.lib>/auth/{types,tokens,codes,middleware}.ts`, `<paths.routes>/auth.ts`, `<paths.tests>/auth.test.ts`.
- `wrangler.jsonc`: a D1 `DB` binding if missing. `.dev.vars.example`: `TOKEN_PEPPER=`.
- Requires blocks `crypto-utils` (`<paths.lib>/crypto.ts`) and `cf-email-sender` (`<paths.lib>/mail.ts`): install them
  first.

Security model: codes are 6 uniform digits, valid `codeTtlMin` minutes, single use, 5 guesses (each counted in the
same UPDATE that selects the code, before the compare). Codes and tokens are stored only as HMAC-SHA256 under keys
derived (HKDF) from the `TOKEN_PEPPER` secret per purpose, so a D1 dump alone can't be brute-forced. Sending is capped at
5 per address per hour and 200 per 10 minutes overall; over a cap the reply is identical and no mail goes out.

## Interface

- `POST <routePrefix>/email/start {email}` → 200 `{ok}`; 400 `bad_email`; 500/501 `not_configured`; 503 `mail_failed`.
- `POST <routePrefix>/email/verify {email, code, label?, name?}` → 200 `{token, member, created}`; 401 `invalid_code`.
- `POST <routePrefix>/logout` (bearer) revokes the calling token. `GET /api/me` (bearer) → `{member}`.
- Exports: `requireBearer` (sets `member`, `tokenId`; 401 with `WWW-Authenticate`), `authenticate(env, token)`,
  `resolveBearer`, `issueToken(env, memberId, label)`, `revokeToken`, `revokeTokenId`, `upsertMember`, `startCode`,
  `verifyCode` (code → token), `consumeCode` (code → `{member, created}`, no token), `authRoutes`, `meRoutes`, `AuthEnv`, `Member`, `AuthError`, `TOKEN_PREFIX`, `TOKEN_RE`.
- Tokens: `<tokenPrefix>` + 43 base64url chars.

## Install

```
kit install ./crypto-utils --apply
kit install ./cf-email-sender --param appName="Acme" --param appDomain=acme.dev --apply
kit install @coop/email-code-auth --param tokenPrefix=ac_     # dry run; read the diff, then kit apply <plan_id>
```

A `members` (or `login_codes`, `member_tokens`) table already in the project is reported as a `table` conflict:
rerun with `--param tablePrefix=auth_`.

## Adapt

1. Mount: `app.route("<routePrefix>", authRoutes); app.route("/", meRoutes);` in `<paths.app>/index.ts`.
2. Protect: `app.use("/api/*", requireBearer)`; read `c.get("member")`.
3. Secret: `TOKEN_PEPPER` (32+ chars) in `.dev.vars`; `wrangler secret put TOKEN_PEPPER` for production.
4. Mail: see cf-email-sender (onboard the domain, `ENVIRONMENT=production` when deployed). In dev the code is printed.

## Verify

`npx vitest run test/auth.test.ts` (the full scenario, races, limits, pepper checks) and `pnpm typecheck` (includes
a compile check of the adapt wiring against the generated `Env`).

## Known limits

- No cookie sessions, no OAuth providers, no per-IP limit (add a rate-limit block in front of `/email/start`).
- Codes are per address, not per device: a newer code replaces the older one.
- Rotating `TOKEN_PEPPER` invalidates every token and pending code.
- No cleanup cron for old `login_codes` rows; delete rows older than a day if the table grows.
