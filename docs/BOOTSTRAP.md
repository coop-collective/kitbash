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
- `.kitbash/secrets-broker.request.json`: names and destination metadata proposed to the separately controlled broker; no credentials or grants.

After generation, resolve `pending_adapt`, run the project's check command, and drive the app's actual behavior.
The bootstrap JSON result includes `next_steps`; scripts can consume it with `--json`.

## Infisical

Provide `--infisical-project <project-id>` and optionally `--infisical-domain <url>` to configure the generated
project's Infisical connection. `.kitbash/secrets.json` lists secret names and environment paths. The generated
`scripts/secrets.mjs` helper supports local materialization, importing values through stdin, random generation,
and configured provider-native rotation.

For agents, use the [isolated secrets broker](SECRETS-BROKER.md). After its operator registers the intended alias and
account access, one call generates every missing `generate: true` application key, creates the environment/folders,
registers GitHub's OIDC identity and variables, and configures Worker synchronization. The agent receives only names
and status. Existing secrets are preserved; missing required provider-issued credentials remain explicit pending work.

```json
{"operation":"setup","project":"my-api","target":"staging"}
```

The plugin command is `/kit:secrets setup my-api staging`. Source declarations in `.kitbash/secrets.json` become a
broker policy proposal, not authority to access another account. Local materialization/import/run helpers remain
available for trusted operators; an agent with local filesystem or process access could read those values, so use
non-sensitive fixtures locally when requiring secret isolation.

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

## CI dry runs and migration releases

Worker and vinext presets include `pnpm ci:dry-run` and `pnpm db:migrate --env staging|production`. Their generated GitHub check workflow runs migration rehearsals and Worker packaging without deployment credentials. Each configured environment gets an isolated local D1 database: fresh SQL, incremental upgrade from all but the newest migration, migration-history verification and replay checks. Wrangler has no SQL `--dry-run` flag: the rehearsal uses `--local`; Worker packaging uses `wrangler deploy --dry-run`. Feature tests must also verify preservation of actual application records across upgrades.

The standard manual deploy template builds the selected environment before fetching credentials, records a D1 restore bookmark, applies pending migrations against the source config and same explicit environment, then deploys the checked Worker and allowlisted runtime secrets. PRs and non-main CI are refused by the migration helper itself. Failed bookmarks or migrations stop release. Worker rollbacks do not undo schema/data; use additive migrations compatible with the old Worker and shared previews.

For projects where **PR Preview is test and main is production**, an optional complete GitHub Actions template is available at `bootstraps/shared/workflows/github-preview-production.yml`. Copy it instead of the default deploy workflow after project-specific adaptation. It runs unprivileged checks, deploys same-repository PRs as native Workers Previews, deploys production only from main, and removes named Previews on PR close. No persistent staging Worker is required. Configure separate GitHub/Infisical preview and production identities, explicit `env.production.previews` bindings in the source Wrangler config, and Preview Base secrets before enabling it. Preview URLs are public unless the application or Cloudflare Access protects them; preserve the project's authorization requirements for pages, static downloads and APIs. PR jobs never migrate a shared production database. An isolated Preview database needs its own project-specific migration/provisioning step.

The same templates and scripts ship in the plugin's `runtime/catalog/bootstraps/` directory. Existing repositories can adopt the `recipes/cloudflare-ci` recipe; generated projects receive the default check and manual deploy templates automatically.
