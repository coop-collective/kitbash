# Plan

Written 2026-10-18. Work packages sized for **one agent session each**, with disjoint file ownership (a package never
edits another package's paths while both are in flight), explicit dependencies, acceptance criteria and tests, a model
suggestion (opus for anything that defines a contract or touches security; sonnet for well-specified build-out), and
parallel groups. MVP first. Status entries are appended under each stage as in Ideator's `PLAN.md` §6.

Conventions assumed (from `DESIGN.md` §9): monorepo `~/Workspace/feature-registry`, pnpm workspaces, TypeScript,
Hono + D1 raw SQL + `NNNN_name.sql`, vitest in workerd for the Worker, `node --test` or vitest-node elsewhere, no
secrets committed, local `wrangler dev` only until the owner deploys.

```
packages/core   packages/api   packages/cli   packages/plugin   blocks/   recipes/   test-e2e/fixtures/   docs/
```

---

## MVP: private registry for the owner, MCP search/get/install, 5 harvested blocks

Exit (from DESIGN §7): a fresh `test-e2e/fixtures/hono-d1` project gets `email-code-auth` + `cli-oauth-login` +
`orgs-roles-invites` installed by Claude Code through the `registry_*` tools in one session, adapts in ≤ 3 edits, and
every block test passes; the same with Codex; `kit-api` itself has `email-code-auth` installed from the registry.

| Phase | Group | Packages | Exit |
|---|---|---|---|
| MVP | G1 | WP-01, WP-05, WP-07 (draft) | Core schema + planner tested on fixtures; templates build and their tests pass |
| MVP | G2 | WP-02, WP-03 | `wrangler dev` serves publish/search/get/bundle; `kit install` works against it |
| MVP | G3 | WP-04, WP-06a, WP-06b, WP-06c | Plugin tools answer in Claude Code and Codex; blocks validate and pass in the template |
| MVP | G4 | WP-08 | The MVP exit above, recorded with evidence |

Rough calendar: four rounds; with 3–4 sessions in parallel per round, about one working week.

### WP-01 Core: schema, renderer, planner, lock, signing, client scanner

- **Model:** opus · **Group:** G1 · **Depends on:** — (reads `docs/BLOCK-SPEC.md`)
- **Owns:** `packages/core/**`, `docs/BLOCK-SPEC.md` (corrections only), root `package.json`, `pnpm-workspace.yaml`,
  `tsconfig.base.json`, `.gitignore`, `.editorconfig`
- **Deliverables**
  - `src/schema.ts`: zod schema for `block.json` exactly as BLOCK-SPEC §3–§8, with `validateManifest()` returning
    structured errors; `scripts/gen-schema.mjs` emits `schema/block.v1.json` and `schema/contract.v1.json`.
  - `src/contract.ts`: zod types for every `registry_*` tool input/output (DESIGN §3.2) and the `Card`, `Summary`, `Plan`,
    `LockEntry` types.
  - `src/render.ts`: `{{kit.name}}` substitution with modifiers (`pascal|camel|snake|upper|kebab`), `{{#kit.if}}`
    conditionals, `template: false` passthrough, typed param validation (an `identifier` that fails its pattern throws).
  - `src/profile.ts`: read/write `.kit/project.json`; `detectStack(root)` from `package.json`, `wrangler.*`, `next.config.*`,
    `vitest.config.*`, migrations dir.
  - `src/plan.ts`: variant/compat resolution, target path tokens, migration renumbering (`NNNN` and `TIMESTAMP` patterns),
    conflict checks (tables, routes, bindings, exports, existing files), config merges (`jsonc-deep` with binding-array
    union by name; `append-missing-lines`; `json-merge-patch`), `dependencies_to_add`, adapt rendering, unified diff
    generation. Pure: takes an in-memory file tree, returns a `Plan`; `applyPlan(fs, plan)` is the only writer.
  - `src/lock.ts`: `.kit/lock.json` read/write/update; `diffAgainstLock()`; `threeWayMerge(base, ours, theirs)` per file
    (diff3 algorithm, conflict markers) for `registry_upgrade`.
  - `src/hash.ts`, `src/sign.ts`: sha256, canonical manifest serialization (BLOCK-SPEC §8), Ed25519 sign/verify via
    WebCrypto, `verifyBundle(manifest, files, registryPubKey)`.
  - `src/scan.ts` (client subset): secret patterns (incl. `hq_`, `xk_live_`, `mc_`, `sk_live_`, `AKIA`, JWT, high entropy),
    path rules, executable bit, invisible Unicode/ANSI, prompt-injection heuristics on text fields, `verify.commands`
    allowlist check, declared-vs-shipped consistency.
  - `src/harvest.ts`: heuristics for `registry_harvest`: find migrations, `CREATE TABLE` names, Hono/Next route
    declarations, `env.X` references, test files; propose params from repeated app-specific literals; redact.
  - `src/summary.ts`: card and summary builders with a token estimator; refuses > 1,500 tokens.
- **Acceptance**
  - The worked example in BLOCK-SPEC §10 is checked in as `test/fixtures/blocks/email-code-auth-fixture/` (a small stand-in,
    not the real block) and validates; a manifest with a path `..`, an undeclared file, a `verify` command outside the
    allowlist, or a secret value each fails with the right error code.
  - Planning the fixture against `test/fixtures/projects/hono-d1-min/` (which already has `migrations/0004_x.sql`) yields
    `0005_auth.sql`, a `wrangler.jsonc` patch with two hunks, an `.dev.vars.example` append, zero conflicts; planning it
    twice yields byte-identical plans (golden snapshot); planning against a project with a `members` table reports a
    `table` conflict naming `tablePrefix`.
  - `threeWayMerge` reproduces Copier-style behaviour on three fixtures (clean, overlapping, conflicting).
  - Sign → tamper one byte → verify fails; sign → verify passes; canonical form stable across key order.
- **Tests:** vitest (node), ≥ 50 cases, golden files under `test/golden/`. `pnpm -F core test` green; `pnpm -F core typecheck`.

### WP-02 API Worker: D1 schema, publish/fetch, search, bundle, remote MCP (owner token only)

- **Model:** opus · **Group:** G2 · **Depends on:** WP-01 (imports `@kitbash/core` schema and contract types)
- **Owns:** `packages/api/**`
- **Deliverables**
  - `wrangler.jsonc` (local dev with placeholder ids; bindings `DB` D1, `BLOBS` R2, `SCAN` queue stub, cron commented),
    `migrations/0001_schema.sql` with the ● tables of DESIGN §6.2 plus `block_search` (FTS5) and triggers keeping it in sync.
  - Auth: `kit_` bearer tokens stored as HMAC with `TOKEN_PEPPER` (`.dev.vars.example`); `scripts/token.mjs` mints the
    owner's token (`pnpm kit:token`); every route but `/health` requires it. Orgs exist in the schema; MVP seeds one
    personal org `@coop` and every block lives in it (`pnpm kit:seed`).
  - REST (Hono): `POST /api/blocks/:scope/:name/versions` (JSON: manifest + files `{path, variant, content_b64}` or
    `{path, sha256}` for blobs already uploaded via `PUT /api/blobs/:sha256`; validates with core; stores blobs under
    `orgs/<org>/blobs/<sha256>`; computes `size`, card, summary; co-signs with the registry key from `REGISTRY_SIGNING_KEY`;
    rejects a reused version), `GET /api/search?q&framework&db&ui&tags&scope&limit`, `GET /api/blocks/:scope/:name`
    (versions, tags), `GET /api/blocks/:scope/:name/:version/{summary,manifest,files,skill,changelog}`,
    `GET /api/blocks/:scope/:name/:version/bundle?variant=` (files with content, ≤ 2 MB), `POST /api/blocks/:scope/:name/
    tags`, `POST /api/blocks/:scope/:name/:version/yank`, `POST /api/projects/:id/heartbeat` (upserts `projects`,
    `installs`), `POST /api/proposals` (stores the patch in R2, status `draft`), `GET /api/me`.
  - `/mcp`: `createMcpHandler` from `agents` with MCP SDK v2 (Ideator's pattern, with a proper `wrap(handler)` instead of
    the monkey-patch), tools `registry_search`, `registry_get`, `registry_read_file`, `registry_whoami`;
    `registry_install|verify|upgrade|harvest|publish|propose` registered but returning `{error: "needs_local",
    command: "kit …"}`; `readOnlyHint` on every read tool.
  - `vitest.config.ts` + `test/apply-migrations.ts` (the harness from Ideator) + `test/migration-upgrade.test.ts` scaffold.
- **Acceptance**
  - Publish the WP-01 fixture block → search "email code" returns its card in < 100 tokens with the right stack boost →
    summary ≤ 1,500 tokens → bundle hashes match → a second publish of the same version → 409.
  - A request without the token → 401; a blob path with `..` → 400; a manifest with a secret value → 422 with the finding.
  - MCP round trip: `tools/list` shows the 11 tools with annotations; `registry_search` over `/mcp` returns the same card.
- **Tests:** vitest in workerd, ≥ 35 cases. `pnpm -F api test`, `typecheck`, `wrangler dev` boots with `pnpm dev`.

### WP-03 CLI `kit`

- **Model:** opus · **Group:** G2 · **Depends on:** WP-01; WP-02's REST contract (tests run against an in-process mock
  server that implements the same routes from the contract types, so WP-02 and WP-03 run in parallel)
