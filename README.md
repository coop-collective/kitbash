# Kitbash (working name: feature-registry)

**A registry of whole features for coding agents.** Auth, Stripe billing, orgs and roles, API keys, email sending,
rate limits, uploads, waitlists: each one a *block* with its migrations, routes, UI, env and secret declarations,
config patches, tests and a one-page agent guide. An agent searches in ~100 tokens, judges in ~1,000, installs without
reading the code, adapts the wiring from a checklist, and proves it with the block's own tests. shadcn's registry for
the whole stack, built for agents first.

**Benchmark status (2026-10-19): feature-source reuse did not save agent tokens or model cost in our measured task.** The selective-reference app passed the same checks as scratch but had a 62% higher CLI list-price estimate and took 15% longer; the installer arm cost 36% more and missed one browser check. All arms already shared framework dependencies. This tests additional feature-source reuse, not libraries versus no shared code. [Results, limitations, and reproducible apps](docs/research/kitchen-sink-discovery.md). Security, review, and maintenance benefits were not measured.

## Why

The owner runs ~30 small apps on Cloudflare (Workers, Hono, D1, R2, Next.js, Tauri). Three scans of `~/Workspace`
found the same features rewritten by hand again and again: six bearer-token schemes, three email-code sign-ins with
identical limits and zero shared lines, four OAuth-for-MCP providers, eight stateless MCP servers, seven plugin
scaffolds whose `validate.mjs` files differ by 200–330 lines. Each rebuild costs an agent session 20–60k tokens and the
owner a day of review, and produces one more slightly different version. Ideator's autopilot is about to multiply the
number of apps. The first customer is the owner's own agents.

Nothing on the market covers this unit. Component registries (shadcn: 462 namespaces, an MCP server, paid namespaces
behind header auth) model files, not features: no migrations, tests, versions, upgrades or stack variants. Whole-app
boilerplates (ShipFast, Supastarter, Makerkit) are one-shot copies whose own docs warn about upgrading, and their
revenue is falling as agents write scaffolding. Feature-level installers exist for one framework at a time (Makerkit's
plugins, Rails engines, AdonisJS `configure`). The blocker that killed earlier attempts, fragile codemods across many
stacks, is exactly what a coding agent with a test suite absorbs. **Tests included is the moat**: tests are the
acceptance check for installs, upgrades and royalties.

## What it is

- **Blocks** (`block.json`, a superset of shadcn `registry-item.json`): files with `{{kit.param}}` placeholders, typed
  params, stack variants (`hono-d1`, `nextjs-d1`), migrations renumbered on copy, declared bindings/env/secrets (names
  only), routes and tables as an interface for conflict checks, allowlisted `verify` commands, an Agent Skills
  `SKILL.md`, provenance and signatures, lineage. Three sizes: card ≤ 100 tokens, summary ≤ 1,500, bundle on disk.
- **The flow**: `registry_search` → `registry_get` → `registry_install` (dry run with a diff; deterministic copy +
  substitution + migration renumbering + config merge; lock file) → adapt checklist → `registry_verify` → later
  `registry_upgrade` (Copier-style 3-way re-apply) and `registry_propose` (send improvements upstream with params
  un-rendered).
