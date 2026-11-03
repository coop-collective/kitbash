# Infisical secrets and deployment

The generated project uses Infisical as the source of application secrets. `.kitbash/secrets.json` contains identifiers and policy, never values. Bootstrap records selected blocks' secret names; complete their adaptation checklist before enabling a deployment. Optional names use `required: false`.

## Agent automation

Use the Kitbash plugin's `kitbash_secrets` tool with `operation: "setup"`, the registered project alias, and an explicit target. The isolated broker generates all missing application keys with cryptographic randomness, creates configured environment/folders, registers GitHub OIDC access, and connects the native Worker sync. It preserves existing keys and returns names/status only. `.kitbash/secrets-broker.request.json` is a proposal for the broker operator; it cannot authorize itself. See [broker setup and boundaries](https://github.com/coop-collective/kitbash/blob/main/docs/SECRETS-BROKER.md).

Agents must not use the local materialization or arbitrary `run` commands below when secret isolation is required. Those commands put values in files or application process memory accessible to the local user. Use non-sensitive test fixtures locally and an isolated trusted runtime for real secrets. Provider-issued credentials come from authorized provider APIs/connections, never random application strings.

## Trusted operator fallback

1. Create or select an Infisical project and set its UUID and HTTPS domain in `.kitbash/secrets.json`. `kit bootstrap --infisical-project UUID --infisical-domain https://your-vault.example` can record these existing identifiers. Bootstrap does not create a vault project, identities, provider credentials, environments, or rotation jobs.
2. Create `dev`, `staging`, and `production` environments and `/app` folders. `local` maps to `dev`; staging and production remain separate. An operation must name its target. Put application values in `/app`; put only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in each deployment environment's `/ci` folder. Use account-scoped deployment tokens with the necessary Worker/resource permissions. The rotation administrator credential belongs in an Infisical app connection, not `/ci`.
3. Give developers and CI identities access only to the environments and folders they need. Use a separate identity for rotation administration. Log in locally with `infisical login --domain https://your-vault.example`. The helper captures the logged-in token without displaying it. The CLI login-token command was checked against Infisical CLI 0.43.130; network operations use the documented API v4, not CLI export caches.

## Create and use application secrets

Register an application's secret policy before creating it:

```json
{
  "JWT_SESSION_SECRET": { "required": true, "generate": true, "rotation": "migration-required" },
  "SERVICE_API_KEY": { "required": false, "generate": false, "rotation": "provider" }
}
```

Place those entries under `secrets`. `generate` is suitable for a new random application key; a provider issues its own API credentials. These commands create entries in Infisical and refuse replacement of existing names:

```sh
# Generate independently in each environment; values never reach stdout.
node scripts/secrets.mjs generate JWT_SESSION_SECRET --env local
node scripts/secrets.mjs generate JWT_SESSION_SECRET --env staging

# Read a provider-issued value from an existing protected file, not shell arguments.
node scripts/secrets.mjs create SERVICE_API_KEY --env local < /private/service-key
node scripts/secrets.mjs import --env staging < /private/app-secrets.json

node scripts/secrets.mjs doctor --env local
node scripts/secrets.mjs local --env local
```

Keep input files outside the repository with owner-only permissions. Do not paste values into commands, transcripts, or an agent prompt. JSON imports accept only registered application names. Imports and generated keys are create-only; an uncertain network result requires checking provider state before retrying. Infisical approval workflows remain pending until approved. Do not run concurrent initial writers for the same keys.

`local` writes an ignored mode-0600 `.dev.vars` for Workers/vinext or `.env.local` for Rust. Only `local` may write a local secret file. Refreshes replace files owned by the same project/environment/path; existing handwritten files must be reconciled first. Secrets are not read from linked imports, personal overrides, recursive folders, or cached exports. Use literal stored values rather than unresolved Infisical secret references.

For a local Rust process, inject application values directly:

```sh
node scripts/secrets.mjs run --env local -- pnpm dev
```

The child receives registered application values and loses vault/CI/deployment credentials. The child's own logs remain its responsibility. `run` also handles values that cannot be preserved by the conservative local dotenv writer. The generated Rust server does not automatically load `.env.local`.

## GitHub CI/CD

The generated check workflow needs no secrets. Commit the generated `pnpm-lock.yaml` after the first `pnpm install` before enabling frozen CI installs. Worker/vinext deploy workflows are manual, main-branch-only, and serialized per environment. They check and build the selected environment before fetching runtime secrets, so frontend compilation does not receive private runtime credentials.

Create GitHub environments `staging` and `production`, configure their branch/reviewer protections, and set these non-secret variables in each:

- `INFISICAL_IDENTITY_ID`: that environment's machine identity.
- `INFISICAL_PROJECT_SLUG`: the project matching `.kitbash/secrets.json`.
- `INFISICAL_DOMAIN`: the same HTTPS origin as the project config; the default is US Cloud.