- **Owns:** `packages/cli/**`
- **Deliverables**
  - Commands: `kit login` (MVP: paste a token → `~/.kit/credentials` 0600; `KIT_TOKEN` wins), `kit init [--telemetry]`
    (writes `.kit/project.json` from `detectStack`), `kit search <q> [--stack]`, `kit get <block> [--detail]`,
    `kit install <block> [--variant --param k=v --apply --on-conflict --no-config]` (dry run by default; writes
    `.kit/plans/<id>.json|.diff`), `kit apply <plan_id>`, `kit verify <block>`, `kit upgrade <block> [--to]`, `kit diff <block>`,
    `kit harvest --name --paths… --desc` (→ `.kit/drafts/<name>/`), `kit validate <dir>`, `kit publish <dir> [--visibility
    --license --tag]` (client scan first; signs with the member key, generated on first publish into the keychain or
    `~/.kit/keys/`), `kit propose <block> --title --why`, `kit status`, `kit heartbeat --quiet`.
  - `src/api.ts` client over fetch; `src/fs.ts` adapter for core; `src/verify.ts` runs allowlisted commands with cwd,
    timeout, captured tail; `src/keys.ts` keychain via `security`/`secret-tool` with file fallback.
  - Single-file build (`tsup`), runnable as `node packages/cli/dist/kit.js` and via `pnpm kit`.
