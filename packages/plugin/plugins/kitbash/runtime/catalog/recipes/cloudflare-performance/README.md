# Cloudflare performance preflight

A dependency-free, read-only Node recipe for checking observability access before drawing conclusions about a slow page. It reads a Worker's observability settings, aggregate invocation metrics and account telemetry-key access. It never changes logging, sampling, deployments or application data. POST is used only for GraphQL queries and telemetry key discovery.

```sh
pnpm --filter kitbash-recipe-cloudflare-performance test
# Supply the three required variables through your approved secret injector or CI environment:
# CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_WORKER
pnpm --filter kitbash-recipe-cloudflare-performance preflight
```

No token argument is accepted. Do not paste credentials into commands, artifacts or chat. The script does not search local Wrangler credentials or discover accounts automatically. Optional `PERF_WINDOW_MINUTES` selects 1–1440 minutes (default 60); `PERF_END` fixes the end of the UTC interval for repeatable comparisons. The default end is now. Account ID and Worker name are used only in requests and are not printed; record the intended environment and deployed commit separately beside the report.

Exit 0 means all three access checks succeeded and the settings contain a readable observability configuration; exit 2 means at least one capability could not be verified or observability is unconfigured. Exit 1 means configuration was rejected. A complete preflight does **not** mean the application is healthy. `no_data` means an accessible dataset returned no rows, not zero latency or proof of no traffic.

## Access and interpretation

Use an account-scoped API token with the minimum permissions for the selected account:

| Read operation | Permission to verify when issuing the token |
| --- | --- |
| Aggregate GraphQL analytics | Account Analytics Read |
| Worker settings | Workers Scripts Read |
| Telemetry key discovery | Workers Observability Write (the current API names a write permission even for this read endpoint) |

A 401/403 is reported as `forbidden`; a 404/405/501 as `unsupported`; HTTP-200 API errors remain `api_error`. A settings read working does not establish telemetry access. The recipe never asks to broaden permissions automatically. If policy does not permit the telemetry permission, retain the partial report and state that stored traces were not inspected. An accessible keys endpoint only establishes key discovery, not trace existence, coverage, or trace-query permission. Key discovery uses the selected interval through the documented top-level `from`/`to` fields and requests at most one key. Raw keys and events are not output. A valid settings envelope without observability is `unconfigured`; malformed settings or telemetry responses are `unexpected_response`.

The analytics query groups one Worker over the stated interval by invocation outcome. Requests, errors and subrequests are adaptive aggregate estimates. CPU p50/p99 are converted from microseconds to milliseconds **only after schema introspection confirms the units**. They remain separate per outcome: averaging percentiles would be incorrect. A 5-second browser request is not evidence of 5 seconds of Worker CPU or D1 execution. Network, queueing and upstream waits require separate evidence. Missing units, malformed responses and potentially truncated results are explicit failures, not fabricated zeros.

## Correlate browser and server evidence

1. Record the exact deployed build, UTC interval, environment and route **template**, plus cold/warm browser results. Use separate accounts/contexts for user-isolation checks. Keep query strings, cookies and authorization headers out of reports.
2. Before enabling or changing telemetry, review the current sampling, retention and redaction policy. This recipe only reports the existing settings. A zero/error-free sample cannot prove the absence of errors outside the window or sample.
3. For an authorized instrumentation change, use an application-generated opaque request ID and fixed span names such as `request`, `database.read`, `cache.lookup`, `upstream.fetch`. Record numeric durations, cache outcome and source-read counts. Do not use user IDs, raw URLs, SQL text, prompts, exception messages or arbitrary payloads as labels.
4. Expose coarse numeric `Server-Timing` entries such as `db;dur=12.4, cache;dur=0.3` only where appropriate for the audience. Keep internal names and descriptions private; avoid injecting request-provided text. Maintain the existing auth and cache policy. Correlate a controlled slow request with its server trace before attributing the bottleneck.
5. Keep the evidence layers distinct: browser TTFB/LCP/CLS, server wall time, CPU, source-query counts and provider latency. Report what was actually measured. React Profiler measures React render work; it cannot attribute SQL latency or plain canvas work.

For a bounded live `wrangler tail` investigation, use an in-memory allowlist summarizer and retain only normalized routes and known error categories. Do not save raw JSON tails, HARs or traces carrying sessions. This recipe intentionally does not start a tail, inspect stored events or activate instrumentation.

## Validation and adoption

Copy `inspect.mjs`, the package script and tests into a tooling directory. The tests mock the Cloudflare API, including successful aggregation, verified units, permission denial, missing data, API errors and secret-bearing responses. They exercise the report contract without requiring an account. Run the live preflight with your own scoped token to verify your account's current API behavior; mocked tests do not certify live permissions. This is a recipe rather than an installable block because remote observability access is an operator-selected diagnostic, not application runtime behavior.

The approach comes from an application audit where aggregate analytics were accessible while stored telemetry access returned 403. No application account identifiers or captured customer data are included.

References checked 2026-11-06: [Workers analytics query](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/), [Analytics token permissions](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/), [telemetry keys and required permission](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/keys/), [Worker traces](https://developers.cloudflare.com/workers/observability/traces/).
