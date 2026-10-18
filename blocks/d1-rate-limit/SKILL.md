---
name: d1-rate-limit
description: Use when a Hono + D1 Worker needs shared rate limits (login, code sending, API keys) that fail closed in production.
license: MIT
metadata:
  kitbash: "@coop/d1-rate-limit@1.0.1"
---

# d1-rate-limit

## What it adds

One table and `src/lib/rate-limit.ts`: an atomic fixed-window counter in D1, a `rateLimit` Hono middleware (429 +
`Retry-After`), `isRateLimited`, `consumeRateLimit`, `getClientIp`, `purgeExpired`. Ported from mailcheap (MIT, Marc Lou).

## Interface

- Table: `rate_limits` (`tablePrefix` to rename). No routes.
- Exports: `rateLimit({name, limit, window, key?})`, `isRateLimited(env, {name, limit, window, key})`, `consumeRateLimit(db, opts)`,
  `getClientIp(headers)`, `purgeExpired(db)`. Window is `"15 m"`: ms, s, m, h or d.
- Needs: D1 binding `DB`; var `ENVIRONMENT` (`"production"` makes it fail closed).

## Install

Dry run, then apply. The wrangler patch only adds a `DB` binding when missing. Set `tablePrefix` if the project has a
`rate_limits` table.

## Adapt

1. Set `ENVIRONMENT=production` in the production vars.
2. Put `rateLimit({ name, limit, window })` in front of abuse-prone routes; pass `key` to limit by key or member.
3. Optional: cron that calls `purgeExpired(env.DB)`.

## Verify

`npx vitest run test/rate-limit.test.ts` and `npx tsc --noEmit`.

## Known limits

Production: missing table, missing DB or any D1 error means limited (429). Other environments throw so the missing
migration is noticed. One D1 write per call. Fixed windows allow up to 2x across a boundary. No sliding window.
Behind a non-Cloudflare proxy `getClientIp` is `"unknown"`: pass your own key.
