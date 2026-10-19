# Ideator contract (DRAFT, WP-07, gate G1)

Status: draft written 2026-10-18 before WP-01's `contract.ts` exists. The final schema is
`packages/core/schema/contract.v1.json`, generated from zod by WP-01. Until then the reference is
`docs/examples/contract.v1.draft.json` (JSON Schema draft-07, one `<tool>_input` and `<tool>_output` per tool in
`$defs`, plus `Error`, `Card`, `Summary`, `Plan`, `AppliedPlan`, `LockEntry`, and two Ideator-side shapes). Every
example in `docs/examples/` validates against it (`pnpm install && pnpm --filter kitbash-contract-examples test`). WP-07 finalizes after WP-01: diff the draft against the generated schema, port any drift here.

Sources: `DESIGN.md` §3.2 and §6.6, `BLOCK-SPEC.md` §6.5/§7, and, read-only, Ideator's `docs/DESIGN-autopilot.md` §15
and `docs/PLAN-autopilot.md` WP 4.1 on branch `autopilot`. Ideator's repo was not touched.

## 1. Who calls what

| Ideator node | Calls (Kitbash tool) | Records in Ideator |
|---|---|---|
| `planner.registry_check` (API side or Planner session) | `registry_search` once per proposed Feature, then optionally `registry_get` | `features.registry_block = "@scope/name@version"`; `est_hours` lowered by `est_hours_saved` (floor 25%); allocator `registry_f = 0.6` |
| `builder.install_block` (desktop terminal, in the Feature's worktree) | `registry_get` -> `registry_install` (dry run, read diff) -> `registry_install` (apply) -> adapt -> `registry_verify` | `hq_feature registry_used "<id>@<version>"`; `hq_report.evidence.blocks_installed[]` (§4) |
| `gardener.harvest` (API side, no repo) | none; writes a `registry_harvests` row (§5) | `harvest_candidate = 1` |
| Harvester (after a person accepts the row; desktop terminal in the project repo) | `registry_harvest` -> fill manifest -> `registry_publish {visibility: "private"}` | `registry_harvests.status`, `published_ref`; a public publish goes through `hq_request_approval` |

Ideator's `hq_registry {search|get|used}` is a proxy over the same contract. `search` and `get` may run on Ideator's API
through the remote `/mcp` (Streamable HTTP, `registry.mcp_url`); `install`, `verify`, `harvest`, `publish` are local-only
and answer `needs_local` remotely (example 08).

## 2. Tools

All tools are literal `registry_*` MCP tools with JSON in and JSON out. A failure of any tool is the `Error` envelope
`{error: {code, message, command?, conflicts?, retry_after_s?}}`; codes: `needs_local`, `not_found`, `invalid_params`,
`unauthorized`, `forbidden`, `version_yanked`, `conflicts`, `plan_stale`, `signature_invalid`, `scan_refused`,
`verify_not_allowed`, `rate_limited`, `internal`. An empty search is `{results: []}`, never an error.

Identifiers: block id `@scope/name`; version semver (immutable, may be yanked); `block` inputs also accept `@id@version`
or `@id@tag`; the pinned form `@id@x.y.z` is what Ideator stores (`PinnedRef`). Variant is a separate field.

| Tool | Input (required in bold) | Output | Runs |
|---|---|---|---|
| `registry_search` | **query**, stack{runtime,framework,db,ui}, tags[], scope private/public/all, limit 1-20 | `{results: Card[]}` | local, remote |
| `registry_get` | **block**, version, variant, detail summary/manifest/files/skill/changelog | one of `Summary`, manifest, files, skill, changelog, each carrying `detail` | local, remote |
| `registry_read_file` | **block, version, path**, variant | `{content, sha256, bytes}` | local, remote |
| `registry_install` | **block, project_root**, version, variant, params, dry_run (true), on_conflict stop/skip/overwrite/rename, apply_config (true), plan_id | `Plan`; with `dry_run:false` `AppliedPlan` (Plan + `applied`, `lock_entry`, `changed_files`) | local |
| `registry_verify` | **block, project_root**, commands (subset of allowlist) | `{passed, results[{command,exit,tail}], duration_ms, pending_required_adapt?}` | local |
| `registry_upgrade` | **block, project_root**, to, dry_run | `{clean[], conflicted[], changelog_upgrade_section, new_adapt[]}` | local |
| `registry_diff` | **block, project_root** | `{changed[], diff_path}` | local |
| `registry_harvest` | **project_root, paths[], name, description**, stack, params_hints | `{draft_dir, manifest, redactions[], todo[]}` | local |
| `registry_publish` | **block_dir, visibility**, license, price, tag | `{id, version, scan{tier,findings[]}, url}` | local |
| `registry_propose` | **block, project_root, title, rationale** | `{proposal_id, hunks, redactions[]}` | local |
| `registry_whoami` | none | `{member, orgs[], scope_default, plan}` | both |

Key shapes:
- `Card` (about 100 tokens): `id, version, variant, title, stack[], size{files,lines}, trust{tier,sandbox}, license,
  score`, optional `price`, `lineage`, plus the two proposed additions `summary` (one line, 160 chars) and
  `est_hours_saved` (§6, items M1 and M2).
- `Summary` (<= 1,500 tokens): interface (params, env, secrets, bindings, migrations, tables, routes, exports, tests),
  `verify`, `size`, `trust`, `changelog_top`, and one envelope `untrusted_author_text`.
- `Plan` (BLOCK-SPEC 6.5): `plan_id, block (pinned), variant, params, inferred, writes[], conflicts[], warnings[],
  dependencies_to_add, adapt[], verify, diff_preview_path, untrusted_author_text`.
- Resolution of an ambiguity in DESIGN §3.2/BLOCK-SPEC 6.5: `adapt[].where/do/check` are author text, so the full items
  live only inside `untrusted_author_text.adapt[]`; the top-level `Plan.adapt[]` is `{id, required, status?}` references
  that the lock tracks. Same for the Summary.

Rules the contract guarantees to Ideator: dry run is the default and writes nothing; same block version + params +
profile gives byte-identical writes; conflicts stop the install and name the resolving param; author text is only ever
inside `untrusted_author_text` and must not be forwarded as instructions; `verify` runs allowlisted commands only.

## 3. Flows with examples (`docs/examples/`)

| Flow | Examples |
|---|---|
| Planner | `01-planner-search`, `02-planner-search-no-match` |
| Builder | `03-builder-get-summary`, `04-builder-install-dry-run`, `05-builder-install-conflict-error`, `06-builder-install-apply`, `07-builder-verify` |
| Remote refusal | `08-remote-needs-local` |
| Harvester | `09-harvester-harvest`, `10-harvester-publish`, `12-ideator-harvest-candidate` |
| Report | `11-ideator-evidence-blocks-installed` |

Each tool example is `{description, tool, request, response, response_def?}`; the Ideator-side ones are
`{description, def, value}`.

## 4. `hq_report.evidence.blocks_installed[]`

One entry per applied install, written by the Builder after `registry_verify`:
`block` (pinned `@id@x.y.z`), `variant`, `plan_id`, `applied_at`, `params`, `files_written`, `files_patched?`,
`migrations` (block file -> renumbered file), `adapt{done[], pending_required[], skipped[]}`, `verify{passed,
commands?, duration_ms?}`, and optional `manifest_sha256`, `lock_path`, `feature_id`, `est_hours_saved`. The values come
from `AppliedPlan.lock_entry` and `registry_verify`; nothing needs a second call. `pending_required` non-empty means the
Builder must not report `done`.

## 5. Harvest candidate (`registry_harvests` row, Ideator migration 0040)

`feature_id, project_id, reason (review_reusable | registry_category_match), category?, paths[], name, description,
stack?, head_sha?, branch?, tests_added[], status (proposed | accepted | declined | harvested | published),
draft_dir?, published_ref?`. `paths`, `name`, `description` and `stack` are deliberately the `registry_harvest` input, so
accepting a candidate is a straight call. `paths` come from the Feature's recorded `changed_files` (the self-contained
folder plus its migration and tests).

