# TypeScript diagnosis

Load only the section relevant to the finding. These are investigation leads, not a list of mandatory rewrites.

| Observed problem | Investigation | Evidence for a repair |
|---|---|---|
| Agent edits a similarly named implementation or misses a consumer | Trace imports, exports, package aliases, framework entry points and generated files; inspect prior failed patches | Demonstrate the ambiguous boundary; fix the smallest misleading name, contract or lookup path |
| Failure cannot be reproduced | Check hidden mutable state, real time, randomness, shared fixtures and missing setup | Reproduce independently; isolate only the state preventing that |
| Wrong values cross a boundary | Compare runtime validation, generated declarations, schema and caller expectations | Test a real invalid value or confused identifier; use the existing validation/type system where possible |
| Work is lost, duplicated or outlives a request | Trace promise ownership, retries, cancellation and commit/side-effect order | Exercise completion, rejection, cancellation and idempotency at the affected boundary |
| A file/export is reported unused | Check package consumers, route discovery, dynamic imports, scripts, code generation and side-effect imports | Confirm reachability before deletion; fix detector configuration for legitimate entry points |
| Typecheck/build is slow | Measure cold/warm runs, package selection, dependent consumers and actual subprocess overlap | Compare equivalent checks; missing dependencies or uncertain history must not silently skip required checks |

`satisfies` checks type compatibility; it does not validate runtime input. Keep generated types generated. Do not add a runtime schema to every internal function or replace a working error convention just to follow this skill.

For Workers/DO code, confirm behavior against the pinned platform/runtime and its relevant guidance. Single-threaded execution does not mean a handler is atomic across external asynchronous work. A dropped promise or an in-memory cache is not a durable completion guarantee. Use real runtime integration checks where those semantics matter.

Performance changes need a baseline: repeated requests, query count, typecheck duration, allocations, transferred bytes or latency. Do not infer a bottleneck from syntax alone. Page rendering, client state and shared data caches need their own page-specific review.

Sources: [TypeScript satisfies](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html), [Knip reachability gaps](https://knip.dev/guides/handling-issues), [Durable Object concurrency](https://developers.cloudflare.com/durable-objects/api/state/#blockconcurrencywhile).

## Review change boundaries

For a structural finding within the assigned area, ask: **should these pieces change together?**
Inspect callers and relevant Git history before proposing a boundary change. A shared commit alone is
not proof of coupling; generated updates and broad formatting changes can move unrelated files together.

- **Hidden links:** duplicated policy, shared mutable state, required initialization or cleanup order,
  or feature pieces whose relationship is absent from imports, contracts and manifests.
- **Needless links:** application glue depending on block internals, stable calculations importing
  workflow orchestration, or a shared interface carrying options meaningful to only one caller.
- **Surplus candidates:** unused extension points, unreachable code or forwarding helpers with no
  independent contract. Verify consumers and runtime registration before treating them as removable.

Special cases are investigation leads, not defects. Retries, cache-failure fallbacks, provider-specific
accounting, compatibility paths, RPC adapters and independent verification may express necessary
requirements. Record the invariant each protects. A manifest can make a feature boundary explicit even
when its files span routes, services, tests and migrations. Fewer branches or files is not a success metric.

Keep a short decision log for material findings:

- Evidence: paths/symbols, callers and any relevant change history or reproduction.
- Contract: behavior, ownership, persisted formats and failure handling that must remain intact.
- Decision: smallest proposed boundary change, or keep/defer with a reason and missing evidence.
- Verification: expected observable improvement, baseline and affected behavior checks.

Do not turn this review into an inventory of everything imperfect. Follow the skill's existing task budget
and stopping rules; retain tests and comments that explain or protect non-obvious contracts.

This diagnostic lens is adapted from Caldo's [untangle-codebase](https://github.com/caldoai/skills/blob/f3cf47774975a7d9fca45730babf4ff7ad765ada/skills/untangle-codebase/SKILL.md).
See [attribution and MIT license](../THIRD_PARTY_NOTICES.md). Kitbash retains its bounded, evidence-first
workflow; this adaptation is not evidence of faster or cheaper agent performance.
