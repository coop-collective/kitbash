# Local discovery and fullstack reuse experiment

This package tests whether reusable source helps an agent complete one fixed fullstack task. It is an opt-in experiment, separate from Kitbash's production MCP contract. It indexes local installable blocks and labels recipes as reference-only. Historical catalogs can contain reference-only templates; the current catalog has 17 blocks, 7 recipes, and no public templates.

The kitchen-sink task includes revocable sessions, optimistic-concurrency profiles, private R2 files, revision-aware cached reports, and a browser login/edit/upload/download/logout journey. The saved apps are immutable experimental outputs, **not public starter templates or production-ready authentication systems**.

## Reproduce without paying for an agent

From the repository root, install the root workspace and browser once:

```sh
pnpm install --frozen-lockfile
pnpm --filter @kitbash/discovery-eval exec playwright install chromium
pnpm --filter @kitbash/discovery-eval test
node packages/discovery-eval/run.mjs --prepare-only
```

Preparation creates fresh hosts outside the repository and runs dependency installation, TypeScript checks, workerd tests, a Wrangler dry-run build, and local migrations. It does not invoke an agent. The normal package test command never makes paid model calls.

Copy a saved app into a **new, nonexistent** directory, then run it:

```sh
node packages/discovery-eval/copy-app.mjs pilot-2026-10-19 scratch /tmp/kitchen-sink-example
cd /tmp/kitchen-sink-example
pnpm install --frozen-lockfile
pnpm db:local
pnpm dev
```

The copy command writes only the public local fixture credentials needed for reproduction. Log in as `alice@example.test` or `bob@example.test` with `local-demo-password`. It never copies live credentials. To check a copied app against the **current v2** contract, run `node packages/discovery-eval/check-app.mjs /tmp/kitchen-sink-example` from the repository root. Historical pilot scores use their archived acceptance script, not this revised checker.

## Explicitly run paid agent evaluation

```sh
node packages/discovery-eval/run.mjs --run-paid --catalog-root "$PWD"
```

This requires an already authenticated Claude CLI. It runs three arms sequentially using the same exact model (`claude-sonnet-5-5`), fresh host, task, ten grouped acceptance checks, and CLI budget cap of $5 per arm:

| Arm | Available reference tools |
| --- | --- |
| Scratch | No source catalog; ordinary dependencies and empty Hono host |
| Library | Compact search/get, real installer plan/apply, optional source checkout |
| Reference | Compact search/get, selective source checkout, local Read/Grep, manual copy/adaptation, discard; no installer |

All arms receive identical project execution tools. Bash is removed from the agent's built-in tools. `project_check` runs fixed argv for install/typecheck/test/dry-run/migrate; it never invokes an arbitrary shell or deploys. Commands and dev servers own process groups and clean up those groups. `project_copy_reference` copies an inspected cache file into a new ordinary project file. Read/Write/Edit/Glob/Grep remain available. This is scoped cooperative tooling, **not a sandbox for hostile project code**: tests and configuration still execute local code.

Each run locks task, acceptance, harness, and catalog hashes before agent execution. It refuses existing output directories, preflights every host, checks that the catalog has not changed between arms, and retains incomplete results. JSONL logs remain in the temporary run directory. Committed reports contain sanitized billing/usage summaries, tool/response-byte audit records, app source snapshots, and check outcomes; they omit raw conversation logs, credentials, dependencies, generated types/build output, and local databases.

## Local MCP prototype

```sh
node packages/discovery-eval/server.mjs /absolute/catalog /absolute/project /absolute/audit.jsonl reference
```

Modes are `scratch`, `reference`, and `install`. Search returns compact cards; empty query browses with bounded pagination. Get adds interfaces, variants, params, and a bounded document excerpt. Checkout copies only selected indexed files, capped at 256 KiB/file and 2 MiB/entry, with path checks and SHA-256 manifests. Declared lockfiles and safe hidden configs are retained; secret/artifact paths and symlinks are rejected. `catalog_discard` removes the temporary disk copy. It **does not remove text already read into the model context or refund tokens**. Potential savings come from selective reads and avoided generation.

The reference arm should use explicit file paths with Read/Grep inside `.catalog-cache`; repository-wide search can skip this gitignored directory. Claude's official [Glob/Grep documentation](https://code.claude.com/docs/en/tools-reference#grep-tool-behavior) describes the explicit file-discovery tools. MCP is a tool interface; it does not require a vector index. This prototype starts with lexical metadata and a small explicit synonym map. Five task-related queries form a retrieval smoke check, not a held-out semantic-search benchmark.

## Interpreting evidence

CLI `modelUsage.costBasis` is `list`: reported dollars are **CLI list-price estimates, not invoice charges**. Reports separate uncached input, cache creation, cache reads, output, agent elapsed time, preparation time, and observed tool calls. Source bytes are not tokenizer counts. Shared provider prompt caches and sequential order can affect token billing and timing. One run per arm cannot establish general savings or superiority.

The initial pilot is preserved under `results/pilot-2026-10-19`. Both agents repaired a starter runtime-date/type issue; concurrent shared-host cleanup commands could interfere. Those results are observational, not a controlled causal comparison. The pilot library's 9/10 score includes a DELETE-status mismatch under an ambiguous sentence; a separate post-run diagnostic proved the foreign deletion left the owner's bytes intact. Scores were not quietly changed. Two interrupted reference preparations have no final billing event, so their cost is unknown rather than zero. Harness-development/model orchestration cost was not metered; recorded agent totals are not an end-to-end project-cost claim.
