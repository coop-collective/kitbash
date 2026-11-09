---
name: kitbash-bootstrap
description: Bootstrap a new repository from Kitbash's Worker, vinext or local Rust server presets, choosing compatible blocks, Git host and deployment settings. Use when starting a new app or service with Kitbash; use kitbash-use to add a block to an existing project.
---

# Bootstrap a Kitbash project

Use `kitbash_bootstrap` to create a new project from the plugin's bundled catalog. The same catalog and behavior are
available through `kit bootstrap` and the plugin's `scripts/bootstrap.mjs` launcher. No registry sign-in is needed.

1. Call `kitbash_bootstrap {list: true}` for presets, then `{list: true, preset: "worker"}` (or `vinext`, `rust-server`)
   for compatible blocks. Choose the preset from the requested runtime: Worker API, vinext fullstack Worker, or local
   Rust HTTP server. Do not put TypeScript Worker blocks in the Rust project.
2. Choose only blocks the app needs. Pass their catalog names in `blocks`; use `cloudflare-container:rust` (or `:go`,
   `:bun`) to select a container variant. Source files install below `src/`, with
   migrations, tests and config at the project locations declared by the block. Dependencies are resolved by the CLI;
   a collision must be resolved, never hidden by manually flattening or overwriting files.
3. Pass `directory`, `preset`, and `blocks`. Local bootstrap initializes Git but creates no remote. `hostname` is a
   Cloudflare deployment domain; `host` and `port` control the local Rust server. `git_host`, `repo`, and optional
   `gitstalk_url` identify the Git host. Set `create_repo: true` only when creating the named remote is in the user's
   request; visibility defaults to private. Existing authorization is sufficient, without another confirmation.
   `install: true` explicitly installs dependencies. Neither option deploys the app.
4. Generated Worker/vinext GitHub checks run `pnpm ci:dry-run`: disposable local D1 fresh/upgrade/replay checks and credential-free Worker packaging for each environment. Keep PRs away from remote migration commands and production/shared-preview databases. Trusted main releases record restore bookmarks, apply migrations and stop on failure before deploying. Add application-specific migration preservation tests; use preview as test when the project does not need persistent staging. The optional `runtime/catalog/bootstraps/shared/workflows/github-preview-production.yml` supplies that flow; adapt explicit Preview bindings, auth and environment identities before enabling it.
5. Read `pending_adapt` and `next_steps` in the result. Preinstallation copies reusable implementations; bindings,
   route mounting, resource IDs, auth policy, and real credentials may still need project-specific setup. Work through
   those items before reporting a feature as working. Use `registry_verify` for installed blocks and the project's
   check command for the whole app; report any checks not run.

Pass `infisical_project` and, for self-hosted Infisical, `infisical_domain` when those are known. The generated
`scripts/secrets.mjs` manages secret values through Infisical for trusted operator workflows; the tool parameters and
project manifests contain names and IDs only. For agent-managed secrets that must stay outside the agent workspace,
use `kitbash-secrets` and the separately configured `kitbash_secrets` broker. A generated config cannot authorize
itself, and hidden script output alone does not isolate credentials from an agent with filesystem access.
Never pass tokens, private keys, or secret values as bootstrap params.

Example MCP call:

```json
{
  "directory": "../scoreboard",
  "preset": "vinext",
  "blocks": ["public-edge-cache", "tiered-result-cache"],
  "git_host": "github",
  "repo": "my-team/scoreboard",
  "create_repo": true
}
```

For a shell-only harness, run the plugin's `scripts/bootstrap.mjs` with CLI arguments, for example:

```sh
node /path/to/kit-plugin/scripts/bootstrap.mjs ../scoreboard --preset vinext --blocks public-edge-cache,tiered-result-cache --yes
```

For a vinext app's interface, use `kitbash-ui` to build screens from the Styrene component catalog.

Pstack is optional and separately installed. Read [pstack composition](references/pstack.md) only when using it for
the app's implementation or verification. Bootstrap does not install pstack, start recurring automations, or load
maintenance skills into every feature task.
