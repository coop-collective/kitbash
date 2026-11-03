# d1-rate-limit

Fixed-window counters in D1. `consumeRateLimit` runs one `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` statement: it
resets an expired window or counts the hit, and returns no row when the limit is already reached. There is no
read-modify-write race between isolates.

```ts
import { rateLimit, isRateLimited, getClientIp } from "./lib/d1-rate-limit/rate-limit";
app.use("/auth/*", rateLimit({ name: "auth", limit: 10, window: "15 m" }));          // by client IP
if (await isRateLimited(c.env, { name: "api", limit: 600, window: "1 m", key: keyId })) return c.json({ error: "rate_limited" }, 429);
```

## Failure policy

`ENVIRONMENT=production`: a missing `DB` binding, a missing table or any D1 error counts as limited (logged as
`rate-limit-unavailable`), so a broken limiter never opens a login to spraying. Any other value: the error is thrown, so
a forgotten migration is seen in development. The tests cover both, including dropping the table.

## Attribution

Derived from mailcheap `lib/rate-limit.js` (MIT, Copyright (c) 2026 Marc Lou; mailcheap forks marclou/mailcheap). The
license text ships in `LICENSE`; provenance is `packaged-oss`.

## Limits

Costs one D1 write per call (fine below ~50 requests per second). Fixed windows allow up to 2x the limit across a window
boundary. Without Cloudflare in front, `getClientIp` returns `"unknown"`.