Configure the Infisical identity's OIDC issuer as `https://token.actions.githubusercontent.com`, restrict its subject to `repo:OWNER/REPO:environment:staging` (or production), and bind appropriate repository/audience claims. Grant read access to exactly `/ci` and `/app` in that environment. The official Infisical action is pinned to v1.0.9's commit. No permanent Infisical client secret is stored in GitHub. Do not add shell or platform-control variables to `/app`; it contains application names registered in the config. If you change environment slugs or paths, update the workflow alongside the config.

Runtime values are selected by name and written into a private temporary JSON file. Wrangler uploads it with the new code using `deploy --secrets-file`, then the file is removed even on failure. This avoids `secret bulk` deploying an intermediate version of old code. Omitted bindings remain on the Worker; deleting a secret is a separate intentional operation. Values and deployment subprocess output are suppressed by the helper. Use deployment status and redacted observability to investigate failures.

For local deployment, the helper authenticates to Infisical and reads both folders itself:

```sh
pnpm build:staging
pnpm run deploy --env staging
```

Use the explicit `run` form: pnpm also provides its own unrelated `deploy` command for packaging a workspace.

Vinext must be built for the selected environment first. The helper verifies the flattened build's Worker name and does not pass a new `--env` to that generated config. A production build cannot accidentally reuse the staging artifact. Provision Cloudflare resources and run reviewed backward-compatible remote migrations as part of the application's release procedure; the basic generated deploy does not invent resource IDs or a migration policy. The `cloudflare-ci` recipe demonstrates migration-then-deployment ordering.

## Gitstalk CI/CD

Generated Gitstalk projects include a check workflow for validated main pushes. The deployment adapter is a manual **staging** shell automation; it runs from the checked-out stalk and does not use a model or save memory. It strips Infisical credentials from install/check/build processes. Configure repository secrets `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET` for a staging-only Infisical machine identity using Universal Auth. The helper exchanges them for a new access token during deployment. Configure a short access-token TTL, an expiring client secret, and appropriate network restrictions in Infisical; refresh the Gitstalk client secret before expiry. Production needs a separate identity, secret names, and reviewed automation.

GitHub OIDC is not assumed to work on Gitstalk. This adapter retains a bootstrap client secret until a supported Gitstalk workload-identity federation is configured. A short-lived `INFISICAL_TOKEN` supplied by an external runner is also supported; never commit it. No provider credentials are fetched or changed by project generation alone.

## Rotate credentials using their provider

Infisical has native **Cloudflare API token** and **Cloudflare R2 access-key** rotation providers. Configure an Infisical Cloudflare app connection with its documented administrative permissions, then create a rotation in the appropriate project/environment/folder. Map outputs to the names used by the consumers. R2 bindings inside a Worker do not require S3 access keys; use R2 key rotation only for external/S3 consumers that need them.

Record already-configured provider jobs under `rotations`:

```json
{
  "deploy-production": {
    "provider": "cloudflare-api-token",
    "name": "worker-deploy-token",
    "target": "production",
    "path": "/ci"
  },
  "r2-production": {
    "provider": "cloudflare-r2-access-key",
    "name": "uploads-s3-key",
    "target": "production",
    "path": "/app"
  }
}
```

```sh
node scripts/secrets.mjs rotate deploy-production --env production
node scripts/secrets.mjs rotate deploy-production --env production --execute
```

The first command prints a value-free plan. The second verifies the remote job's project/environment/folder and requests rotation. A successful request is not proof that the asynchronous provider job or application refresh succeeded. Wait for Infisical's successful status, fetch/deploy new credentials to every consumer, test them, and monitor before the previous credential's overlap expires. Schedule native rotations only when this propagation procedure fits their overlap window. These helpers do not silently enable a rotation schedule or revoke arbitrary keys.

Do not use random replacement for JWT/session signing keys, token peppers, or encryption keys. The current `jwt-session-cookie` block has a single signing secret: replacement invalidates existing cookies. Smooth rotation requires a verified multi-key reader, staged activation, and an overlap at least as long as the maximum credential lifetime. Peppers or encryption keys may require persistent-data migration. `migration-required` documents that requirement; this helper deliberately offers no blanket rotate-all command. Provider credentials and application key formats have different lifecycles.

Sources checked 2026-10-20: [Infisical OIDC action](https://github.com/Infisical/secrets-action/tree/8a06c1bdcd5b8635d510c52d4b57a92c1ccef785), [secret APIs](https://infisical.com/docs/api-reference/endpoints/secrets/create-many), [Universal Auth](https://infisical.com/docs/documentation/platform/identities/universal-auth), [Cloudflare API token rotation](https://infisical.com/docs/documentation/platform/secret-rotation/cloudflare-api-token), [R2 key rotation](https://infisical.com/docs/documentation/platform/secret-rotation/cloudflare-r2-access-key), [rotation lifecycle](https://infisical.com/docs/documentation/platform/secret-rotation/overview), [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

Tests exercise scope, overwrite refusal, redaction, temporary-file permissions/cleanup, environment selection, and rotation dispatch with fake providers. They do not establish live vault access, hosted CI authorization, provider rotation completion, or a production deployment.
