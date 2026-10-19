# Feature reuse in an existing app, including maintenance

The larger task made reuse competitive, but **did not demonstrate a meaningful model-cost saving**. Across three integration-plus-maintenance pairs, scratch cost $3.2611269 and catalog reuse cost $3.2861756: reuse was 0.8% more expensive and used 4.6% less agent time. Both arms passed every frozen automated check on their first attempts. Separate source review found one defect in each arm at different stages; automated success is not complete correctness.

This is a descriptive result for one deliberately relevant feature and one model, not evidence that larger projects generally save money through source reuse. It is more encouraging than the [small kitchen-sink result](kitchen-sink-discovery.md), but the workflow also changed, so task size alone cannot explain the difference.

## What was compared

Each agent started with the same working Hono/Cloudflare app: revocable sessions, D1 profiles, personal R2 files and cached reports. Integration added shared teams, permissions, team attachments, SQLite Durable Object chat rooms with hibernation APIs, and a browser interface. The withheld follow-up added viewers, live authorization changes on already-open sockets, and durable retry deduplication. Existing data, migrations, sessions, uploads and room history had to survive the change.

Scratch used the existing app and ordinary dependencies. Reuse also had the frozen 17-block/7-recipe catalog through compact MCP search/get, selective local checkout, and an optional installer. Agents could copy/adapt, install, or skip unsuitable source. Both arms already used shared framework libraries; this compares additional feature-source reuse.

The exact model was `claude-sonnet-5-5`, high effort, Claude CLI 2.1.303. All calls ran sequentially with fresh sessions. Integration order was scratch/reuse, reuse/scratch, scratch/reuse; maintenance reversed each pair. Every stage allowed a $1 initial call and one $0.75 repair after independent failure feedback. **No corrected-run repair was needed or used.** Maintenance continued from each arm's own code and persisted data, so it measures lifecycle continuation rather than isolated maintenance on identical implementations.

## Measured results

Costs are final CLI **list-price estimates, not invoice charges**. Agent time includes the agent's own tools and checks. External verification time is additional; tool durations are not added twice.

| Pair | Scratch lifecycle cost | Reuse lifecycle cost | Reuse cost change | Scratch agent seconds | Reuse agent seconds | Reuse time change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | $1.1602878 | $1.1484757 | −1.0% | 530.423 | 476.381 | −10.2% |
| 2 | $1.0261897 | $1.1088362 | +8.1% | 426.781 | 477.971 | +12.0% |
| 3 | $1.0746494 | $1.0288637 | −4.3% | 464.067 | 401.060 | −13.6% |
| Total | $3.2611269 | $3.2861756 | +0.8% | 1,421.271 | 1,355.412 | −4.6% |

External verification added 200.865 seconds for scratch and 183.829 seconds for reuse. Agent plus external-verification time was 1,622.136 versus 1,539.241 seconds, a 5.1% observed reduction. These totals exclude preparation and coordinating/reviewing-agent work; they are not end-to-end project ROI.

| Phase, three runs per arm | Scratch cost | Reuse cost | Scratch agent seconds | Reuse agent seconds |
| --- | ---: | ---: | ---: | ---: |
| Integration | $1.6810586 | $1.6235518 | 769.525 | 668.885 |
| Maintenance | $1.5800683 | $1.6626238 | 651.746 | 686.527 |

Reuse's initial integration advantage was 3.4% in cost and 13.1% in agent time. Maintenance cost 5.2% more and took 5.3% more agent time, removing the initial dollar advantage. The paired variation is more informative than treating the small aggregate difference as a stable effect.

| Arm, all six calls | Uncached input | Cache creation | Cache reads | Output |
| --- | ---: | ---: | ---: | ---: |
| Scratch | 196 | 403,836 | 4,291,194 | 181,252 |
| Reuse | 212 | 435,582 | 5,171,886 | 166,963 |

Reuse generated fewer output tokens but read more cached context. These categories have different pricing; fewer generated tokens did not imply lower total cost. Output already includes the CLI's reported thinking-token accounting. [Billing audit](../../packages/discovery-eval/results/lifecycle-2026-10-19/billing-audit.json) retains per-call counters, model, tool activity and validation cross-checks.

## Quality and actual reuse

All six integration outputs passed 11/11 grouped checks, and all six maintenance outputs passed 16/16, plus type/unit/build/migration, old-data preservation and process-restart checks. First-attempt and final automated outcomes are identical. The groups include the prior ten-check app suite, real Chromium journeys and WebSockets, team isolation, actual upload bounds, concurrent sends, the latest-50 visible history window, live permissions and retry behavior. Some apps retain more than 50 stored rows; a visible-window test alone does not prove every implementation has physically pruned a particular record.

Source review of all twelve immutable stage snapshots found two issues the frozen black-box suite missed:

| Snapshot | Finding | Later status |
| --- | --- | --- |
| Pair 2 scratch, maintenance | Captures the recipient array before awaiting D1 authorization. A socket accepted during that await can get a pre-commit snapshot and then miss the committed message's broadcast. | Remains in the final measured output; no extra repair was supplied. |
| Pair 3 reuse, integration | Checks the sender's lease but broadcasts without checking recipients' expiry. An expired idle recipient can keep receiving from a valid sender. | The planned maintenance implementation independently adds recipient authorization and expiry checks. The earlier defect remains recorded. |

