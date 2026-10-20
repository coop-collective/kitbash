# Bootstrap a project

Kitbash creates a new project from a small runtime preset and preinstalls compatible feature blocks. Presets own
entrypoints, local development, checks, and deployment configuration. Blocks continue to own reusable feature code;
a preset does not fork every block into a separate template.

| Preset | Runtime and hosting | Source layout |
| --- | --- | --- |
| `worker` | Hono API on Cloudflare Workers | `src/index.ts`, block modules below `src/` |
| `vinext` | React App Router through vinext on Cloudflare Workers | `src/app/`, reusable block modules below `src/` |
| `rust-server` | Local Rust HTTP server, configurable bind address and port | `src/main.rs`; no TypeScript blocks |

The Rust preset is a small local service starting point inspired by the local-server projects in this workspace. It
does not copy their application-specific behavior or claim to reproduce Omniscient.

## CLI

From a Kitbash checkout, build the CLI once. Its generated `dist/catalog` accompanies the executable, so generation
does not need a live registry. Dependency installation and Git-host operations need their respective network access.

```sh
pnpm --filter @kitbash/cli build
node packages/cli/dist/kit.js bootstrap --list
node packages/cli/dist/kit.js bootstrap --list --preset vinext
node packages/cli/dist/kit.js bootstrap ../scoreboard --preset vinext --blocks public-edge-cache,tiered-result-cache --yes
```

With `kit` on PATH, use the equivalent `kit bootstrap` commands. In an interactive terminal the bootstrap command
can collect choices; scripts and agents should provide explicit flags and `--yes`.

```sh
kit bootstrap ../api --preset worker --blocks jwt-session-cookie,r2-private-uploads --yes
kit bootstrap ../container-api --preset worker --blocks cloudflare-container:go --yes
kit bootstrap ../local-service --preset rust-server --host 127.0.0.1 --port 4310 --yes
kit bootstrap ../scoreboard --preset vinext --blocks public-edge-cache --hostname scores.example.com --yes
```

The destination must be new or empty. Bootstrap does not overwrite an existing application. Selected blocks install
with their dependencies and record pending adaptation work: an auth module being present does not mean routes,
resource bindings, credentials, and product-specific authorization have been configured.

Use `--param block-name.parameter=value` for block parameters. `--blocks` accepts comma-separated names and can be
repeated. Choose a block variant with `block-name:variant`, such as `cloudflare-container:bun`, `:go`, or `:rust`.
Use `--list --preset <preset>` to see the current compatibility list; it is the authority when the catalog
changes. Rust does not accept Worker TypeScript blocks, and vinext accepts only blocks that fit its app architecture.

`--hostname` configures a deployment domain. `--host` sets the local bind address. These are distinct from
`--git-host`, which selects where the Git repository lives.

## Git hosts and external setup

Local bootstrap initializes Git by default. Use `--no-git` for a scratch project. A remote is created only with
`--create-repo`; `--git-host` alone does not create one. Remote visibility defaults to private.

```sh
kit bootstrap ../scoreboard --preset vinext --git-host github --repo my-team/scoreboard --create-repo --yes
kit bootstrap ../service --preset worker --git-host gitstalk --repo my-team/service --create-repo --yes
```

GitHub creation uses an authenticated `gh` CLI. Gitstalk creation uses `GITSTALK_TOKEN` and the Gitstalk API; override
the host with `--gitstalk-url https://git.example.com`. Supply credentials through the environment or credential
manager, never block params or committed files. `--visibility public` is an explicit choice. The CLI creates the
repository and configures the remote; committing and pushing the project are subsequent steps.

Use `--install` to install project dependencies during generation, or run the returned install command yourself.
Selected blocks can change dependencies: run `pnpm install` and commit the updated lockfile before CI uses
`--frozen-lockfile`. Bootstrap `--install` explicitly refreshes that lock, including when invoked by an agent in CI.
Cloudflare resource provisioning, attaching a custom domain, and production deployment remain explicit project
setup tasks. Generated deployment configuration does not prove those resources exist.

## Blocks share the project source tree

A block's payload preserves its declared `src/...` paths. For example, a block supplying `src/lib/tiered-result-cache/...` lands at
the same project path; it is not wrapped in `blocks/cache/src/` or a second nested `src/` folder. Tests and migrations
retain their top-level project locations. Shared config is merged by the installer and conflicts are reported.

Runtime modules use `src/lib/<block-name>/`. Blocks with a separate route module use
`src/routes/<block-name>/`. Cloudflare container variants keep their native service under `containers/<serviceName>/`,
while their shared Worker gateway uses `src/lib/cloudflare-container/`. Version 2 of the runtime blocks adopts this
layout; existing projects should review changed imports when upgrading. Custom project paths still work through
the manifest's `paths.lib` and `paths.routes` targets.

The generated project records:

- `.kit/bootstrap.json`: preset, selected blocks, and bootstrap choices.
- `.kit/lock.json`: installed block versions, files, and verification state.
- `.kit/catalog/blocks/`: local source snapshots for later block verification and updates.
- `.kit/skills/`: explicit maintenance reviews, kept out of ordinary feature-agent instructions.
- `.kit/verification/README.md`: project verification entrypoint to extend as actual user journeys are added.

After generation, resolve `pending_adapt`, run the project's check command, and drive the app's actual behavior.
The bootstrap JSON result includes `next_steps`; scripts can consume it with `--json`.

## Infisical

Provide `--infisical-project <project-id>` and optionally `--infisical-domain <url>` to configure the generated
project's Infisical connection. `.kitbash/secrets.json` lists secret names and environment paths. The generated
`scripts/secrets.mjs` helper supports local materialization, importing values through stdin, random generation,
and configured provider-native rotation.

Register each application-owned secret name in `.kitbash/secrets.json` first; random generation also requires
`generate: true` on its policy. For a new `APP_KEY`, choose either importing an existing value or generating one;
both operations refuse to replace an existing value. Then materialize the local environment.

```sh
node scripts/secrets.mjs create APP_KEY --env local < /path/to/protected-value
# Alternatively, generate an application-owned key:
node scripts/secrets.mjs generate APP_KEY --env local
node scripts/secrets.mjs local --env local
```

Read the generated `docs/secrets.md` and helper help for authentication, environment, and deployment operations. CI should fetch the deployment
environment through Infisical's configured identity, then use the generated deployment command. Creating a secret
in Infisical is not equivalent to rotating a provider credential or deploying its replacement. Rotation requires
provider support and a configured rotation; JWT signing keys and peppers need an explicit migration strategy.

## Plugin and pstack

The same operation is available as `/kit:bootstrap`, `$kitbash-bootstrap`, the MCP tool `kitbash_bootstrap`, and the
plugin's `scripts/bootstrap.mjs` launcher. Build the plugin with `pnpm --filter @kitbash/plugin build` before packaging
it: the runtime and `runtime/catalog/` must travel together. An installed bundle needs no neighboring Kitbash
checkout or `node_modules` to generate a project. `KIT_CATALOG_ROOT` explicitly selects another local catalog.

Pstack can supply the engineering workflow after generation. See [Pstack composition](PSTACK.md) for implementation,
verification, and post-merge maintenance examples. Bootstrap neither installs pstack nor enables paid recurring
agent jobs.