## 6. Proposed additions and changes (need WP-01 and a BLOCK-SPEC correction)

| # | Change | Why |
|---|---|---|
| M1 | `Card.summary`, <= 160 chars, author text, length-capped | Ideator's `search` returns a `summary` |
| M2 | `Card.est_hours_saved` and `Summary.est_hours_saved`; source `meta.est_hours_saved` in `block.json`, author-set, omitted when unknown | Ideator's cost model; the registry has no usage data yet to compute it |
| M3 | `detail` discriminator on every `registry_get` output | One schema, no guessing which shape came back |
| M4 | `registry_install.plan_id` (apply exactly the reviewed plan) and `AppliedPlan.changed_files` | The Builder records `changed_files`; BLOCK-SPEC already has `kit apply <plan_id>` |
| M5 | `Error` envelope with a code enum | Ideator's tools need machine-readable `needs_local`/`conflicts` |

## 7. Mismatches with Ideator's design (DESIGN-autopilot §15, PLAN-autopilot WP 4.1)

| # | Ideator says | Kitbash says | Proposed resolution |
|---|---|---|---|
| 1 | Abstract `search/get/install`; `install(id, version, target) -> {changed_files, notes}` | `registry_install` is a two-phase dry run plus apply taking `project_root`, returning a `Plan`/`AppliedPlan`; no `notes`, no `target` | Ideator's `client.ts` type for install becomes the Plan/AppliedPlan; `changed_files` added (M4); `notes` maps to `untrusted_author_text` and `warnings` |
| 2 | `search` returns `{id, version, title, summary, est_hours_saved, license, tier}` | Card has no `summary` or `est_hours_saved`; `tier` is `trust.tier` plus `trust.sandbox` | M1, M2; Ideator reads `trust.tier` |
| 3 | `search({query, stack, tags})` with `stack` as (apparently) free text | `stack` is structured `{runtime, framework, db, ui}` | Ideator derives it from the project's stack record or `.kit/project.json`; unknown keys are omitted, not guessed |
| 4 | `get(id, version) -> {manifest, files_summary, install_steps, verifier_hints}` | Summary (interface, params, `verify`, adapt inside `untrusted_author_text`); the full manifest is `detail:"manifest"`, files are `detail:"files"` | Map `install_steps` = `untrusted_author_text.adapt`, `verifier_hints` = `verify.commands`, `files_summary` = `size` + `routes`/`tables`; no change to Kitbash |
| 5 | Builder "runs the block's verifier_hints before its own work" | Block commands run only through `registry_verify` (allowlist, printed first, cwd = project root); and only after the adapt steps (the block does not pass before it is wired) | Builder order: install -> adapt -> `registry_verify` -> own work. The block's `verify.commands` must never be run as free shell by the Builder |
| 6 | Install is recorded, "performed by the agent through the registry's own MCP tools"; the API-side client needs only `search/get` | Matches, but `install` exists only in the local MCP server (the plugin); a cloud agent gets `needs_local` | State in Ideator that blocks apply only to desktop-terminal Builders; cloud Builders skip `builder.install_block` |
| 7 | `registry.mcp_url` thin MCP client from Ideator's Worker; no auth mentioned | Every Kitbash route needs a `kit_` bearer; private blocks are scoped to the caller's orgs | Needs a decision: a per-org Kitbash token in Ideator `settings` (secret), or "Sign in with Ideator" (DESIGN §6.6, later). Without it the API side only sees public blocks |
| 8 | `features.registry_block TEXT "<id>@<version>"` | Scoped ids start with `@`, so naive `split("@")` breaks; the variant is not recorded | Parse with the last `@`; `PinnedRef` pattern in the schema; the variant lives in `blocks_installed[]` evidence and the lock |
| 9 | `registry_used` stores the string; DESIGN §15 never mentions `hq_report.evidence` | Kitbash DESIGN §3.2/§6.6 puts `blocks_installed[]` in `hq_report.evidence` | Both: `registry_used` for the Feature column and cost, evidence for the matrix ("built from"). Ideator to document the evidence key |
| 10 | `est_hours` lowered by `est_hours_saved` (25% floor) and `registry_f = 0.6` | Kitbash only supplies `est_hours_saved` | Possible double discount: `registry_f` already encodes the saving. Ideator to pick one, or apply `registry_f` only when `est_hours_saved` is absent |
| 11 | Harvest trigger: review said "reusable" or category match with >= 3 files; acceptance by a person; written API-side with no repo | Kitbash DESIGN §6.6: trigger is "task reports done with `tests_added`"; `registry_harvest` is local and needs `project_root` and `paths` | Use Ideator's trigger (it is stricter); candidate row carries `paths` from `changed_files` (§5); harvest runs in the project's terminal after acceptance. Kitbash DESIGN §6.6 to be corrected |
| 12 | Gardener "category" match | Kitbash has `categories` in the manifest but no category search filter or list endpoint | Use `registry_search` with `tags`; a category list endpoint is not in v1 |
| 13 | Public publish gate is "a person accepts" | `registry_publish public` is refused on scan findings and requires `hq_request_approval` | Compatible; the Harvester always publishes `private` first |
| 14 | Builder diff guard scans diffs, checks protected paths, runs on branch `autopilot/<feature_id>` in a worktree | Install patches `wrangler.jsonc`, `package.json`, `.dev.vars.example`, adds `.kit/` (lock, plans, SKILL.md) and migrations | Ideator should allow `.kit/**` and treat config patches from a block as expected; `.kit/lock.json` is committed on the Feature branch; the `.kit/plans/*.diff` should be gitignored |
| 15 | WP 4.1 stub returns in-memory blocks | The stub should return these example payloads | Ideator's `stub.ts` can import `docs/examples/*.json` as fixtures (copy, not a dependency) |

