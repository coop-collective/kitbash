# cf-analytics

Block for Hono + D1 Workers. Sends first-party analytics to a Canvalytics ingest (see the Canvalytics `DESIGN-analytics.md`, sections 3, 4.2, 4.3, 10).

## Wire format

`POST {CANVALYTICS_URL}` with headers

| Header | Value |
|---|---|
| `X-Canvalytics-Key` | the key id `ck_<id>` (the secret never travels) |
| `X-Canvalytics-Timestamp` | unix seconds |
| `X-Canvalytics-Batch` | ULID, one per chunk; reused across retries |
| `X-Canvalytics-Signature` | `v1=` + hex HMAC-SHA256(secret, `${ts}.${batch_id}.${hex sha256(body)}`) over the exact body bytes |
| `X-Canvalytics-Lib` | `cf-analytics/1.0 (<libName>)` |
| `X-Canvalytics-Trust` | `client`, only on batches with browser-path records (relay, `$identify`) |

Body `{"records":[envelope...]}`, at most 200 records and about 900 KB per request. The secret is the part after the
dot of the Worker secret `CANVALYTICS_KEY` (`ck_<id>.<secret>`).

## Transport

`transport=https` (default) posts to `CANVALYTICS_URL` with `fetch`. `transport=service-binding` posts only through
`env.CANVALYTICS.fetch(CANVALYTICS_URL, ...)` (same Cloudflare account; only the URL path matters) and drops with one
warning when the binding is missing. The block does not write the `services` entry into `wrangler.jsonc`: a service
that is not defined locally stops vitest-pool-workers from starting, so add it to the deploy config and give the
tests a stub (`miniflare.serviceBindings` in `vitest.config.ts`).

## Batching

Each invocation queues records (a `WeakMap` keyed by `ctx`), then one flush runs from `ctx.waitUntil` after a tick (or
at the end of the request when `analytics()` is mounted). 5xx, 429 and network errors are retried twice with jitter;
other 4xx drop the batch. A console warning is printed once per isolate and never includes the key.

## Vendored code

`scrub.ts` is a byte-for-byte copy of `packages/core/src/scrub.ts` from Canvalytics (WP A1); `client.ts` mirrors
`sign.ts` and `ids.ts` (same algorithms). `test/vectors/{signature,ids,scrub}.json` are copies of `packages/core/test/vectors` (the scrub file writes key-shaped
inputs with a `\u` escape on the first letter so secret scanners accept it; parsed values are identical) and
`test/analytics.test.ts` runs every case. When core changes a vector or `scrub.ts`, copy them again.

## Trust header

The ingest validates `$`-prefixed names only for client-trust records, and a relayed browser event is signed with the
server key. The block therefore marks those batches with `X-Canvalytics-Trust: client`. Records are never mixed: server
records and browser-path records go in separate batches.

## Dual-write migration from PostHog

Install beside PostHog, call both from the app's analytics module (`track` to both, `trackOnce` to PostHog plus
`fact`), point the beacon at the relay, compare daily counts for 14 days, then drop the PostHog sends.
