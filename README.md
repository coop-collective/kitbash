# w3bstack

**Reusable application code for coding agents.** Start a project, add features, and run checks without rebuilding the same foundations every time.

w3bstack copies source into your app. You own and edit it. MIT licensed, with no w3bstack account or subscription required. Most blocks target **TypeScript + Cloudflare Workers + Hono/D1**; there is also a Rust server starter.

w3bstack was called Kitbash until plugin 0.2.0. If you installed `kit@kitbash`, see [Renamed from Kitbash](#renamed-from-kitbash).

## Install

Requires **Node.js 22.18+** and your agent CLI. The GitHub install includes the built runtime and local catalog—no manual clone, pnpm install, or build.

### Claude Code

```sh
claude plugin marketplace add coop-collective/w3bstack && claude plugin install kit@w3bstack
```

Start a new Claude session in your app.

### Codex

```sh
codex plugin marketplace add coop-collective/w3bstack && codex plugin add kit@w3bstack
```

Start a new Codex session in your app.

### Cursor, Gemini CLI, Windsurf, Cline, and other MCP agents

w3bstack runs as a local **stdio MCP server**. For agents without a native plugin adapter, download the ready-built toolkit once:

```sh
git clone --depth 1 https://github.com/coop-collective/w3bstack.git "$HOME/w3bstack"
```

To pin a release, add `--branch <tag>`. Tags before `v0.2.0` predate the rename and use `kitbash` in these paths.

Then print the MCP config with your actual installation path:

```sh
node -e 'console.log(JSON.stringify({mcpServers:{w3bstack:{command:"node",args:[process.env.HOME+"/w3bstack/packages/plugin/plugins/w3bstack/scripts/kit-mcp.mjs"]}}},null,2))'
```

Merge the resulting `w3bstack` entry into your agent’s MCP settings, then reload the agent. For clients with an “Add server” form, select **stdio**, set the command to `node`, and use the printed script path as its argument. Clients with a different config schema need those same command and argument values in their own format.

This exposes the toolkit’s tools. Native plugin skills and `/kit:*` commands are currently available through the Claude Code and Codex installs above. Remote-only agents cannot launch this local server; [Grok Bot setup](docs/GROK-BOT.md) covers the separate secrets connector.

## Try it

Paste a request into your agent:

```text
Use w3bstack to create a Worker in ../my-api with jwt-session-cookie and
r2-private-uploads. Preview the changes, install the blocks, wire them into
the app, and run verification.
```

Or work on an existing app:

```text
Use w3bstack to inspect the local member-profiles block, preview its
installation into this project, adapt the routes, and verify the result.
```

Claude Code also has `/kit:bootstrap`, `/kit:search`, and `/kit:install`. In Codex, invoke `$w3bstack-bootstrap` or `$w3bstack-use`.

**The workflow:** inspect → preview → install → adapt → verify. Blocks include code, tests, configuration, and wiring instructions. Installing files is the start; the agent still connects them to your app and runs checks.

## What’s included

| Part | Examples | Browse |
| --- | --- | --- |
| Feature blocks | Auth, API keys, organizations, uploads, caching, WebSockets, containers | [Block catalog](docs/GUIDE.md#available-blocks) |
| Project starters | Hono Worker, vinext React app, Rust/Axum server | [Presets](docs/GUIDE.md#start-a-project) |
| React UI | Styrene components for agent and AI products | [UI package](packages/ui/README.md) |
| Recipes | Browser performance, React/vinext diagnostics, Cloudflare observability, CI and workerd coverage | [Recipes](docs/GUIDE.md#recipes) |
| Maintenance skills | TypeScript, Rust, page rendering and caching reviews | [Skills](skills/README.md) |
| Optional secrets broker | Application secrets, CI access, remote agent connector | [Secrets broker](docs/SECRETS-BROKER.md) |

Preview the UI with `pnpm storybook` from the checkout.

## Deploy the secrets manager on Cloudflare

The optional secrets broker runs in your Cloudflare account. It gives agents scoped access to secret operations while keeping provider credentials on the server.

```sh
git clone https://github.com/coop-collective/w3bstack.git ~/w3bstack
cd ~/w3bstack
pnpm install
pnpm --filter @w3bstack/secrets-broker exec wrangler login
pnpm run setup --skip-ci
```

Requires Node.js 22.18+, pnpm 12.14.0, a Cloudflare account, and a hostname in a Cloudflare-managed zone. Prepare a storage policy and provider credentials using the [Cloudflare deployment guide](docs/BROKER-SETUP.md). The setup wizard deploys the Worker and prints the private MCP connection config. Use `pnpm run setup` to configure GitHub deployment credentials, then [enable automatic deployments](docs/BROKER-SETUP.md#enable-deployment-automation) if wanted.

Keep the generated `.env` and `.w3bstack/` files private. Rerunning setup replaces the broker connection key; use `pnpm run deploy:broker` for code updates that preserve it.

## Develop

```sh
git clone https://github.com/coop-collective/w3bstack.git ~/w3bstack
cd ~/w3bstack
pnpm bootstrap       # install workspace dependencies and Go modules
pnpm workspace:map   # list packages
pnpm check           # lint, types, tests, validation
pnpm build           # build packages
pnpm test:e2e        # browser journeys and block installation checks
```

See [workspace setup](docs/WORKSPACE.md) for native toolchains, browser installation, Docker, and focused package commands. After changing the plugin or catalog, rebuild with `pnpm --filter @w3bstack/plugin build`, commit the updated `runtime/`, and reload or reinstall it. CI checks that the shipped bundle matches its sources.

Contributing a block? Follow the [block format](docs/BLOCK-SPEC.md), include tests and adaptation instructions, and preserve source attribution. `/kit:harvest` can prepare a draft from existing code.

## Renamed from Kitbash

Plugin 0.2.0 renamed the product, the plugin marketplace, the MCP server and the workspace packages. The plugin and CLI are still called `kit`. Neither Claude Code nor Codex follows a renamed marketplace, so an existing install stays on the old version until you replace it:

```sh
# Claude Code
claude plugin marketplace remove kitbash        # also uninstalls kit@kitbash
claude plugin marketplace add coop-collective/w3bstack
claude plugin install kit@w3bstack

# Codex
codex plugin remove kit@kitbash
codex plugin marketplace remove kitbash
codex plugin marketplace add coop-collective/w3bstack
codex plugin add kit@w3bstack
```

Then update anything that names the old identifiers:

| Before | Now |
| --- | --- |
| Install id `kit@kitbash` | `kit@w3bstack` |
| MCP server `kitbash`, tool ids `mcp__plugin_kit_kitbash__*` | `w3bstack`, `mcp__plugin_kit_w3bstack__*` (update permission allowlists and MCP-only configs) |
| Plugin tools `kitbash_bootstrap`, `kitbash_secrets` | `w3bstack_bootstrap`, `w3bstack_secrets` |
| Skills `$kitbash-use`, `$kitbash-bootstrap`, … | `$w3bstack-use`, `$w3bstack-bootstrap`, … |
| Workspace packages `@kitbash/*` | `@w3bstack/*` |
| `.kitbash/` in a project or broker checkout | `.w3bstack/` for new ones; an existing `.kitbash/` is still read, so nothing has to move |
| Repository `coop-collective/kitbash` | `coop-collective/w3bstack` (the old URL redirects; `git remote set-url origin https://github.com/coop-collective/w3bstack.git`) |

Some names did not change, because they identify deployed resources or published formats: the broker Worker `kitbash-secrets-broker` and its MCP tools (`kitbash_secrets`, `kitbash_register_secrets`, `kitbash_upload_secrets`, `kitbash_secret_deliveries`), the `mcpServers.kitbash_secrets` connector entry, the `https://kitbash.dev/schema/…` URLs in `block.json`, the `metadata.kitbash` key in a block's `SKILL.md`, and the `@kitbash/container-*` packages inside the container block. A deployed broker and installed blocks keep working without changes.

[Full toolkit guide](docs/GUIDE.md) · [Secrets and CI](docs/SECRETS-BROKER.md) · [MIT license](LICENSE)