These are post-run findings, not retroactive changes to the original scores. [Source audit](../../packages/discovery-eval/results/lifecycle-2026-10-19/source-audit.json) identifies exact source hashes and lines. The two [diagnostics](../../packages/discovery-eval/results/lifecycle-2026-10-19/diagnostics/README.md) exercise pinned source with deterministic class mocks; they are separate from the real-runtime acceptance suite. The joining-socket finding follows from the source's external asynchronous lookup and the event-interleaving behavior described in [Cloudflare's state documentation](https://developers.cloudflare.com/durable-objects/api/state/#blockconcurrencywhile). Neither review nor local restart checks establish production security completeness, actual platform hibernation timing, or billing savings.

The reuse agents made different choices:

- Pair 1 previewed installation, then checked out/read three WebSocket source files totaling 8,341 bytes, adapted app code and discarded the checkout. No installation was applied.
- Pair 2 applied the WebSocket block after a dry run, then adapted it. Installer create operations declared 22,761 bytes across docs, UI, service, route and tests; 9,859 were UI/service/route source. Package and Wrangler patches are separate from those byte counts.
- Pair 3 inspected the WebSocket and private-upload entries, then checked out/read the WebSocket room and upgrade files totaling 6,630 bytes, adapted code and discarded the checkout. The upload entry was metadata-only; it was neither installed nor checked out.

Maintenance retained the prior implementations and used catalog discovery without another installation. Finding the relevant block was quick in these runs; the observed work was mostly adaptation and verification. This provides no evidence that vector search would improve the outcome at this catalog size. The flexible metadata-to-local-source workflow is viable, but this experiment does not show that expanding retrieval infrastructure pays for itself.

## Provenance, accounting and limits

Frozen harness/catalog commit: `8aef03249175ce7972c29bf099e9c84900386d2f`. Catalog SHA-256: `5b52a2c03aaee9c3cd1df3daa30348e22850d25c24d8ab002c853b3d44e40abd`. The [evidence manifest](../../packages/discovery-eval/results/lifecycle-2026-10-19/evidence.json) contains task, acceptance, harness, baseline and lockfile hashes, exact runtime versions, schedule, preparation results and every attempt. Source snapshots are content-addressed in 110 unique blobs. Restricted file tools and fixed local command tools were shared by both arms; raw logs were independently checked for tool/model boundaries. Four scratch calls attempted unavailable Bash tools; all were denied, with no execution. This is cooperative local execution, not a hostile-code sandbox. No deployment or remote migration was performed.

The [preserved pilot](../../packages/discovery-eval/results/lifecycle-pilot-2026-10-19/README.md) exposed an inherited profile-loading race in the historical baseline. Its scratch build changed only a navigation link in that page; the race was not introduced by the requested feature. Its completed initial and repair estimates total $0.7133287, and the repair passed. A reuse call had already begun when the pilot was stopped and lacks final billing: its cost is **unknown**, not zero. A $1.50 allowance was reserved for that call; the reserve is not an observed charge or a guaranteed ceiling on provider-step overshoot.

A common hash-pinned baseline correction was then applied to all six new copies, and each passed the full legacy browser/API suite before the corrected experiment. Historical v2 source and pilot results remain unchanged and are not pooled with the corrected comparison. Corrected estimates total $6.5473025; adding completed pilot estimates gives **$7.2606312 plus the unknown interrupted-call cost**. The corrected run used 12 initial calls, no repairs, and no CLI budget exhaustion. The six corrected-host preparations took 197.508 seconds. Harness development, earlier failed preparation, orchestration, source review, diagnostics and reproduction are outside the measured task-agent totals and were not assigned zero cost.

Three pairs of one selected feature are not a representative sample or a significance test. Sequential order is only partly balanced; provider prompt caching and machine state can affect timings and estimates. The earlier study used a different task, forced-reference workflow, effort policy and budget, so the change between studies cannot isolate task complexity. Both studies already share framework dependencies. The evidence supports keeping the source-sharing thesis open, while treating dollar savings, production quality and lifecycle ROI as unproven.

## Reproduce without paid calls

Normal package tests never invoke a model. Restore any stage from the evidence into a new directory:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @kitbash/discovery-eval exec playwright install chromium
pnpm --filter @kitbash/discovery-eval test
node packages/discovery-eval/lifecycle/copy-app.mjs \
  packages/discovery-eval/results/lifecycle-2026-10-19 \
  1 reuse maintenance /tmp/kitbash-review-rooms
cd /tmp/kitbash-review-rooms
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec wrangler d1 migrations apply DB --local
pnpm exec wrangler dev
```

Only public local fixture credentials are restored: `alice@example.test` or `bob@example.test`, password `local-demo-password`. Private checkpoint cookies, databases, raw model conversations, dependencies and generated artifacts are omitted. These are experimental outputs, including the defects above, not public starter blocks. See the [fixed protocol](../../packages/discovery-eval/lifecycle/README.md) for explicit opt-in paid reruns and budget limits.

Independent [fresh-copy reproduction](../../packages/discovery-eval/results/lifecycle-2026-10-19/reproduction.json) of pair 1 reuse maintenance passed frozen install, typecheck, 21 Vitest tests, dry-run build, local migrations, integration 11/11, maintenance 16/16 and both checkpoint restart checks. It verifies final code with freshly seeded data, not a replay of the historical upgrade. The discovery package's 28 tests and the root frozen-lock install also passed. Both published mock diagnostics reproduced their pinned findings. Export auditing verified all 544 source-manifest references and found no occurrences of the 18 private fixture-session values.
