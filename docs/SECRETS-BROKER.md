# Secrets without values in the agent workspace

Kitbash's `kitbash_secrets` tool runs routine setup through a separate trusted broker. Remote agents connect directly
to its authenticated `/mcp` endpoint; the local plugin uses `/v1/operations`. One `setup` call generates
every allowed missing application key in the configured store, preserves existing values, and registers the configured GitHub
Actions and Cloudflare Worker connections. The agent receives names and status, plus a human approval link when
registering a new GitHub App; it never supplies or receives
the generated values. The equivalent plugin command is `/kit:secrets setup my-app staging`.

```json
{"operation":"setup","project":"my-app","target":"staging"}
```

```mermaid
flowchart LR
  A[Agent: alias and target] --> P[Kitbash plugin]
  A -->|remote MCP and scoped auth| B[Isolated broker]
  P -->|scoped request| B[Isolated broker]
  B -->|generate application keys| I[Infisical]
  B -->|OIDC trust and variables| G[GitHub Actions]
  G -->|short-lived identity| I
  I -->|native secret sync| W[Cloudflare Worker]
  B -->|names and status only| P
```

## Deploy from this template

Run `pnpm run setup` in a trusted copy of this repository to deploy the broker as a Cloudflare Worker, configure
its hostname and GitHub CI, and print a scoped MCP connection JSON. It saves private `.env` settings and announces
replacement of an existing remote broker key on reruns. Ordinary CI deployments preserve keys.
See [the complete template setup guide](BROKER-SETUP.md). This operator command is distinct from the agent-facing
`setup` operation below, which creates application secrets in the policy's storage provider.
Cloudflare Secrets Store policies use a fixed account/store and a unique prefix per project/target,
with a separate broker runtime token. They need no Infisical identity. See
[Cloudflare policy example](../packages/secrets-broker/policy.cloudflare.example.json).
The Infisical OIDC/native-sync integrations below apply only to Infisical policies.

## What is already available

