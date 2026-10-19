# Fullstack reuse through compact MCP discovery

The selective-reference workflow produced a working kitchen-sink app, but this experiment **did not demonstrate token or cost savings**. The successful reference app passed the same ten grouped API/browser checks as scratch and used more model tokens, a higher CLI list-price estimate, and more agent time. These are observations from one run per arm, not a general quality or efficiency ranking.

## Corrected experiment

All three arms used Claude CLI 2.1.303 with exact model `claude-sonnet-5-5`, a $5 CLI cap each, the same empty Hono/D1/R2/KV host, the same task, and the same independently run acceptance script. They ran sequentially on 2026-10-19. Bash was absent; each arm had Read/Write/Edit/Glob/Grep and the same fixed project execution tools. Discovery/installer tools differed by arm. No agent browsed the web, deployed, or sent email. All arms already used shared Hono/Cloudflare/framework packages; the comparison concerns additional feature-source reuse versus newly generated app logic, not all code sharing versus none. Security, review, and maintenance benefits were not measured.

| Arm | Agent seconds | CLI list-price estimate | Acceptance groups | Observed reuse |
| --- | ---: | ---: | ---: | --- |
| Scratch | 145.324 | $0.2912271 | 10/10 | No catalog |
| Library + installer | 142.908 | $0.3951658 | 9/10 | Installed session-cookie, r2-private-uploads, tiered-result-cache |
| Selective reference | 166.660 | $0.4730604 | 10/10 | Checked out four source files, copied/adapted them, then discarded three entry directories |

The library arm planned member-profiles but did not install it. Both reuse arms implemented their profile feature themselves. The library arm passed every API group and failed the browser profile-save/reload group. Its visible form could accept input before initial profile loading finished. A separate post-run diagnostic delayed that GET and reproduced a typed value being overwritten. This supports the race explanation; it does not reconstruct the exact original event ordering, and the recorded 9/10 score remains unchanged.

| Arm | Uncached input | Cache creation | Cache reads | Output | Agent turns |
| --- | ---: | ---: | ---: | ---: | ---: |
| Scratch | 22 | 39,834 | 240,441 | 15,706 | 25 |
| Library + installer | 28 | 62,698 | 492,828 | 17,701 | 41 |
| Selective reference | 28 | 70,605 | 616,049 | 22,325 | 60 |

These are final CLI usage counters; cached input is shown separately rather than hidden in a single input number. Output includes the CLI's reported thinking-token accounting; it is not added a second time. Raw `modelUsage.costBasis` is `list`, so dollars are **list-price estimates, not invoice charges**. Library's observed estimate was 35.7% above scratch, with 1.7% lower agent time but an incomplete browser result. Reference's estimate was 62.4% above scratch and its agent time 14.7% higher. No statistical significance is claimed.

All arms passed typecheck, their workerd unit suites, the Wrangler dry-run build, and local migrations. The ten acceptance groups cover valid/invalid login, cookie tampering, mutation origins, profile bounds/conflicts/persistence, private file byte fidelity/headers/limits/deletion isolation, revision-aware cache freshness, revocation, and a real Chromium journey. This is a bounded task test, not a production security audit, coverage proof, accessibility review, or equivalence assessment of every extra behavior supplied by the blocks.

## Retrieval and setup observations

The frozen final catalog contains 17 installable blocks and 7 reference-only recipes. Its 760,083 declared source bytes include the container variants' lock/config files; it contains no public templates. Indexing plus content hashing took 0.553s on this machine. Compact cards for all 24 entries total 9,775 JSON bytes; the first six cards total 2,589 bytes. These byte counts are not tokenizer estimates.

The reference arm used one search, four get calls, three checkout calls, four local copy calls, twelve Read calls, one Grep call, and three discard calls. It downloaded 19,193 source bytes across four files from session-cookie, r2-private-uploads, and tiered-result-cache. Catalog responses totaled 27,860 bytes. Its full MCP responses, including fixed command results, totaled 35,944 bytes; library totaled 45,823 and scratch 4,632. The full-file context was therefore selective, but the observed integration conversation still used more tokens than scratch.