- **Delivery**: a `kit` CLI; a Claude Code / Codex / Grok plugin whose local stdio MCP server exposes the `registry_*`
  tools (so Ideator's Planner/Builder/Harvester call them directly); a remote `/mcp` for cloud agents; a
  shadcn-compatible `/r/` endpoint.
- **Tiers**: private blocks per org (Free 5, Pro unlimited, Team per seat); public blocks free or paid (one-time per
  org, 15% fee); forks with immutable lineage; royalties to authors **and upstream forkers** (75% / 15% / 7% / 3%),
  metered on *verified active project-months*, not downloads, with a user-centric pool from 30% of subscriptions.
- **Security**: no install hooks; explicitly invoked tasks in validated private container subprojects; publisher + registry signatures over content hashes; static scan for secrets,
  dangerous code, dependency advisories and prompt injection in docs; sandboxed test runs; review tiers with rug-pull
  detection and a 72-hour `latest` cooldown; "instructions are data" rules enforced by the tools; dry-run diffs.
- **Stack**: Cloudflare Workers (Hono) + D1 (FTS5) + R2 (content-addressed blobs) + Queues + Cron, Vectorize and
  Sandbox in v1; Email Service; Stripe (and USDC via xinf's existing seller payouts). Auth is Ideator's: email codes,
  hashed bearer tokens, OAuth 2.1 with "My CLI on this computer". The registry installs its own auth from its own blocks.

## Development

Use pnpm 12.14.0 with Node 22.18 or later and Go 1.26.4. The root workspace maps the registry packages, native runtime block payloads, recipes, contract examples and installer fixtures. pnpm installs the pinned Bun runtime and Cargo dependencies/toolchain; Go modules remain managed by Go.

```sh
pnpm bootstrap                 # install workspace + Cargo dependencies, then Go modules
pnpm workspace:map             # names and paths for every workspace package
pnpm check                     # lint, typecheck, unit/runtime tests, schema/plugin validation
pnpm build                     # local bundles and native binaries; Worker builds are dry runs
pnpm test:e2e                  # browser flow + clean-host block installation
```

Browser tests need Chromium installed once with `pnpm --filter kitbash-recipe-playwright-worker-e2e browsers:install`. See [workspace commands and native dependency resolution](docs/WORKSPACE.md) for filters, Docker checks and installing the runtime blocks. Bun, Go and Rust are variants of the [Cloudflare container block](blocks/cloudflare-container/docs/README.md); real-time rooms use the [WebSocket block](blocks/hibernating-websocket/docs/README.md).

## Documents

| File | What |
|---|---|
| [`docs/DESIGN.md`](docs/DESIGN.md) | Positioning, landscape, block format decisions, agent flow and MCP contract, tiers/forks/royalties, security, architecture, roadmap, open questions |
| [`docs/BLOCK-SPEC.md`](docs/BLOCK-SPEC.md) | The manifest schema, install semantics, lock file, signing, scanner rules, and a worked `email-code-auth` block for Hono + D1 |
| [`docs/WORKSPACE-REVIEW-2026-10.md`](docs/WORKSPACE-REVIEW-2026-10.md) | October workspace review: independent pattern PRs, evidence, validation and adoption boundaries |
| [`docs/HARVEST.md`](docs/HARVEST.md) | 37 candidate blocks found in the owner's repos, with golden sources, rebuild counts, quality notes and effort |
| [`docs/PLAN.md`](docs/PLAN.md) | Work packages (MVP, v1, v2) sized for one agent session each, with ownership, dependencies, acceptance and tests |

## Roadmap in one line each

- **MVP** (~1 week of agent sessions): private registry for the owner on `wrangler dev`, core + CLI + plugin with the
  MCP tools, reference test fixtures, five harvested blocks (`email-code-auth`, `cf-email-sender`, `cli-oauth-login`,
  `orgs-roles-invites`, `api-keys`), Ideator contract. Exit: Claude Code and Codex each install three blocks into a
  fresh template in one session with ≤ 3 manual edits and all block tests green.
- **v1**: accounts (from our own blocks), public/private, licenses, scanner, sandbox, review tiers, Stripe
  subscriptions and paid blocks, web UI, remote MCP, semantic search, telemetry, 20 more public blocks, deploy.
- **v2**: forks + lineage + similarity, proposals UI, royalty engine and payouts (Stripe Connect, USDC), x402
  per-install, Gitstalk mirror and pre-land gate, curated tier via an Ideator review loop.

## Name options

Kitbash (recommended: building new models from parts of other kits; CLI `kit`), Prefab, Quarry, Blockwork, Spolia.
Open question: Nullshot already calls its registry items "blocks"; Kitbash's unit could be a "kit" instead.

## Status

- 2026-10-18: founding design written.
- 2026-10-18: **MVP built and its exit met for Claude Code** (WP-01…WP-08; details and evidence in
  [`docs/PLAN.md`](docs/PLAN.md#status)). core + API (`wrangler dev` only) + `kit` CLI + plugin + 8 blocks
  (`crypto-utils`, `cf-email-sender`, `email-code-auth`, `cli-oauth-login`, `orgs-roles-invites`, `api-keys`,
  `d1-rate-limit`, `vitest-workerd-harness`). Tests: core 171, api 86, cli 71, plugin 19, contract examples 15, e2e
  harness 28/28 (every block, conflict resolutions, the three-block MVP chain). `scripts/e2e-mvp.sh`: a headless Claude
  Code session installed email-code-auth + cli-oauth-login + orgs-roles-invites from the local registry into a fresh
  `test-e2e/fixtures/hono-d1`, with 1 file edited outside block files, all block tests passing, in 203 s for $0.93.
  The Codex repeat installed and verified the same blocks but edited 6 files (sandbox workarounds and extras), so its
  ≤ 3 edits criterion is open. kit-api's own bearer tokens now come from `email-code-auth`, installed from the registry.
- 2026-10-19: block `cf-analytics` (hono-d1): first-party analytics SDK for Canvalytics (signed `track`/`fact`/`log`/`identify`, relay, 1 KB snippet).
- No registry deployment or publication yet. The [October workspace review](docs/WORKSPACE-REVIEW-2026-10.md) tracks independent pattern contributions as PRs. Next product phase: v1 (WP-10…WP-19).