Infisical supports [GitHub Actions OIDC authentication](https://infisical.com/docs/documentation/platform/identities/oidc-auth/general)
and [Worker secret sync](https://infisical.com/docs/integrations/secret-syncs/cloudflare-workers). GitHub does not need
a long-lived Infisical secret: its workflow obtains a temporary identity token and exchanges it for scoped access.
The broker registers this access and sets the non-secret GitHub environment variables used by Kitbash's workflow.

[Infisical Agent Vault](https://infisical.com/platform/agent-vault), currently advertised as a preview, already offers
credential proxying for agents. For broader authenticated API use, evaluate its service access bundles and
[agent protocol](https://github.com/Infisical/agent-vault/blob/main/docs/agents/protocol.mdx) instead of building another
general credential proxy. Kitbash's broker is narrower: generate application keys internally and orchestrate fixed
setup operations while filtering provider responses. It exposes no raw Infisical CRUD or arbitrary HTTP proxy route.

## Agent operations

| Operation | Inputs beyond project and target | Result |
| --- | --- | --- |
| `setup` | None | Generate allowed missing keys and register configured integrations; `ready` or `pending` |
| `status` | None | Registered names with `present`/`missing`, plus saved provisioning status |
| `presence` | Registered `name` | That name with `present` or `missing`; no value read |
| `generate` | Registered `name` | Create a random application key, or report `already-exists` |
| `provision-github` | None | Register the configured repository/environment's OIDC access |
| `provision-github-app` | None | New App manifest handoff: `pending` with human `approvalUrl`, then `configured` once credentials are present |
| `provision-worker-sync` | None | Register the configured Infisical source and Worker destination |

All operations require `project` (registered alias) and `target` (`local`, `staging`, or `production`). The
schema has no value, token, URL, command, path, repository, or Worker-name arguments. `generate` and `presence` require a name.
The operator policy supplies the real destination and registration authority. Static projects also define their
names there; the Cloudflare MCP can register new projects and names through `kitbash_register_secrets` without
editing policy or restarting the broker. See [MCP registration](BROKER-SETUP.md#register-projects-through-mcp).

`setup` generates cryptographically random bytes for keys marked `generate: true`; ordinary app secrets need no
manual creation. A required absent credential issued by another service produces `pending` and its missing name.
Such credentials must come from that provider through a trusted operator or provider-specific provisioning flow;
random bytes cannot impersonate them. Optional missing credentials (`required: false`) do not block setup.
Existing keys are never silently replaced. Provider rotation and signing-key migrations remain separate workflows.

The response contains no provider messages, raw responses, values, hashes of values, or captured command output.
Both broker and plugin reconstruct the permitted metadata. Invalid responses, network exceptions, and provider
errors produce fixed error codes. The plugin refuses redirects and limits response size.

`configured` means the integration was registered and read back, not that a deployment or asynchronous secret sync
has completed. `status` shows secret presence and saved provisioning receipts; it is not a full drift audit of
GitHub or Cloudflare. Check provider execution status through a trusted operator when delivery needs confirmation.
For GitHub Apps, `configured` confirms the five registered credential names are present; it does not prove an
installation, OAuth login, webhook delivery, or runner deployment works.

## Remote connector for Grok Bot

The broker itself serves `kitbash_secrets` at `https://YOUR-BROKER/mcp` over Streamable HTTP. It authenticates
discovery and every operation with the same scoped bearer policy used by `/v1/operations`. It supports MCP's
2025 stateless transport and the 2026 per-request transport through the SDK. The Cloudflare Worker also exposes
`kitbash_register_secrets` for metadata registration within an operator-granted store namespace. It exposes no
shell, resource-read, or provider-value tools. Browser-origin MCP requests are rejected.

Connect this endpoint in a harness that securely supplies `Authorization: Bearer <scoped broker token>`.
Use the connector's protected credential field, never chat or a URL query parameter. The feature-registry MCP
connection alone does not connect this service. Grok needs no local Infisical login, plugin installation,
`KIT_SECRETS_BROKER_URL`, or provider credentials when it uses remote MCP.

For the Cloudflare template, `pnpm run setup` deploys and prints the connection JSON in your terminal. For a
standalone Node host, after reviewing its policy and creating a private output directory, the operator can instead
produce a ready-to-import HTTP MCP configuration without printing the token:

```sh
node packages/secrets-broker/src/issue-client.mjs \
  --policy /operator/policy.json --principal grok-bot \
  --output /operator/private/grok-mcp.json --format mcp \
  --url https://broker.example.com
```

The helper writes `mcpServers.kitbash_secrets` with the `/mcp` URL and authorization header into a new `0600` file,
updates only that principal's token hash, and reports `issued` plus the restart requirement. Keep that file outside
the bot's filesystem. Import it through trusted harness configuration, or transfer its fields through the
connector's secure controls. `--format env` (the default) retains the local-client URL/token format.

Confirm that the installed Grok Bot connector supports protected bearer headers; this broker is not an OAuth
authorization server. OAuth-only clients need an operator-managed authentication bridge, not an unauthenticated
endpoint. Where Grok's network controls apply, allow the broker host. See [Grok's connection guide](GROK-BOT.md)
for the readiness call and the distinction between implementation and a live connection.

## New GitHub App credentials

`provision-github` configures **Actions OIDC**, not a GitHub App. For a **new** App, `provision-github-app` implements
[GitHub's manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest):
GitHub's conversion response contains the App ID, client ID, client secret, private key, and webhook secret.
The broker exchanges the temporary code and sends those values directly to Infisical.

1. On the trusted broker host, configure `KIT_BROKER_PUBLIC_ORIGIN=https://broker.example.com`. It must be the
   HTTPS origin used by the connector and human browser. Forward `/mcp`, `/v1/operations`, and `/github-app/*`
   to the broker, preserving the browser cookie. The browser routes use a short-lived capability and cookie,
   so a proxy must not require the bot's bearer token on them. Disable access-log query strings and body/header
   capture on these routes; the callback contains GitHub's temporary code.
2. Start from [`policy.github-app.example.json`](../packages/secrets-broker/policy.github-app.example.json).
   Replace its example project, owner, callback/webhook URLs, permissions, and events with the intended settings.
   The sample `contents: read`/`push` combination is illustrative, not Engine Box Runners' required permission set.
   `githubApp` belongs to a target and maps all five fields to unique registered provider-only names. The broker
   fixes the manifest redirect URL; neither tool arguments nor the browser's Host header can select it.
3. Grant `provision-github-app`, `status`, and `presence` for the intended project and target. Call:

   ```json
   {"operation":"provision-github-app","project":"engine-box-runners","target":"staging"}
   ```

4. Give the returned `approvalUrl` to the human. They open it in their own browser, outside the bot computer,
   click **Prepare registration**, then **Continue to GitHub**, and approve registration there. Link previews do
   not start registration. Do not open the link using agent browser tools or paste callback URLs/codes
   into chat. The broker binds the callback to a random state and a Secure, HttpOnly, SameSite cookie; the link
   expires after 15 minutes. A pending result without a link means registration has already started.
5. The broker validates the returned owner, permissions, events, and key format; creates the five vault records;
   and checks their presence without reading values back. Callback pages, tool output, audit events, and durable
   checkpoints contain no provider credentials. Check `status` or each `presence` through the same connector.
   Then run `setup` to finish other configured integrations.

Existing complete credentials are preserved. Partial credentials, a lost conversion/write response, or an opened
handoff lost through expiry, broker-key rotation, or a standalone Node restart require operator reconciliation; Kitbash does not create a second App or rotate
keys automatically. The operator checks GitHub registration and Infisical state before clearing a checkpoint.
Cloudflare durable storage preserves handoffs across ordinary Worker eviction. GitHub App installation and runtime authentication checks remain separate from credential creation.

Existing provider credentials use the general `kitbash_upload_secrets` MCP tool. It creates a scoped upload
ticket and supplies a Python helper for the bot's computer. The helper reads local files and sends their bytes
directly to Kitbash, returning names/status only. There is no human upload page or secret-value MCP argument.
See [local-file uploads](BROKER-SETUP.md#upload-secret-files-from-the-bot-computer).

For native controller delivery, `kitbash_secret_deliveries` lists the enrolled destinations and required public
metadata. Include the selected delivery when starting the upload. The existing GitHub App adapter validates
its key/owner/Client ID, preserves the stored webhook value, and encrypts the credentials to its receiver.
See [controller delivery](BROKER-SETUP.md#deliver-uploaded-credentials-to-a-native-controller).
`delivered` confirms staging and webhook configuration, not runtime activation. Other deployments can use
trusted operator import into their registered vault names. Never create a replacement App just to obtain secrets.

## One-time operator setup

For Cloudflare hosting, use [template setup](BROKER-SETUP.md). The following is the alternative standalone Node-host setup.

Run the broker on an isolated host or service identity whose filesystem, environment, credentials, and process
memory the coding agent cannot read or modify. Keep its code and policy outside the agent-editable repository.
The repository supplies source for building the service; running the mutable checkout beside an unrestricted agent
does not establish isolation. Put the broker's loopback HTTP listener behind an authenticated HTTPS endpoint.

The operator configures:

- An existing Infisical project and bootstrap identity with the permissions needed for the selected operations.
  `setup` creates the configured environment and application/CI folders when missing. Credentials enter only the broker process as `INFISICAL_TOKEN` or Universal Auth client
  credentials (`INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET`).
- A broker-side `GITHUB_TOKEN` with access to the intended repository's environment and variables. It is not passed
  to the plugin or stored as an application secret.
- An existing Worker destination for native sync. Register `cloudflare.connectionName` to let setup create the
  Infisical app connection from broker-only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, or use an existing
  `connectionId`. No Cloudflare token is accepted through the agent-facing tool.
- For GitHub deployments, setup copies the authorized Cloudflare token/account pair into the target's `/ci` folder
  server-side when absent. It preserves an existing complete pair and rejects partial pairs. The same transfer can
  supply a new app connection. The initial application credential must be appropriately scoped; this agent-facing
  operation does not narrow a supplied token. Separately, operator-side `pnpm run setup` creates the broker's own
  deployment token through Cloudflare's account-token API and stores it in a private-repository GitHub organization secret.
  See [the organization credential setup and optional OIDC flow](BROKER-SETUP.md).
- A protected production GitHub environment with required reviewers and self-review prevention before provisioning
  production access. Staging can be registered by the broker with its configured branch restriction.
- A private, writable state directory with mode `0700`. Keep its state file between runs: it records completed
  registration steps and uncertain writes so retries do not create duplicate identities or connections.

The trusted policy maps aliases to destination metadata and secret policies. Start with
[`policy.example.json`](../packages/secrets-broker/policy.example.json) on the broker host, replace its project/repository
metadata, and keep the reviewed copy outside the agent workspace. New application bootstraps emit
`.kitbash/secrets-broker.request.json` as an **untrusted proposal** for this policy; it cannot authorize its own
repository, target, names, or grants. The operator adopts only intended destinations and permissions.

Each principal's token hash maps to explicit projects, targets, and operations. A `setup` grant authorizes the entire
configured setup sequence for those targets. Do not expose production through a staging-only principal. Generate
the scoped client credential with the operator helper; there is no manual random-string step:

```sh
node packages/secrets-broker/src/issue-client.mjs \
  --policy /operator/policy.json \
  --principal build-agent \
  --output /operator/private/agent.env \
  --url https://broker.example.com
```

The helper creates a random 32-byte credential, writes it only to a new `0600` file, updates the policy's SHA-256
hash, and prints metadata only. The destination directory must already be private (`0700`). Load this file through
the harness's credential configuration and restart the broker after issuance. It contains only the scoped broker
capability, never an Infisical, GitHub, or Cloudflare credential. Existing output files are preserved.

Start the service from a trusted installation, with credentials supplied through the hosting platform's secret
injection rather than command-line arguments:

```sh
pnpm --filter @kitbash/secrets-broker start \
  --config /operator/policy.json \
  --state /operator/private/state.json
```

The default bind is `127.0.0.1:8789`; set `KIT_BROKER_HOST` and `KIT_BROKER_PORT` on the broker host if needed. The
plugin receives only `KIT_SECRETS_BROKER_URL` (an HTTPS origin) and `KIT_SECRETS_BROKER_TOKEN` (the scoped broker
credential). It does not receive the provider credentials. Supply these through the harness configuration, not
through chat or a project file. The scoped broker credential authorizes the listed operations and must still be
handled as a credential; its possession does not expose stored application values.

For a shell-only harness, the same client is available in the installed plugin:

```sh
node /path/to/kit-plugin/scripts/secrets.mjs setup my-app staging
```

For local development of the broker itself, `KIT_SECRETS_BROKER_ALLOW_LOOPBACK_HTTP=1` enables HTTP only to an exact
loopback host. This is a development transport option, not an isolation guarantee.

## CI, Worker synchronization, and runtime boundaries

GitHub provisioning creates a project-scoped Infisical identity and exact-environment/folder read permissions. OIDC
trust binds the repository's stable IDs, branch, workflow, environment, audience, and manual workflow event. It sets
`INFISICAL_IDENTITY_ID`, `INFISICAL_PROJECT_SLUG`, `INFISICAL_DOMAIN`, `INFISICAL_OIDC_AUDIENCE`,
`INFISICAL_ENVIRONMENT_SLUG`, and `INFISICAL_SECRET_PATH` as environment
variables in GitHub. The generated deployment workflow uses these variables; no Infisical password is stored there.

Worker synchronization uses the registered Cloudflare connection and source folder. It disables secret deletion and
does not import destination values into Infisical, but source values replace same-name Worker secret bindings when
synced. `autoSync` is an operator policy choice. Registration requires an
existing Worker; first deployment remains a separate operation. Keep `/ci` infrastructure credentials out of `/app`
and never sync them into the Worker as application secrets.

Before registering or revalidating a Worker sync, Kitbash rejects source-folder names absent from the broker's app
allowlist. Native sync then owns the entire dedicated folder, so later writes to that folder must also be trusted;
Infisical's background sync does not call the broker's validator. Keep unrelated credentials in separate folders.

Kitbash's existing deployment helper can upload code and allowlisted secrets together through Wrangler. Native
Worker sync is useful when changes should propagate independently of code deployment. Decide which path owns secret
updates for each environment; avoid concurrent independent writes. A provider rotation can update Infisical and then
propagate through native sync, but safe application signing-key rollover still requires overlap and migration logic.
The Cloudflare app connection itself does not support automatic credential rotation. Rotating a deployment token in
`/ci` does not update the copy in that connection; update its credential through a trusted provider workflow too, or
use independently managed credentials. Setup does not claim to establish that rotation workflow.

Hiding output is not enough if an agent can read a `.dev.vars` file, inspect the process consuming the secret, or
change code that later sends it elsewhere. The broker therefore has no local materialization, arbitrary process
injection, or deployment operation. Use dummy local values or a separate trusted runtime for integration tests.
Generated `scripts/secrets.mjs` helpers remain available for trusted human/operator environments; they do not enforce
this boundary. Protect secret-consuming workflow and application code with review and environment controls before
giving it production secrets. Neither a broker nor a proxy can make malicious authorized application code safe.

After an uncertain provider write, the broker preserves a pending checkpoint and stops instead of retrying blindly.
An operator reconciles provider state and the checkpoint. Audit output contains operation metadata and fixed error
codes only; do not turn on HTTP-body, header, or environment logging in the broker's host or reverse proxy.