`catalog_discard` deletes the local temporary copy; it does not retract already-read model context or refund input tokens. Potential savings would come from bounded metadata/source reads and avoided generation. The existing production registry already has lexical D1 FTS5/BM25 and progressive get/read tools; this experiment adds an isolated unified local catalog, explicit browse pagination, reference-only recipes, selective checkout, and discard. It does not replace the production MCP contract.

The five task-related retrieval smoke queries found their intended target in the first five results. They are a small, known-task probe with an explicit synonym map, not a held-out retrieval benchmark. Generic “what is available” text produced noisy matches; explicit empty-query paginated browse handles inventory. At this catalog size, compact browse and lexical search are a reasonable starting point. Consider embeddings only after measuring real miss cases, ranking quality, maintenance cost, and end-to-end task outcomes. MCP defines tool/resource interfaces rather than a particular search backend; this is an architectural inference from the [official MCP architecture](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture). Explicit path-based Read/Grep supports the proposed local inspection workflow; the [Claude tool reference](https://code.claude.com/docs/en/tools-reference#grep-tool-behavior) documents these tools.

Fresh-host install/typecheck/test/build/migration preparation took 25.731s for scratch, 24.031s for library, and 16.571s for reference. That work is separate from the agent-time column. Dependency/provider cache state and fixed sequential order can affect timings and billing. Harness development and orchestration costs were not metered, and the original pilot's preparation time was not recorded; neither is silently assigned zero. This report makes no end-to-end project-cost saving claim.

## Provenance, failures, and reproduction

Catalog commit: `5b04572db366da25f94f1932ca4bb596c3265dc6`.

- Catalog SHA-256: `5b52a2c03aaee9c3cd1df3daa30348e22850d25c24d8ab002c853b3d44e40abd`.
- Task SHA-256: `c31c85c70f5c4b8e5f4a510655a271d1836a7de80bbbc97e5ad45af794aac5f1`.
- Acceptance SHA-256: `da94c8a199d76a1913f6e36d87c126dcf5d6ef61972f51d928dd34f7d92784c1`.
- Harness SHA-256: `ff55ea20c9a20dee99869e7a5a2dbfca67586c5334c647bd3d46dfc6f0a068b1`.

[Corrected artifacts](../../packages/discovery-eval/results/v2-2026-10-19/results.json) include all three immutable app outputs, per-file/app hashes, usage, checks, tool response sizes, selected source manifests, and installed-block inventory. [Package instructions](../../packages/discovery-eval/README.md) reproduce the successful reference app with local D1/R2, public fixture credentials, and the common checker. These outputs are experimental app snapshots, not newly advertised public starters. No credentials, raw conversation logs, dependencies, generated types/builds, or local database state are committed.

The [preserved pilot](../../packages/discovery-eval/results/pilot-2026-10-19/README.md) records its original 10/10 scratch and 9/10 library outcomes, exact original harness hash, starter-repair overhead, possible concurrent process interference, and a separate passing deletion-isolation diagnostic. Two interrupted reference preparations lack final billing events; their complete token totals/cost remain unknown. The corrected trio's completed list-price estimates sum to $1.1594533. All five completed pilot+corrected agent estimates sum to $1.8847036, **plus the unknown interrupted-attempt and unmetered preparation/orchestration costs**.

Verification includes deterministic MCP path/symlink/secret tests, real stdio mode boundaries, pagination, real installer plan/apply with Go variant selection, declared Cargo.lock visibility, missing-billing handling, independent nested Node-test execution, and owned descendant-process cleanup. Paid runs are opt-in; normal package tests never invoke them.

An independent reviewer then copied the saved successful reference app into a fresh directory, installed its frozen lockfile, and reran typecheck, unit tests, dry-run build, migrations, and all ten API/browser acceptance groups successfully. The copy helper also has a regression proving it refuses an existing destination without overwriting user edits.
