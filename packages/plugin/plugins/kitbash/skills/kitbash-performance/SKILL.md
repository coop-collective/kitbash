---
name: kitbash-performance
description: Use when auditing slow pages or adding repeatable browser, React/vinext, or Cloudflare performance regression checks. Choose measured budgets and preserve authorization, freshness, and runtime compatibility.
---

# Performance checks that reproduce the problem

Start with the reported route, runtime, exact build revision and a reproducible symptom. Inspect installed framework versions and existing tests. Use the smallest applicable recipe; copying a recipe does not automatically wire it into an application or prove a performance improvement.

## Find the shipped recipes

In a source checkout, read `recipes/<name>/README.md`. In an installed plugin, resolve `../../runtime/catalog/recipes/<name>/README.md` relative to this skill directory. The recipes ship as source and tests, not installable blocks; browser startup is outside the block verification allowlist.

- `browser-performance`: local browser fixture, cold/warm asset transfers, request budgets and layout-shift measurement. Adapt routes, readiness and budgets to the actual product. Do not use universal timing thresholds as evidence of user experience.
- `vinext-diagnostics`: direct web-vitals collection and React diagnostics. Check the project's pinned vinext version. `next/web-vitals` may be a no-op; use the tested direct library integration. Strict Mode checks development behavior; production Profiler needs a profiling build. React timings do not measure plain JavaScript, canvas, network or SQL work.
- `cloudflare-performance`: read-only access preflight and aggregate Worker metrics. Credentials come from the operator's environment, never skill text, command arguments or output artifacts. A permission error is a verification limit, not an empty successful result.
- `playwright-worker-e2e`: real Worker/D1 journeys. `vinext-guardrails`: static build and configuration checks. These complement runtime measurements.

## Establish the experiment

Record route audience, auth state, data cardinality, first-visit/onboarding state, cache state, device/CPU/network conditions and source timestamps. A browser's cache is separate from edge, application and database caches. Use isolated contexts for users and verify private data cannot cross cache boundaries.

Choose explicit project budgets from repeated baselines. Compare cold and warm loads, direct and client navigation, failed/stalled responses, hidden/visible transitions and actual socket closure when relevant. Offline browser emulation alone does not prove an existing socket disconnected. Verify readiness and useful content, not merely a successful HTTP response or disappearing spinner.

For stamped assets verify bytes, status, MIME, GET and HEAD behavior, and conditional requests. Auth gates must run before cache optimizations. For startup requests bound both headers and response-body reading, clear timers and in-flight entries, and prove recovery after failure.

Use correct CLS session windows, exclude recent-input shifts, and report lab interactions separately from field INP. Retain exact build identity and sanitized summaries; avoid saving authenticated traces, URLs with query secrets, response bodies, cookies or raw logs by default.

## Image delivery and visual quality

For image optimization, read `skills/page-delivery/references/images.md` in a source checkout or `../../runtime/catalog/skills/page-delivery/references/images.md` relative to this installed skill. Start with actually requested assets, measure compressed bytes, validate browser decoding, and compare artwork and complete pages across viewport sizes and DPRs. Preserve image authorization. Do not claim a latency or Core Web Vitals improvement from encoding savings alone.

## Attribute before changing

Correlate browser requests with safe Worker timings/spans where access exists. Distinguish CPU from wall time and network duration; aggregate Worker percentiles cannot identify a slow route or D1 query. State sampling rates and missing permissions. Trace failures must not fabricate zero errors or latency.

Prefer existing cache/query capabilities; add a new layer only for a measured need. Reserve final shell geometry before first paint where appropriate, while preserving alternate layouts and feature flags. Validate changes against the built deployment runtime, not only a development server.

Report the before/after evidence, failed and passed checks, tested versions, artifact locations and remaining gaps. Never label a single lab sample a field Core Web Vitals pass. No remote deployment, telemetry activation or recurring audit is implied by using this skill.
