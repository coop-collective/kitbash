---
name: email-code-auth-fixture
description: Use when a Hono + D1 Worker needs passwordless email-code sign-in and opaque bearer tokens.
license: MIT
metadata:
  kitbash: "@coop/email-code-auth-fixture@1.3.0"
---

# email-code-auth (fixture)

## What it adds

Six-digit email codes (HMAC-stored, single use, 5 attempts, 5 per address per hour, 200 per 10 minutes overall) and
opaque bearer tokens (HMAC-stored, revocable), plus a `requireBearer` Hono middleware.

## Interface

- Tables: `members`, `member_tokens`, `login_codes` (prefix with `tablePrefix`).
- Routes: `POST <routePrefix>/email/start`, `POST <routePrefix>/email/verify`, `GET /api/me`.
- Exports: `requireBearer`, `authenticate`, `authRoutes`, `meRoutes`.
- Needs: D1 binding `DB`, secret `TOKEN_PEPPER`; optional `EMAIL` send binding and `MAIL_FROM`.

## Install

Dry run first; read the config-patch hunks (wrangler.jsonc, .dev.vars.example). Set `tablePrefix` if the project
already has a `members` table.

## Adapt

1. Mount `authRoutes` at `routePrefix` and `meRoutes` at `/`.
2. Put `requireBearer` in front of protected routes.
3. Set `TOKEN_PEPPER` in `.dev.vars`.

## Verify

`npx vitest run test/auth.test.ts` and `npx tsc --noEmit`.

## Known limits

No sessions or cookies, no OAuth providers; codes are per address, not per device.