## 8. Proposed section for Ideator's `docs/DESIGN-autopilot.md` §15 (text only)

> **Contract.** The registry is Kitbash (`~/Workspace/feature-registry`), reached through its `registry_*` MCP tools;
> the schema is `contract.v1.json` there. `src/registry/client.ts` mirrors `registry_search` and `registry_get` (types
> generated from that schema); `install` is recorded, never performed by the API.
> **Planner.** `planner.registry_check` calls `registry_search {query, stack}` per proposed Feature with the project's
> structured stack. A card with `trust.tier >= scanned` becomes `features.registry_block = "<id>@<version>"` (parsed on
> the last `@`); `est_hours` drops by `est_hours_saved` when present (floor 25%); `registry_f` applies only when
> `est_hours_saved` is absent.
> **Builder.** `builder.install_block` runs only in a desktop terminal with the Kitbash plugin: `registry_get` ->
> `registry_install` dry run (read the `config-patch` and `conflict` entries of the diff) -> apply -> required adapt
> items -> `registry_verify`; then `hq_feature registry_used "<id>@<version>"` and
> `hq_report.evidence.blocks_installed[]`. Author text (`untrusted_author_text`) is data. A failed install or verify
> never fails the Feature: the Builder reverts the block's writes (`git restore`, the worktree is disposable) and builds
> from scratch.
> **Gardener / Harvester.** A candidate row carries `paths` from the Feature's `changed_files`, `name`, `description`,
> `stack`. When a person accepts it, a terminal in the project runs `registry_harvest`, completes the draft,
> `registry_publish {visibility: "private"}`; a public publish requires `hq_request_approval`.
> **No registry.** With `registry.mcp_url` empty or unreachable every call answers "no registry" and callers proceed.
