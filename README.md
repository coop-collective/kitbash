# Kitbash

**An MIT-licensed, open-source toolkit for coding agents building and maintaining applications.** Kitbash combines reusable feature blocks, project bootstraps, tested recipes, and focused maintenance skills, with a plugin for Claude Code and Codex.

The catalog ships in this repository. Install its source into your project, adapt the wiring, and run its checks. You do not need a Kitbash account, subscription, or hosted registry. Your application owns the copied code.

| Part | What it supplies |
| --- | --- |
| [17 blocks](#available-blocks) | Feature code, tests, migrations, configuration, and adaptation instructions |
| [3 project presets](#start-a-project) | A runnable Worker, vinext app, or local Rust server, with compatible blocks selected at bootstrap |
| [81 UI components](#ui-components) | Styrene-themed React parts for agent and AI products, browsable in Storybook |
| [7 recipes](#recipes) | Working examples for CI, integration tests, coverage, linting, and build checks |
| [3 maintenance skills](#maintenance-and-pstack) | Explicit TypeScript, Rust, and page-delivery reviews after merge or before release |
| [Agent plugin](#use-the-plugin) | Local MCP tools and skills for discovery, installation, verification, and secret setup |

## Get started

Use Node.js 22.18 or later and the repository's pinned pnpm version, currently 12.14.0.

```sh
git clone https://github.com/coop-collective/kitbash.git
cd kitbash
pnpm install
pnpm --filter @kitbash/cli build
pnpm --filter @kitbash/plugin build
export KITBASH_ROOT="$PWD"
```

Build before loading the plugin: it bundles its runtime and local catalog so an installed copy can work without this checkout's dependencies. After updating the checkout, rebuild and reload or reinstall the plugin. Native container development also needs the relevant Bun, Go, Rust, and Docker tooling; see [workspace setup](docs/WORKSPACE.md).

## Use the plugin

The plugin is named `kit`; its local MCP server is named `kitbash`.

### Claude Code

From the project you want to work on, launch Claude with the built plugin:

```sh
claude --plugin-dir "$KITBASH_ROOT/packages/plugin/plugins/kitbash"
```

Then use a command or describe the task:

```text
/kit:bootstrap Create a Worker in ../my-api with jwt-session-cookie and r2-private-uploads.
/kit:search Find a block for tenant-scoped WebSocket rooms.
/kit:install /absolute/path/to/kitbash/blocks/hibernating-websocket
/kit:secrets setup my-api staging
```

`--plugin-dir` loads the plugin for that session. See [Claude Code's plugin guide](https://code.claude.com/docs/en/plugins/create) for its installation options.

### Codex

Register the built local plugin catalog, install `kit`, and start a new session in your application:

```sh
codex plugin marketplace add "$KITBASH_ROOT/packages/plugin"
codex plugin add kit@kitbash
```

Here, “marketplace” is the CLI's name for the local plugin catalog. These commands do not connect to a Kitbash service. See [OpenAI's plugin documentation](https://learn.chatgpt.com/docs/plugins) for plugin discovery and management.

```text
Use $kitbash-bootstrap to create a vinext app in ../my-web with public-edge-cache.
Use $kitbash-use to install /absolute/path/to/kitbash/blocks/member-profiles into this Worker, adapt it, and verify it.
Use $kitbash-secrets to set up staging secrets for the registered my-api project.
Use $kitbash-accounts to check readiness for company account and OAuth app setup.
Use $kitbash-ui to build the run-approval screen from the Styrene components.
```

For a harness that only supports MCP, configure a stdio server running `node /absolute/path/to/kitbash/packages/plugin/plugins/kitbash/scripts/kit-mcp.mjs`. MCP-only setup exposes tools; it does not install the plugin's skills or commands.

### How block installation works

The agent finds a block in this README, the local `blocks/` directory, or the installed plugin's `runtime/catalog/blocks/`. The `kitbash_bootstrap` tool with `list: true` lists presets; add `preset: "worker"` or `"vinext"` to list compatible blocks.

For an existing project, inspect and install using the block's **absolute local directory** and the application's `project_root`. Use the installed block ID returned by the installer for subsequent verification and maintenance:

| Step | Tool | Result |
| --- | --- | --- |
| Inspect | `registry_get` | Parameters, dependencies, bindings, migrations, and adaptation checklist |
| Preview | `registry_install` with `dry_run: true` | Planned files, configuration changes, conflicts, and a `plan_id` |
| Apply | `registry_install` with `dry_run: false` and that `plan_id` | The reviewed source changes installed into the project |
| Adapt | Agent edits guided by the checklist | Routes mounted, authentication connected, bindings and application behavior wired |
| Verify | `registry_verify` | Block checks run and results recorded in `.kit/lock.json` |
| Maintain | `registry_diff`, `registry_upgrade` | Review local changes and plan upgrades |

The `registry_*` names are retained from the earlier implementation; local inspection, installation, and verification need no registry login. `registry_search` and remote publishing tools still belong to the legacy registry workflow and are not needed for this toolkit.

Source modules land under `src/lib/<block-name>/` and routes under `src/routes/<block-name>/`, using the project's configured paths. Tests and migrations remain in their normal top-level folders. Container service code lives under `containers/<serviceName>/`. Installation records pending adaptation work; copied files alone do not mean the feature is integrated.

## Available blocks

All 17 block manifests currently declare MIT. Most target **TypeScript on Cloudflare Workers with Hono/D1**. Check a block's manifest and guide for its actual bindings, dependencies, and verification commands.

| Block | What you get |
| --- | --- |
| [crypto-utils](blocks/crypto-utils/docs/README.md) | WebCrypto helpers for HMAC, purpose-specific keys, constant-time comparison, and random codes |
| [cf-email-sender](blocks/cf-email-sender/docs/README.md) | Cloudflare Email Service sending, development output, and test overrides |
| [email-code-auth](blocks/email-code-auth/docs/README.md) | Email-code sign-in and peppered bearer tokens |
| [session-cookie](blocks/session-cookie/docs/README.md) | Revocable opaque browser sessions, host cookies, and mutation-origin checks |
| [jwt-session-cookie](blocks/jwt-session-cookie/docs/README.md) | JWT browser session cookies with D1 revocation |
| [cli-oauth-login](blocks/cli-oauth-login/docs/README.md) | OAuth authorization and sign-in for a person's own CLI |
| [api-keys](blocks/api-keys/docs/README.md) | Prefixed API keys, HMAC storage, owner routes, and optional KV verification caching |
| [orgs-roles-invites](blocks/orgs-roles-invites/docs/README.md) | Organizations, memberships, roles, and email invitations |
| [member-profiles](blocks/member-profiles/docs/README.md) | Owner-editable profiles, unique handles, and revision-safe updates |
| [d1-rate-limit](blocks/d1-rate-limit/docs/README.md) | Fixed-window D1 rate limiting that fails closed in production |
| [r2-private-uploads](blocks/r2-private-uploads/docs/README.md) | Bounded private uploads with tenant-scoped R2 keys |
| [public-edge-cache](blocks/public-edge-cache/docs/README.md) | Explicit public GET response caching at the Worker gateway |
| [tiered-result-cache](blocks/tiered-result-cache/docs/README.md) | Validated result caching through edge cache, optional KV, and an authoritative loader |
| [hibernating-websocket](blocks/hibernating-websocket/docs/README.md) | Tenant-scoped Durable Object WebSocket rooms with hibernation, replay, and client examples |
| [cloudflare-container](blocks/cloudflare-container/docs/README.md) | Authenticated container gateway and **Bun, Go, or Rust** service variants with Docker smoke checks |
| [cf-analytics](blocks/cf-analytics/docs/README.md) | Signed first-party events, facts, logs, identification, and a browser relay for a compatible Canvalytics ingest |
| [vitest-workerd-harness](blocks/vitest-workerd-harness/docs/README.md) | Workerd integration tests, applied D1 migrations, and production migration-history replay |

The result-cache loader can read **D1, Durable Objects, R2, Analytics Engine query results, or another store**. The helper caches validated JSON results; authentication decisions, secrets, event writes, and binary streams stay outside that cache. See its [store adapters and consistency guidance](blocks/tiered-result-cache/docs/README.md).

## Start a project

Presets provide the application shell; blocks provide reusable features.

| Preset | Starting point | Block compatibility |
| --- | --- | --- |
| `worker` | Hono Worker, D1 migrations, workerd tests, health endpoint, Wrangler environments | Runtime Worker blocks; the testing harness is already supplied |
| `vinext` | React App Router under `src/app`, Vite/vinext, Worker deployment, health tests | `crypto-utils`, `public-edge-cache`, `tiered-result-cache` |
| `rust-server` | Local Axum/Tokio server, tracing, graceful shutdown, Cargo checks through root pnpm scripts | Rust project shell; TypeScript blocks are not installed into it |

The CLI works without an agent:

```sh
node "$KITBASH_ROOT/packages/cli/dist/kit.js" bootstrap --list --preset worker
node "$KITBASH_ROOT/packages/cli/dist/kit.js" bootstrap ../my-api \
  --preset worker --blocks jwt-session-cookie,r2-private-uploads --install --yes
node "$KITBASH_ROOT/packages/cli/dist/kit.js" bootstrap ../my-web \
  --preset vinext --blocks public-edge-cache --yes
node "$KITBASH_ROOT/packages/cli/dist/kit.js" bootstrap ../my-server \
  --preset rust-server --host 127.0.0.1 --port 8080 --yes
```

Run `bootstrap` interactively to choose a preset and blocks. Select a container variant with `--blocks cloudflare-container:go` (or `:bun`, `:rust`). Add `--git-host github --repo owner/name --create-repo` to create a GitHub repository; Gitstalk is also supported. Remote creation and dependency installation are explicit options.

For an existing application, the CLI supports `init`, local-path `get` and `install`, then `status` and `verify`. Use `--root /absolute/path/to/app` to select the target. See [bootstrap and installation details](docs/BOOTSTRAP.md) and `node "$KITBASH_ROOT/packages/cli/dist/kit.js" --help`.

## UI components

[`packages/ui`](packages/ui/README.md) is a Storybook of 81 original React components for agent and AI products: approvals, tool calls, plans, traces, chat, multiplayer presence, analytics, users and profiles, inputs and charts. The newer data components (and the context window, agent lanes, trace waterfall and KPI chart) ship skeleton, empty, error and freshness states, with a stale-while-revalidate cache hook and lazy mounting to drive them. They share Styrene, Kitbash's own visual language: flat panels, molded keys only where you press, one meaning per color, and snap-fit motion. Each one is a single component file plus its stylesheet, with no dependencies beyond React, importable on its own as `@kitbash/ui/<name>` and safe to render from React Server Components.

```sh
pnpm storybook   # http://localhost:6006, light and dark from the toolbar
```

The plugin's `kitbash-ui` skill points agents at this catalog before they build UI, and the plugin bundles the component sources under `runtime/catalog/ui/`. The component list follows [affectUI](https://www.affectui.com/components)'s public catalog as a brief; every implementation here is written independently.

## Recipes

Recipes are runnable reference projects and scripts. Read their guides and copy the relevant pieces; they are not additional installable blocks.

| Recipe | What it demonstrates |
| --- | --- |
| [cloudflare-ci](recipes/cloudflare-ci/README.md) | Credential-free checks, Infisical-backed CI, migrations, and environment-specific Worker deployment |
| [playwright-worker-e2e](recipes/playwright-worker-e2e/README.md) | Browser journeys against a local Worker and migrated D1 |
| [tiered-result-cache-do](recipes/tiered-result-cache-do/README.md) | Full Worker/DO integration tests for the installed result-cache block |
| [workerd-coverage](recipes/workerd-coverage/README.md) | Workerd/D1 test coverage with an enforced floor |
| [typescript-lint](recipes/typescript-lint/README.md) | Shared TypeScript ESLint configuration |
| [typescript-native-checks](recipes/typescript-native-checks/README.md) | TypeScript 7 checks with bounded parallelism and changed-project selection |
| [vinext-guardrails](recipes/vinext-guardrails/README.md) | Configuration, artifact, and build-budget checks for vinext on Workers |

## Secrets and CI access

With an isolated broker and an authorized project policy configured, `/kit:secrets setup my-api staging` generates missing application keys with at least 256 bits of randomness, preserves existing values, registers GitHub OIDC access, and configures Infisical's Worker secret sync. Agents receive names and status only. Provider-issued credentials come from authorized provider connections, not random substitute strings.

The broker is an optional service you operate separately from the agent's filesystem and process access. It is not a hosted Kitbash account. Bootstrap emits a policy proposal; it does not provision live accounts or deploy the application. See [secret setup, trust boundaries, and rotation limits](docs/SECRETS-BROKER.md).

For company signups and OAuth app setup, the [Grok Bot account-manager starter](docs/GROK-BOT.md) keeps automation access in Agent Vault and application credentials in Infisical. It includes a reusable skill and a readiness check; browser password filling and provider-secret capture require separately verified integrations.

## Maintenance and pstack

Maintenance skills are explicitly invoked after merge or at a requested production-readiness checkpoint. They do not add arbitrary function-length ceilings or require cosmetic refactors.

| Skill | Focus |
| --- | --- |
| [clean-code-typescript](skills/clean-code-typescript/SKILL.md) | TypeScript correctness, agent navigation, and measured performance problems |
| [clean-code-rust](skills/clean-code-rust/SKILL.md) | Rust behavior, ownership, task lifecycle, and measured costs |
| [page-delivery](skills/page-delivery/SKILL.md) | Per-route static generation, SSR, data refresh, and caching decisions |

Copy selected skills or vendor the `skills/` tree into a project; generated projects keep a copy under `.kit/skills/`. [Installation and invocation](skills/README.md) explain how to expose them to your harness. No scheduler or recurring agent is enabled automatically.

[Pstack](docs/PSTACK.md) is an optional, separately installed engineering workflow. Use it to plan, implement, debug, and verify a feature; use Kitbash for the stack-specific blocks, recipes, and maintenance checks. Verification should exercise real user journeys and backend assertions, with recordings where useful.

## Develop and contribute

```sh
pnpm bootstrap                 # workspace install, including Go module setup
pnpm workspace:map             # package and native-project task map
pnpm check                     # lint, type checks, tests, and validation
pnpm build                     # bundles and builds; Worker builds are dry runs
pnpm test:e2e                  # browser journeys and block installation matrix
```

See [workspace commands](docs/WORKSPACE.md) for browser installation, native toolchains, Docker checks, and focused package commands. On constrained machines, run workspace tests serially with `pnpm -r --workspace-concurrency=1 --if-present run test`.

To contribute a block, follow the [block format](docs/BLOCK-SPEC.md), include its tests and adaptation checklist, preserve source provenance and license notices, and open a pull request. `/kit:harvest` can prepare a local block draft from existing code. Recipes and maintenance skills can be contributed directly in their respective directories.

Earlier hosted-registry designs and economic experiments remain in [DESIGN](docs/DESIGN.md), [PLAN](docs/PLAN.md), and [research](docs/research/). They are historical context, not the toolkit's product roadmap. The reuse experiments have not established a model-cost saving; see the [lifecycle study](docs/research/lifecycle-reuse.md) for its evidence and limits.

## License

[MIT](LICENSE). Preserve the license and attribution notices included with vendored code, including the [D1 rate-limit block's upstream notice](blocks/d1-rate-limit/LICENSE). Third-party dependencies retain their own licenses.