- **Acceptance**
  - Against the mock server and `test-e2e/fixtures/hono-d1` (copied to a temp dir): `kit install @coop/fixture` prints a plan with
    the renumbered migration and the config hunks and writes nothing; `--apply` writes exactly the planned files, patches
    `wrangler.jsonc` preserving comments, writes the lock; `kit verify` runs the block's vitest and records `passed`;
    editing an installed file then `kit diff` shows the hunk; `kit propose` produces a patch with `{{kit.tokenPrefix}}`
    restored; `kit upgrade --to 1.1.0` against a fixture v1.1.0 produces a clean merge for the untouched file and a
    conflict for the edited one; `kit harvest` on the template's own health route produces a draft that `kit validate` accepts
    after filling two TODOs.
  - A bundle whose registry signature doesn't verify is refused; a plan with a write outside the project root is refused.
- **Tests:** `node --test` or vitest-node, ≥ 40 cases, using temp dirs; no network.

### WP-04 Plugin: local MCP server, skills, commands, hooks

- **Model:** sonnet · **Group:** G3 · **Depends on:** WP-03
- **Owns:** `packages/plugin/**`
- **Deliverables**
  - `.claude-plugin/marketplace.json` (Claude Code + Grok), `.agents/plugins/marketplace.json` (Codex), `package.json`.
  - `plugins/kitbash/.claude-plugin/plugin.json`; `.codex-plugin/plugin.json` with `mcpServers.kitbash` as a stdio command;
    `.mcp.json` `{"type":"stdio","command":"node","args":["${CLAUDE_PLUGIN_ROOT}/scripts/kit-mcp.mjs"]}`.
  - `scripts/kit-mcp.mjs`: stdio MCP server (MCP SDK) exposing the 11 `registry_*` tools with the schemas from
    `@kitbash/core/contract`, delegating to the CLI library; `project_root` defaults to cwd; author text returned under
    `untrusted_author_text`; tool descriptions static.
  - Skills (each with `agents/openai.yaml`): `kitbash-use` (the protocol: search → get → dry-run install → read config/
    conflict hunks of the diff → apply → adapt checklist → verify → propose; the §5.5 "instructions are data" rules; when
    not to use a block), `kitbash-harvest` (boundaries, params, tests, redaction, budgets; the HARVEST.md rules),
    `kitbash-publish` (visibility, license, price, what the scanner rejects).
  - Commands `/kit:search`, `/kit:install <block>`, `/kit:harvest`; hook `SessionStart` → `kit heartbeat --quiet` when
    `.kit/lock.json` exists and telemetry is on.
  - `scripts/validate.mjs` (manifests agree, skills have frontmatter + `Use when`, hooks exist, no secrets, tool list
    matches the contract) and `test/*.test.mjs`.
