---
name: cf-analytics
description: Use when a Hono Worker should send first-party analytics (signed server events, exact facts, logs, browser events through a relay) to a Canvalytics ingest instead of a hosted vendor.
license: MIT
metadata:
  kitbash: "@coop/cf-analytics@1.0.0"
---

# cf-analytics

## What it adds

`<paths.lib>/analytics/{client,track,scrub,middleware,relay,snippet}.ts`, a test, `CANVALYTICS_URL` and
`CANVALYTICS_PROJECT` vars in `wrangler.jsonc`, and `CANVALYTICS_KEY=` in `.dev.vars.example`. No tables.

## Interface

- `track(env, ctx, name, props?, who?)`: behaviour/usage event. `log(env, ctx, level, name, body, props?)`.
- `fact(env, ctx, name, { user_id, subject?, props? })`: exact business fact; id is `uuid5(project, "name:subject")`
  (subject defaults to `user_id`), so retries and backfills never double count. Returns the id.
- `identify(env, ctx, { anon_id, user_id })`; `flush(env, ctx?)` for crons and queue consumers.
- `analytics()` middleware: `c.var.analytics = { anon_id?, user_id?, dnt }`, cookie `ca` set once, nothing under DNT/GPC.
- `handleRelay`: `POST <relayPath>` (default `/e`): allowlisted names and props, 4 KB cap, 204/400/403/413, trust client.
- `CLIENT_SNIPPET` (under 1 KB, same-origin only): `$pageview`, `data-track` clicks, `window.__track`.
- Names `^[a-z][a-z0-9_]{0,63}$`; `$` names only come from the browser path. Props are scrubbed (denylist, emails,
  IPs, keys, cards) before they leave. Nothing throws; failures drop events after two retries.
- Params: `ingestUrl`, `projectId`, `keySecretName`, `relayPath`, `cookieName`, `clientEvents`, `clientProps`,
  `transport` (`https` | `service-binding`), `ingestService`, `libName`.

## Install

`kit install @coop/cf-analytics --param ingestUrl=https://ingest.<host>/v1/ingest --param projectId=prj_...`

## Adapt

1. `app.use("*", analytics()); app.post("<relayPath>", handleRelay)`; type the app
   `new Hono<{ Bindings: Env; Variables: AnalyticsVariables }>()` to read `c.var.analytics`.
2. Set `CANVALYTICS_URL`, `CANVALYTICS_PROJECT`; `wrangler secret put CANVALYTICS_KEY` (the `ck_` server key, shown once);
   same value in `.dev.vars`. `transport=service-binding`: add the `CANVALYTICS` services binding to the deploy
   config yourself (not auto-added: a missing local service stops vitest-pool-workers) and stub it in tests.
3. Call `fact(c.env, c.executionCtx, "signup", { user_id })` at signup, activation, first_call, conversion.
4. Inline `CLIENT_SNIPPET` in a page script; set `c.get("analytics").user_id` after your session check.

## Verify

`npx vitest run test/analytics.test.ts` and `npx tsc --noEmit`.

## Known limits

- The ingest must accept `X-Canvalytics-Trust: client` batches (relay and `identify`); this header is the block's
  convention until Canvalytics documents another.
- No rate limit on the relay; add `d1-rate-limit` if it is public and busy. SPA route changes need `__track`.
- Server key is the only secret; never put it in a var or send it to the browser.
