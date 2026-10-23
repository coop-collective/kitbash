# Secrets without values in the agent workspace

Kitbash's `kitbash_secrets` tool runs routine setup through a separate trusted broker. One `setup` call generates
every allowed missing application key in Infisical, preserves existing values, and registers the configured GitHub
Actions and Cloudflare Worker connections. The agent receives names and status only; it never supplies or receives
the generated values. The equivalent plugin command is `/kit:secrets setup my-app staging`.

```json
{"operation":"setup","project":"my-app","target":"staging"}
```

```mermaid
flowchart LR
  A[Agent: alias and target] --> P[Kitbash plugin]
  P -->|scoped request| B[Isolated broker]
  B -->|generate application keys| I[Infisical]
  B -->|OIDC trust and variables| G[GitHub Actions]
  G -->|short-lived identity| I
  I -->|native secret sync| W[Cloudflare Worker]
  B -->|names and status only| P
```

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
| `generate` | Registered `name` | Create a random application key, or report `already-exists` |
| `provision-github` | None | Register the configured repository/environment's OIDC access |
| `provision-worker-sync` | None | Register the configured Infisical source and Worker destination |

All operations require `project` (operator-defined alias) and `target` (`local`, `staging`, or `production`). The
schema has no value, token, URL, command, path, repository, or Worker-name arguments. Only `generate` accepts a name.
The broker's policy, separate from the application checkout, supplies the real destination and secret names.

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

## One-time operator setup

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
  supply a new app connection. The initial broker credential must be appropriately scoped; Kitbash does not mint a
  new Cloudflare API token from random bytes or automatically narrow a supplied token.
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