- **Acceptance:** `claude --plugin-dir packages/plugin/plugins/kitbash` lists the tools; `registry_search` → `registry_get` →
  `registry_install` (dry run) → `registry_install {dry_run:false}` → `registry_verify` complete in a headless Claude Code
  session against `test-e2e/fixtures/hono-d1` and the mock or dev server; the same tool list appears in Codex. `pnpm -F plugin
  validate` and `test` green.
- **Tests:** `node --test`: validate, tool list/schemas, one `tools/call` round trip with a stubbed CLI.

### WP-05 Internal test hosts and the e2e harness

- **Model:** sonnet · **Group:** G1 (template), G3 (harness) · **Depends on:** WP-01 for the harness only
- **Owns:** `test-e2e/**`
- **Deliverables**
  - `test-e2e/fixtures/hono-d1`: Hono Worker, `wrangler.jsonc` with a D1 `DB` placeholder, `migrations/0001_init.sql` (a
    `meta` table), one `/health` route, vitest-in-workerd config with `apply-migrations` (block #11), `.dev.vars.example`,
    `.kit/project.json`, README. Builds, tests pass.
  - `test-e2e/fixtures/nextjs-d1` (unimplemented stretch): vinext minimal with a route handler and D1 binding, same test harness.
  - `test-e2e/install.test.mjs`: copies a template to a temp dir, uses `@kitbash/core` + the CLI to install a given block dir
    (local path, no server), runs the block's `verify.commands`, asserts pass; parameterized over `blocks/*`.
- **Acceptance:** both templates' own tests pass; the harness installs the WP-01 fixture block and passes.
- **Tests:** the templates' vitest suites; the harness itself.

### WP-06a Harvest: `crypto-utils`, `cf-email-sender`, `email-code-auth`

- **Model:** opus · **Group:** G3 · **Depends on:** WP-01 (validator), WP-05 (template + harness)
- **Owns:** `blocks/crypto-utils/**`, `blocks/cf-email-sender/**`, `blocks/email-code-auth/**`
- **Sources:** HARVEST #12, #8, #1 (golden `social-connector/telegram-connector/src/auth/email-code.ts`; tokens and
  limits from `ideator/packages/api/src/auth.ts`; mailer from `ideator/packages/api/src/mail.ts`).
- **Deliverables:** three block directories per BLOCK-SPEC with the `hono-d1` variant, params (`appSlug`, `tokenPrefix`,
  `tablePrefix`, `routePrefix`, `appDomain`, `codeTtlMin`, `mailer`), tests (the scenario in BLOCK-SPEC §10), `SKILL.md`
  ≤ 1,500 tokens, CHANGELOG, `provenance.source` filled, `registryDependencies` wiring (`email-code-auth` → the other two).
- **Acceptance:** `kit validate` clean (scanner too); `test-e2e` installs all three into `test-e2e/fixtures/hono-d1` with defaults and
  with `tokenPrefix=mc_ tablePrefix=app_` and both pass; summary and SKILL.md within budget; a second install of
  `email-code-auth` into a project with a `members` table reports the conflict and `tablePrefix=auth_` resolves it.

### WP-06b Harvest: `cli-oauth-login`, `orgs-roles-invites`

- **Model:** opus · **Group:** G3 · **Depends on:** WP-01, WP-05; interface contract with WP-06a is BLOCK-SPEC §10's
  `exports` (`authenticate`, `requireBearer`, tables), so the two run in parallel and integrate in WP-08
- **Owns:** `blocks/cli-oauth-login/**`, `blocks/orgs-roles-invites/**`
- **Sources:** HARVEST #2 (`ideator/packages/api/src/oauth.ts`, `cli-logins.ts`, migrations 0025/0034, tests) and #5
  (`ideator/packages/api/src/orgs.ts`, migration 0033, REST, `inviteMail`, tests).
- **Deliverables:** the consent page moved to a template file with brand params; `cli_logins` + grants; `orgOf(env)`
  scoping; roles; invites with the daily cap; `org_default` special cases removed behind params; tests ported to the
  template; SKILL.md with the adapt steps (mount `/authorize`, `/oauth/*`, configure `OAUTH_KV`, set `MAIL_FROM`).
