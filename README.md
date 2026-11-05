# Kitbash

**Reusable application code for coding agents.** Start a project, add features, and run checks without rebuilding the same foundations every time.

Kitbash copies source into your app. You own and edit it. MIT licensed, with no Kitbash account or subscription required. Most blocks target **TypeScript + Cloudflare Workers + Hono/D1**; there is also a Rust server starter.

## Install

Requires **Node.js 22.18+** and your agent CLI. The GitHub install includes the built runtime and local catalog—no manual clone, pnpm install, or build.

### Claude Code

```sh
claude plugin marketplace add coop-collective/kitbash && claude plugin install kit@kitbash
```

Start a new Claude session in your app.

### Codex

```sh
codex plugin marketplace add coop-collective/kitbash && codex plugin add kit@kitbash
```

Start a new Codex session in your app.

### Cursor, Gemini CLI, Windsurf, Cline, and other MCP agents

Kitbash runs as a local **stdio MCP server**. For agents without a native plugin adapter, download the ready-built toolkit once:

```sh
git clone --branch v0.1.0 --depth 1 https://github.com/coop-collective/kitbash.git "$HOME/kitbash"
```

Then print the MCP config with your actual installation path:

```sh
node -e 'console.log(JSON.stringify({mcpServers:{kitbash:{command:"node",args:[process.env.HOME+"/kitbash/packages/plugin/plugins/kitbash/scripts/kit-mcp.mjs"]}}},null,2))'
```

Merge the resulting `kitbash` entry into your agent’s MCP settings, then reload the agent. For clients with an “Add server” form, select **stdio**, set the command to `node`, and use the printed script path as its argument. Clients with a different config schema need those same command and argument values in their own format.

This exposes the toolkit’s tools. Native plugin skills and `/kit:*` commands are currently available through the Claude Code and Codex installs above. Remote-only agents cannot launch this local server; [Grok Bot setup](docs/GROK-BOT.md) covers the separate secrets connector.

## Try it

Paste a request into your agent:

```text
Use Kitbash to create a Worker in ../my-api with jwt-session-cookie and
r2-private-uploads. Preview the changes, install the blocks, wire them into
the app, and run verification.
```

Or work on an existing app:

```text
Use Kitbash to inspect the local member-profiles block, preview its
installation into this project, adapt the routes, and verify the result.
```

Claude Code also has `/kit:bootstrap`, `/kit:search`, and `/kit:install`. In Codex, invoke `$kitbash-bootstrap` or `$kitbash-use`.

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
git clone https://github.com/coop-collective/kitbash.git ~/kitbash
cd ~/kitbash
pnpm install
pnpm --filter @kitbash/secrets-broker exec wrangler login
pnpm run setup --skip-ci
```

Requires Node.js 22.18+, pnpm 12.14.0, a Cloudflare account, and a hostname in a Cloudflare-managed zone. Prepare a storage policy and provider credentials using the [Cloudflare deployment guide](docs/BROKER-SETUP.md). The setup wizard deploys the Worker and prints the private MCP connection config. Use `pnpm run setup` to configure GitHub deployment credentials, then [enable automatic deployments](docs/BROKER-SETUP.md#enable-deployment-automation) if wanted.

Keep the generated `.env` and `.kitbash/` files private. Rerunning setup replaces the broker connection key; use `pnpm run deploy:broker` for code updates that preserve it.

## Develop

```sh
git clone https://github.com/coop-collective/kitbash.git ~/kitbash
cd ~/kitbash
pnpm bootstrap       # install workspace dependencies and Go modules
pnpm workspace:map   # list packages
pnpm check           # lint, types, tests, validation
pnpm build           # build packages
pnpm test:e2e        # browser journeys and block installation checks
```

See [workspace setup](docs/WORKSPACE.md) for native toolchains, browser installation, Docker, and focused package commands. After changing the plugin or catalog, rebuild with `pnpm --filter @kitbash/plugin build`, commit the updated `runtime/`, and reload or reinstall it. CI checks that the shipped bundle matches its sources.

Contributing a block? Follow the [block format](docs/BLOCK-SPEC.md), include tests and adaptation instructions, and preserve source attribution. `/kit:harvest` can prepare a draft from existing code.

[Full toolkit guide](docs/GUIDE.md) · [Secrets and CI](docs/SECRETS-BROKER.md) · [MIT license](LICENSE)
