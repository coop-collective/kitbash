# Browser performance regression recipe

A local Chromium → real Worker fixture and reusable probe for regressions that functional tests miss: repeat asset downloads, redundant queries, and a loading screen stuck after response headers arrive. It also collects LCP and **maximum CLS session windows**, excluding recent user input. It does not sum layout shifts over a page's lifetime.

```sh
cd recipes/browser-performance
pnpm install
pnpm exec playwright install chromium
pnpm test
pnpm test:e2e
```

The recipe is a root workspace member. For standalone use, install once and commit that project's lockfile; CI uses `pnpm install --frozen-lockfile`. Linux CI needs `pnpm exec playwright install --with-deps chromium`. `E2E_PORT` defaults to 8798. The launcher binds only loopback, runs Wrangler locally and refuses an existing server. The fixture has no remote bindings, deployment command, real identities or product data. Its deliberately bad modes belong only in tests.

## What is actually proved

- Desktop and mobile viewport cases use a fresh browser context that downloads the selected script on its cold visit. A second navigation in **the same context with browser cache enabled** transfers zero bytes for that exact asset and requests state once.
- A known-bad `no-store` asset fails that same budget. A three-request burst fails a one-request budget. These negative controls prove the checks can fail.
- A response whose headers and partial JSON arrive but whose body completes after the client deadline reaches an explicit error state after a deadline. A button retries in the same document and recovers, proving the failed in-flight promise was removed. Adapt the same assertion to your application's prefetch/query map.
- Unit tests exercise CLS session gaps/maximum duration and missing-data failures. Browser samples are laboratory measurements, not field percentiles or INP. No synthetic interaction is labelled field INP.

The fixture dependency versions match the existing Worker browser recipe: Playwright 1.64.1 and Wrangler 4.137.0. The compatibility date is the pinned runtime's supported 2026-09-28. No vinext APIs are imported: the same probe can target a locally served vinext production build, but this fixture alone does not verify that framework's hydration or caching behavior. See the vinext diagnostics recipe for its separate compatibility checks.

## Adopt in an application

Copy `scripts/probe.mjs` and `scripts/metrics.mjs`, then adapt the Playwright journey and launcher to the actual **production build running in workerd**. Keep the application's authorization and cache policy. A zero-byte hit is checked only for explicitly selected same-origin assets with a resource entry; a missing resource never passes as a cache hit. Do not use Playwright routing during cache tests: routing disables the HTTP cache.

1. Give `createProbe` fixed asset/API paths with safe metric names; parameterize environment ports in your launcher. The probe deliberately rejects non-loopback targets. Hosted testing needs a separately reviewed credentials, gate and retention policy.
2. Install the probe before navigation. Call `reset()` before each measured navigation; wait for the app's explicit ready/error contract, then `markReady()`. `readyMs` measures when the test observed that contract, not an exact internal paint time. Keep an observation window for deferred requests. Await visibility and observer delivery before evaluating LCP/CLS.
3. Establish budgets from repeated samples on a stated viewport, CPU and network profile; record exact commit/build identity alongside sanitized numeric summaries. Change fixture defaults to representative product data and query cardinality. Set separate cold/warm budgets per route and user state; do not compare cold desktop with warm mobile.
4. Include desktop/mobile, direct/client navigation, first-time/returning/signed-in users, hidden/visible tabs and real WebSocket closure/reconnect in the product journeys. Verify convergence and bounded refetches. Offline emulation alone may leave WebSockets connected. These lifecycle cases are **not implemented by the minimal fixture**.
5. Add auth-isolation and content-hash/status/MIME/cache-header checks for your actual asset handler, including GET, HEAD, conditional requests, missing files and HTML fallbacks. Never loosen a gate just to improve browser cache numbers.
6. Correlate slow API requests with Worker/D1 telemetry. Browser request duration is not SQL execution time. Preserve source freshness and correctness when reducing requests.

The probe records only named counts, byte totals, numeric metrics and exception counts. It never retains resource URLs, query strings, credentials, response data, DOM text or exception messages. Traces, screenshots and videos are disabled. The fixture attaches a numeric JSON summary only. If a metric is unsupported/missing, its configured budget fails rather than reporting success. Timing thresholds are illustrative; deterministic cache/request checks are the primary CI gates. This is a recipe, not an installable block: browser startup and Playwright commands are outside the current block verification allowlist.

## Provenance

Original reusable implementation informed by Sticks performance work at commit `dee6c87d2314965e0c708cc6a142896d362c9590`: startup deadlines must include body parsing; stamped assets need correct warm behavior; guest navigation must not fan out into historical queries; late shell geometry can dominate CLS. No application source, private identifiers, credentials or live records were copied. See also `../playwright-worker-e2e` for migrated D1 persistence journeys and `../vinext-guardrails` for static build checks.