- **Acceptance:** `kit validate` clean; `test-e2e` installs `email-code-auth` (from WP-06a's directory) then both blocks
  into the template and all tests pass; an MCP client's OAuth flow against `wrangler dev` of the template reaches the
  consent page and issues a `cli_logins` grant (scripted with `test/oauth-helpers.ts` ported from Ideator).

### WP-06c Harvest: `api-keys`, `d1-rate-limit`, `vitest-workerd-harness`

- **Model:** sonnet · **Group:** G3 · **Depends on:** WP-01, WP-05
- **Owns:** `blocks/api-keys/**`, `blocks/d1-rate-limit/**`, `blocks/vitest-workerd-harness/**`
- **Sources:** HARVEST #6 (`inference-market/packages/web/src/keys.ts`), #7 (`mailcheap/lib/rate-limit.js` +
  `migrations/0002_rate_limits.sql`, JS → TS), #11 (`ideator/packages/api/{vitest.config.ts,test/apply-migrations.ts,
  test/migration-upgrade.test.ts}`).
- **Acceptance:** `kit validate` clean; `test-e2e` installs each into the template and passes; `api-keys` without KV
  binding degrades to no cache (documented); `d1-rate-limit` fails closed when `ENVIRONMENT=production` and the table
  is missing (tested).

### WP-07 Ideator contract document

- **Model:** sonnet · **Group:** G1 (draft) → finalize after WP-01 · **Depends on:** WP-01's `contract.ts` for the
  final schema
- **Owns:** `docs/CONTRACT-ideator.md`, `docs/examples/**`
- **Deliverables:** the `registry_*` tool contract as prose + JSON Schema reference (`packages/core/schema/
  contract.v1.json`), example request/response pairs for Planner (`search`), Builder (`get` → `install` dry run →
  apply → `verify`) and Harvester (`harvest` → `publish`), the `hq_report.evidence.blocks_installed[]` shape, and a
  proposed section for Ideator's `docs/DESIGN-autopilot.md` (text only; this plan never edits the Ideator repo).
- **Acceptance:** every example validates against `contract.v1.json` (`node --test` in `docs/examples/`).

### WP-08 Dogfood and MVP exit

- **Model:** opus · **Group:** G4 · **Depends on:** everything above
- **Owns:** `README.md` (status section), `docs/PLAN.md` (status entry), `scripts/e2e-mvp.sh`, and, for this package
  only, `packages/api/**` to install blocks into it (WP-02 is finished by then)
- **Deliverables**
  - `scripts/e2e-mvp.sh`: boots `wrangler dev`, seeds `@coop`, publishes `blocks/*` with `kit publish`, copies
    `test-e2e/fixtures/hono-d1` to a temp dir, runs a headless Claude Code session with the plugin and the prompt "add email-code
    sign-in, CLI OAuth login and orgs using the registry", asserts the lock has three blocks, runs `kit verify` for each,
    counts the agent's edits outside block files (≤ 3), repeats with Codex.
  - Dogfood: `kit install @coop/email-code-auth --param tokenPrefix=kit_` into `packages/api`, replacing WP-02's minted-
    token auth with the block's; its tests pass; `pnpm kit:token` keeps working.
  - Status entry here and in README (tests counts, deviations), plus an "MVP exit evidence" note with the two session logs'
    token usage, for the pitch ("a 3-feature install cost N tokens").
- **Acceptance:** DESIGN §7 MVP exit met and recorded; all package test suites green; `pnpm validate` green.

---

## v1: public tier, accounts, scanning, sandbox, subscriptions, web UI, deploy

| WP | Title | Model | Group | Depends on | Owns | Acceptance (short) |
|---|---|---|---|---|---|---|
| WP-10 | Accounts and orgs in `kit-api` **from blocks**: `email-code-auth`, `cli-oauth-login`, `orgs-roles-invites`, `cf-email-sender`; publisher keys registration; `kit login` via OAuth "My CLI on this computer" | opus | H1 | MVP | `packages/api/**`, `packages/cli/src/login*` | A new person signs up by email code, `kit login` opens the browser and lands a `cli_logins` grant; scopes = orgs |
| WP-11 | Visibility and licensing: public scopes, per-version license (MIT/Apache/Kitbash-Commercial/Proprietary), `forkable`, `origin`; shadcn-compatible `/r/@scope/<name>.json` with header auth; yank/takedown | opus | H1 | MVP | `packages/api/src/public*`, `packages/api/src/shadcn.ts`, `docs/LICENSES.md` | `npx shadcn add @kitbash/<ui-block>` works against `wrangler dev`; a private block is invisible to another org in search, get, `/r/` and lineage |
| WP-12 | Scanner queue: publish → `SCAN` queue → full static scan (DESIGN §5.2: OSV, typosquat, injection heuristics, consistency) → co-sign → tier `scanned`; findings UI/API; tier drop on sensitive-field changes; 72-hour `latest` cooldown for public | opus | H1 | MVP | `packages/api/src/scan/**`, `packages/core/src/scan.ts` (server extensions) | Seeded malicious fixtures (secret, `..`, `child_process`, "ignore previous instructions", zero-width chars, a non-existent npm name) are all caught; a clean block is co-signed within one queue run |
| WP-13 | Sandbox runs: render with defaults into internal `test-e2e/fixtures/<stack>` hosts inside Cloudflare Sandbox/Containers, egress limited to npm, run `verify.commands`, store log + badge; random re-runs for top earners (hook for v2) | opus | H2 | WP-12, WP-05 | `packages/sandbox/**`, `packages/api/src/sandbox.ts` | The 5 MVP blocks pass in the sandbox; a block with a failing test shows `sandbox: failed` and can't reach `verified` |
| WP-14 | Stripe: subscriptions (Free/Pro/Team), entitlements (private block quota, members), paid blocks (one-time per org, 14-day refund), webhooks; built from the `stripe-billing` block once harvested (WP-18) or directly with social-connector's core | opus | H2 | WP-10 | `packages/api/src/billing/**`, `blocks/stripe-billing/**` | Test-mode checkout → Pro; a 6th private block on Free → 402 with upgrade link; buying a paid block unlocks `bundle` for that org only |
| WP-15 | Web UI: browse/search, block page (summary, interface, files tree, versions, trust badges, provenance, lineage placeholder), org settings (members, invites, keys, tokens), billing, proposals inbox; `packages/web` on vinext or Hono + Vite | sonnet | H2 | WP-10, WP-11 | `packages/web/**` | A visitor finds a public block and copies the `kit install` line; an owner invites a member and revokes a CLI login |
| WP-16 | Remote `/mcp` with OAuth for cloud agents; Vectorize semantic search (hybrid with FTS5; borrow Nullshot's indexer pattern); card precompute | sonnet | H2 | WP-10 | `packages/api/src/mcp.ts`, `packages/api/src/search/**` | Claude.ai (cloud) connects over OAuth and searches; "sign in with email code and send a bearer token" ranks `email-code-auth` first |
| WP-17 | Telemetry: `kit init --telemetry` prompt, daily heartbeats (lock block list only), `projects/installs`, monthly `usage_months` rollup (counting only, no money), org dashboard "where my blocks run" | sonnet | H2 | WP-10 | `packages/api/src/usage/**`, `packages/cli/src/heartbeat.ts`, `packages/plugin/hooks/**` | Two projects in two orgs with passing verifies produce two rows for a block in the month; self-use is flagged `excluded` |
| WP-18 | Public harvest batch 1 (20 blocks from HARVEST v1 rows: `stripe-billing`, `credits-ledger` (simple), `session-cookie`, `mcp-server-stateless`, `outbound-approvals-queue`, `do-websocket-room`, `r2-upload`, `waitlist-turnstile-posthog`, `posthog-server`, `feature-flags`, `turnstile-verify`, `site-gate-passcode`, `admin-allowlist`, `account-deletion`, `hmac-webhook-receiver`, `cron-fanout-job-recovery`, `seo-og-sitemap`, `telegram-bot-alerts`, `cf-provisioning-scripts`, `agent-plugin-scaffold`) | opus ×2 sessions + sonnet ×2 (split by HARVEST rows; disjoint `blocks/<name>/**`) | H3 | WP-11, WP-12 | `blocks/**` (per block) | Each validates, passes the sandbox, carries provenance and a license; the owner approves each public publish |
| WP-19 | Deploy and ops: Cloudflare account/domain per the owner's decision, production `wrangler.jsonc` env, D1 migration replay test against production history, R2 lifecycle, alerts (Telegram block), runbook | opus | H3 | WP-10…WP-17 | `packages/api/wrangler.jsonc` (env), `docs/RUNBOOK.md`, `.github/workflows/**` | A stranger signs up, installs a public block with their agent, buys one paid block (test mode until the owner flips live) |

Parallel groups: H1 {WP-10, WP-11, WP-12} → H2 {WP-13, WP-14, WP-15, WP-16, WP-17} → H3 {WP-18 (4 sessions), WP-19}.

## v2: forks, lineage, proposals, royalties, payouts, x402, Gitstalk

| WP | Title | Model | Group | Depends on | Owns | Acceptance (short) |
|---|---|---|---|---|---|---|
| WP-20 | Fork and lineage: `kit fork`, immutable `lineage` edges, content-chunk similarity index at publish, `relation` computation, undeclared-lineage detection, fork tree API | opus | K1 | v1 | `packages/api/src/lineage/**`, `packages/cli/src/fork.ts`, `packages/core/src/similarity.ts` | A renamed copy of a public block is refused without lineage; a fork that adds a `nextjs-d1` variant computes `fork` with similarity ≈ 0.6 |
| WP-21 | Proposals: review UI and API (accept/edit/decline → draft next version), contributor records and author-set contributor share; "Suggest upstream" from a fork | sonnet | K1 | v1 | `packages/api/src/proposals/**`, `packages/web/src/proposals/**` | A `kit propose` from a fork lands as a new version with the contributor listed |
| WP-22 | Royalty engine: monthly cron: user-centric pool (30% of subscriptions), dampening and eligibility rules (DESIGN §4.5), lineage split (75/15/7/3), mirror/inspired handling, contributor shares, `royalty_ledger`; published-rules page; private weights in settings | opus | K2 | WP-17, WP-20, WP-21 | `packages/api/src/royalties/**`, `docs/ROYALTIES.md` | Fixture month with 4 orgs, 6 projects, 1 fork chain reproduces the hand-computed ledger to the cent; self-use and < 3-org blocks earn 0 |
| WP-23 | Payouts (fiat): Stripe Connect Express onboarding, 30-day hold, $10 threshold, clawbacks on refunds, statements | opus | K3 | WP-22 | `packages/api/src/payouts/stripe*` | Test-mode payout for a fixture author; a refund nets against the next payout |
| WP-24 | Payouts (USDC): linked Solana wallet, period payouts via xinf's seller rail or a direct transfer with proof; 2FA | opus | K3 | WP-22 | `packages/api/src/payouts/usdc*` | Devnet payout recorded with tx proof |
| WP-25 | x402 per-install for paid blocks (agents with wallets; `exact` scheme; replay guard; refund on failed bundle), harvested from xinf as `x402-paywall` | sonnet | K3 | WP-14 | `blocks/x402-paywall/**`, `packages/api/src/x402.ts` | A `kit install` with no account and a wallet pays and receives the bundle on devnet |
| WP-26 | Gitstalk: optional public mirror of block sources (one repo per public block), pre-land check as an alternative sandbox gate, `why_lines` attribution link on the block page | sonnet | K2 | v1 | `packages/api/src/gitstalk/**` | A public block's versions appear as landed beans; a failing test can't land |
| WP-27 | Curated tier: an Ideator review loop (automation) reads a block, runs a checklist, records a named review; curated badge; spot re-runs for top earners | sonnet | K2 | WP-13 | `packages/api/src/review/**`, Ideator automation text in `docs/CONTRACT-ideator.md` | A block reaches `curated` only after a recorded review |

Parallel groups: K1 {WP-20, WP-21} → K2 {WP-22, WP-26, WP-27} → K3 {WP-23, WP-24, WP-25}.

---

## Status

- 2026-10-18: design written (this folder). No code yet. Awaiting the owner's answers to DESIGN §9 (name, "block" vs
  "kit", public timing, payout rails, pricing, domain/account, licensing of harvested code, telemetry default,
  build-from-blocks on day one).
- 2026-10-18: WP-01…WP-07 merged (core, API, CLI, plugin, e2e harness, 8 blocks, Ideator contract draft).
- 2026-10-18: **WP-08 (dogfood and MVP exit): done for Claude Code; the Codex repeat installs and verifies everything but misses the ≤ 3 edits count.**
  - Integration fixes first (two commits before the WP-08 one): cli-oauth-login and orgs-roles-invites now run on the
    real email-code-auth (1.1.0 adds `consumeCode`, a code → member check that mints no token; their tests make people
    with its `upsertMember`, since `members.created_at` is NOT NULL, and use a 32+ char pepper); core: `template: false`
    text files no longer crash the planner, `kit validate` enforces the 1,500-token summary budget, templated route
    paths are rendered before the consistency check, `e2e.json` is an allowed undeclared file (removed from every
    block's `files[]`); `kit install` resolves `registryDependencies` itself (local siblings / `--blocks-dir` /
    registry, dependencies first, planned on an overlay, `--param <dep>.<name>=v`); `kit login` sends the bearer for
    `/api/registry/key` (kit-api serves it behind auth; found by the first real run against `wrangler dev`). Each fix
    has a regression test.
  - Tests: core 171, api 86, cli 71, plugin 19, docs/examples 15; all typechecks and `pnpm validate` green. e2e harness
    28/28: every block's defaults and param cases, a resolved-conflict case for each block that declares tables (and
    vitest-workerd-harness's file conflicts), core's fixture, and the chains `mvp-auth-stack`
    (email-code-auth → cli-oauth-login → orgs-roles-invites), `mvp-auth-stack-prefixed` and
    `api-keys-with-rate-limit-and-harness`. The harness reads `blocks/*/e2e.json`, installs through `kit install
    --blocks-dir`, runs `pnpm install` when a block adds npm dependencies, and verifies every block in the lock.
  - `scripts/e2e-mvp.sh`: local `wrangler dev` of kit-api (temp state, throwaway pepper and registry key), seed, token,
    `kit login`, `kit publish` of all 8 blocks, a fresh `test-e2e/fixtures/hono-d1` copy, a headless Claude Code session with
    the plugin (allowlisted tools only; push/deploy/publish/curl/web denied; $5 and 30 min caps), then lock check,
    `kit verify` of every block and the edit count. `--no-agent` runs the same with a scripted install; `--codex` adds
    the Codex repeat.
  - **MVP exit evidence (Claude Code, claude-opus-5-5, 2026-10-18):** one session, prompt "add email-code sign-in, CLI
    OAuth login and orgs using the registry": 3 searches, 3 gets, 7 installs (dry runs + applies; dependencies
    crypto-utils and cf-email-sender came in with email-code-auth), 5 verifies, all PASS (70/70 project tests). Edits
    outside block files: 1 file by the git count (`src/index.ts`: mount routes, `requireBearer`, `requirePerson` +
    `requireOrg` on `/mcp`, `export default oauthWorker(app)`); by Edit/Write calls 3 (`src/index.ts`, one added
    `PUBLIC_ORIGIN=` line in the kit-patched `.dev.vars.example`, and a smoke test it wrote and deleted). 203 s wall,
    45 turns, **$0.93**; tokens: 54 input, 11,426 output, 1,538,211 cache read, 74,032 cache write. For the pitch: a
    3-feature install (5 blocks, ~3,200 lines with tests) cost under $1 and ~1.6M mostly cached input tokens.
  - Codex repeat (codex-cli 0.162.1, `codex exec`, workspace-write sandbox, kitbash MCP tools pre-approved): same
    prompt, all five blocks installed through the `registry_*` tools and all five `kit verify` PASS (73 project tests),
    585 s, tokens 4,005,903 input (3,874,944 cached) and 17,723 output (6,205 reasoning); cost not reported (ChatGPT
    sign-in). **Edits outside block files: 6**, so the ≤ 3 criterion is not met: the wiring itself is one file
    (`src/index.ts`), three are workarounds for its sandbox, which cannot write outside the project (`storeDir` in
    `pnpm-workspace.yaml`, `WRANGLER_LOG_PATH` in `vitest.config.ts`, `.gitignore` for them), and two are unrequested
    extras (README notes, `test/integration.test.ts`). Fix before v1: run Codex with the store and Wrangler log paths
    writable (or pre-set in the template), and say "no extra files" in the prompt.
  - Dogfood: kit-api has `@coop/email-code-auth@1.1.0` (+ crypto-utils, cf-email-sender with `mailer=console`)
    installed **from the registry** (`kit install @coop/email-code-auth --param tokenPrefix=kit_ ...` against
    `wrangler dev`), all three `kit verify` PASS. `src/auth.ts` is now a thin adapter: the block's `resolveBearer`
    plus the caller's orgs and default org. Deviations: WP-02's own `members`/`member_tokens` were folded out of
    `0001_schema.sql` (never deployed) and the block's `0002_auth.sql` creates them; `0003_member_default_org.sql` adds
    kit-api's `default_org_id`; WP-02's auth tests moved to `test/api-auth.test.ts` (the block's own test took
    `test/auth.test.ts`); the block's sign-in routes are not mounted (adapt item `mount-routes` recorded as skipped:
    sign-up with orgs is WP-10). `pnpm kit:token` keeps working (it hashes with the block's HKDF purpose key; a test
    pins that) and a `wrangler dev` check answered `/api/me` 200 with the minted token, 401 with a fake one.
  - Gaps before v1 (public tier): accounts (WP-10: mount email-code sign-in and `cli-oauth-login` in kit-api, `kit
    login` over OAuth), visibility/licensing and `/r/` (WP-11), the server-side scanner queue and co-sign tiers
    (WP-12), sandboxed verify runs (WP-13), billing, web UI, remote MCP OAuth, telemetry, deploy (WP-14…WP-19).
    Smaller ones found here: `kit apply <plan_id>` of a plan that had dependencies is refused as stale (use `kit
    install --apply --plan-id`); dependency params are not shared automatically (a `tokenPrefix` must be passed to
    both blocks); `kit init` detects `npm` inside a pnpm workspace package; the harness' remaining "extended"
    assertions (exact migration numbers) are not encoded; Ideator still needs the WP-07 contract finalized.
