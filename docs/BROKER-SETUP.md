# Deploy your own Kitbash secrets connector

Run the broker in your own Cloudflare account. It stores application secrets in **Cloudflare Secrets Store** and gives agents scoped tools to generate, upload, and check them without returning secret values. Infisical is optional.

## Cloudflare quick start

You need Node.js 22.18+, pnpm 12.14.0, a Cloudflare account with Workers and Secrets Store access, and a domain managed in that account. Choose a hostname such as `secrets.example.com`. Use a trusted operator machine for setup.

1. Create your own GitHub copy of this repository and clone it. Replace `YOUR_ORG` and `YOUR_REPO` below:

   ```sh
   git clone https://github.com/YOUR_ORG/YOUR_REPO.git kitbash-broker
   cd kitbash-broker
   pnpm install --frozen-lockfile
   pnpm --filter @kitbash/secrets-broker exec wrangler login
   ```

2. Open **Secrets Store** in the Cloudflare dashboard and copy the account ID and store ID. The dashboard creates the first store for an authorized administrator. Alternatively, create one with `pnpm --filter @kitbash/secrets-broker exec wrangler secrets-store store create kitbash --remote`. Reuse an existing store when available. See [Cloudflare's setup instructions](https://developers.cloudflare.com/secrets-store/integrations/workers/).

3. Copy the Cloudflare policy and edit its two placeholder IDs:

   ```sh
   cp packages/secrets-broker/policy.cloudflare.example.json broker.policy.json
   ```

   Set `principals[0].registration.accountId` and `storeId` to the IDs from step 2. Keep `id: "grok-bot"` and the zero-filled `tokenSha256`; setup replaces the hash. `secretPrefix` isolates this connector's secrets, and `targets` limits which environments it can register.

4. Create a Cloudflare API token with **Secrets Store Write**, scoped to this account. This is the broker's runtime storage credential. Paste it only into the wizard's hidden prompt. Deploy using your local Wrangler login:

   ```sh
   pnpm run setup --skip-ci
   ```

   Enter your hostname, account ID, Worker name, and `broker.policy.json` when prompted. Setup deploys the Worker, its Durable Object, policy, and credentials; creates the custom-domain route; and prints MCP connection JSON. No Infisical or GitHub CI credentials are required for this path.

5. Copy the generated MCP JSON into your agent's protected connector settings. A private copy is saved at `.kitbash/mcp.json`. Ask the agent to call `kitbash_register_secrets` for your project and then `kitbash_secrets` with `operation: "setup"`, the same `project`, and `target`. The examples below show the registration payload. Successful responses report names and status, never values.

To enable automatic deployments from your GitHub copy later, run `pnpm run setup` without `--skip-ci` and follow [organization deployment credentials](#organization-deployment-credential). That setup run rotates the connector key: update the agent's MCP configuration afterward. Routine code updates use `pnpm run deploy:broker`, which preserves existing keys.

Use **`pnpm run setup`**, not `pnpm setup` (pnpm's own installer). Setup saves private configuration in ignored `.env` and `.kitbash/`; keep those outside the agent's workspace. If the hostname is already attached to another Worker, choose a different hostname or resolve that ownership before deploying.

## Which credentials go where

| Credential or setting | Location | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | GitHub **organization secret**, private repositories | Automated Worker deployments |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub **organization variable**, private repositories | Select the deployment account; this ID is not a secret |
| MCP bearer token | Your connector configuration and private `.kitbash/mcp.json` | Authenticate the bot to Kitbash |
| MCP token hash, policy, provider credentials | Cloudflare Worker secrets | Broker authentication and access to configured providers |
| Application secrets | The destination in the broker policy | Application runtime credentials; never GitHub Actions secrets |

The broker supports **Cloudflare Secrets Store** and **Infisical** as application storage providers.
Cloudflare storage needs no Infisical login or machine identity. Use
`packages/secrets-broker/policy.cloudflare.example.json`, replacing its account/store IDs and secret
prefix. Give the broker a separate `KIT_BROKER_SECRETS_API_TOKEN` with Secrets Store Write in that
account; setup installs it as a Worker secret. This is separate from the GitHub deployment token.

Cloudflare stores each value under its assigned project/target prefix plus the registered secret name.
MCP registration assigns an isolated prefix and returns the exact storage names. Metadata queries filter that prefix; normal MCP operations cannot
retrieve values. An operator-enrolled controller delivery can read its one webhook binding for encrypted controller delivery, described below. Each project/target must have a nonoverlapping prefix. Cloudflare's current
[open beta](https://developers.cloudflare.com/secrets-store/manage-secrets/) allows one store and
100 secrets per account. Application Workers consume these through
[Secrets Store bindings](https://developers.cloudflare.com/secrets-store/integrations/workers/);
generating a secret does not automatically bind it to another Worker.

Cloudflare policies support `setup`, `status`, `presence`, `generate`, and reviewed GitHub App manifest
handoffs. The Infisical-specific Actions OIDC and native Worker-sync operations are rejected for
Cloudflare storage. Existing Infisical policies remain supported; they need a valid project and
broker credential. Switching CI credential storage does not migrate application secrets.

## Register projects through MCP

The Cloudflare example grants `grok-bot` a `registration` capability with a fixed account, store,
namespace prefix and allowed targets. Set those account/store IDs during initial setup. Subsequent
projects do not need policy edits or broker deployments: the bot calls `kitbash_register_secrets`:

```json
{
  "project": "enginebox",
  "target": "staging",
  "secrets": [
    { "name": "ENGINEBOX_GITHUB_RUNNERS_WEBHOOK_SECRET", "generate": true }
  ]
}
```

Repeat for `production`. Use `secrets: []` to register a namespace before choosing its secret names.
Registration stores names and generation rules, without creating secret
values. Then call `kitbash_secrets` with `status`, `presence`, `generate` or `setup`. Registration is
additive and safe to repeat. It cannot change existing generation rules, replace values, claim
statically configured projects, or access another principal's namespace. At most 100 names may be
registered per project/target. Keep principal IDs stable when rotating tokens.

Use `generate: true` only for random application keys. `generate: false` records the expected name
of a credential issued elsewhere; it does not import that credential. GitHub App manifests still
require operator-reviewed permissions and URLs. Registration does not grant provider provisioning.

The response includes `bindings` containing the exact `binding`, `store_id` and `secret_name` entries
for the app's Wrangler `secrets_store_secrets` array. The app deploys those bindings and reads values
through its runtime bindings. Kitbash registration does not deploy or modify the application Worker.

Registrations persist in Durable Objects across deploys. Only metadata is stored there; generated
values go directly into Secrets Store. Removing the principal's registration capability revokes
access. Changing its account/store/prefix causes a conflict for existing registrations, requiring
an explicit operator migration. The legacy Node-hosted MCP exposes only static policy operations.

GitHub Actions runs on GitHub's computers; it cannot use the operator's Wrangler login. It needs
its own deployment token only for future automated deployments. It does not need the MCP key,
application secrets, or the broker's Infisical credentials. Routine deployments retain Worker secrets.

## Upload secret files from the bot computer

The Cloudflare MCP exposes `kitbash_upload_secrets` for any registered provider credential or
UTF-8 secret file. This uses the bot's computer and terminal; there is no human upload page.
The remote server cannot open a path on that computer, so its tool returns a scoped upload
ticket and a small Python 3 helper that sends the selected files directly to Kitbash.

1. Capture or download credentials directly to private local files on the bot computer. Keep
   their contents out of chat and command output. Preserve PEM newlines. The helper requires
   absolute paths, regular non-symlink files owned by the current user, and mode 0600.
2. Call `kitbash_register_secrets` with the destination `project`, `target`, and names using
   `generate: false`. Existing registrations can be reused. Server-generated random keys still
   use `generate: true` and `kitbash_secrets` / `generate`.
3. Once files are ready, call `kitbash_upload_secrets`:

   ```json
   {"operation":"begin","project":"example-app","target":"production","names":["SERVICE_API_TOKEN","SERVICE_PRIVATE_KEY"]}
   ```

4. Save the tool's structured result to a private `ticket.json` file. Download its `helperUrl`
   and verify the file's SHA-256 against `helperSha256` from that authenticated MCP result.
   Run the helper on the bot computer using file paths, never inline values:

   ```sh
   python3 upload-secrets.py --ticket /absolute/private/ticket.json \
     --secret SERVICE_API_TOKEN=/absolute/private/api-token \
     --secret SERVICE_PRIVATE_KEY=/absolute/private/key.pem
   ```

5. The helper prints only names and `stored` or `pending`. After a connection failure, query
   `kitbash_upload_secrets` with `operation: "status"`, the same project/target and `uploadId`.
   Verify `presence` before removing temporary capture files according to the provider's recovery needs.

Tickets expire after 15 minutes and are restricted to the exact registered names. No long-lived
MCP bearer needs to be exported to the terminal. Uploads are create-only: existing values are
preserved, simultaneous retries cannot duplicate writes, and ambiguous provider writes remain
reserved for metadata reconciliation. Expired unused tickets can be replaced. A pending partial
write requires operator reconciliation, not a new upload or random replacement.

Each upload supports up to ten UTF-8 values of 65,536 bytes each, with a 256 KiB total JSON-body
limit. [Cloudflare's value limit](https://developers.cloudflare.com/secrets-store/manage-secrets/)
is measured in bytes. Values go directly to the project's Secrets Store namespace; they are never
returned by MCP or saved in broker checkpoints. Ordinary uploads require no GitHub App or controller
integration. These tools currently serve dynamically registered Cloudflare projects; legacy
Infisical policies retain their trusted operator adapter.

The helper keeps contents out of MCP arguments and its output. Source files still exist on the
bot computer while the upload runs; this is not isolation from other processes on that computer.
Grok supports this workflow through its [computer, terminal and files](https://docs.x.ai/grok-bot/computer-and-apps).

## Deliver uploaded credentials to a native controller

Controller delivery is optional and independent of registering/uploading secrets. For an existing
GitHub App, enroll the receiver once from the trusted operator checkout. The App and stored
webhook value are preserved; Infisical and GitHub Actions application secrets are not required.

Register `PREFIX_CLIENT_SECRET` and `PREFIX_PRIVATE_KEY` with `generate: false`, plus
`PREFIX_WEBHOOK_SECRET` with `generate: true`. Generate the missing webhook once. With SSH
access and a private parent directory writable by the controller service user, run:

```sh
pnpm run setup:controller \
  --ssh controller-host --directory /opt/kitbash \
  --project example-app --target production \
  --integration example-runners --owner your-github-org \
  --kind runners --prefix EXAMPLE_GITHUB_RUNNERS
```

The controller requires Node 22.18+ at `/usr/local/bin/node`. Add `--slug existing-app-slug`
to pin an App; otherwise GitHub must confirm the enrolled owner and supplied Client ID.
`--kind repos` stages a repository App fragment instead. Enrollment generates the receiver's
private key and bearer on the controller; only its public key and bearer digest leave that host.
Repeated enrollment reuses that identity and rejects changed destinations. It preserves the
MCP key and saves the webhook binding in local `.env` plus the GitHub deployment environment's
`KIT_BROKER_SECRET_BINDINGS` **variable**, so subsequent deployments retain it.

Grok calls `kitbash_secret_deliveries` with `{}` to discover enrolled destinations, or with
`{"integration":"example-runners"}` to check one. The response provides its project, target,
`uploadNames`, and required public `metadataFields`. Use those in the generic upload tool:

```json
{
  "operation":"begin",
  "project":"example-app",
  "target":"production",
  "names":["EXAMPLE_GITHUB_RUNNERS_CLIENT_SECRET","EXAMPLE_GITHUB_RUNNERS_PRIVATE_KEY"],
  "delivery":"example-runners",
  "metadata":{"clientId":"GITHUB_APP_CLIENT_ID"}
}
```

Run the same local-file helper. No GitHub-specific upload page or `kitbash_import_github_app`
tool is needed. Old import URLs are retired. Configure the App's HTTPS webhook URL in GitHub
before delivery. Kitbash validates the key, owner and Client ID, writes the missing values to
Secrets Store, and encrypts all three credentials to the enrolled receiver. Only the encrypted
packet enters durable storage; it is removed after acknowledgement.

Run the receiver as the enrolled controller user, or schedule it with the supplied
[service](../packages/secrets-broker/examples/controller-receiver.service) and
[timer](../packages/secrets-broker/examples/controller-receiver.timer) templates:

```sh
/usr/local/bin/node /opt/kitbash/runtime/scripts/controller-receiver.mjs \
  receive /opt/kitbash/example-runners
```

Replace the service user and private paths, install both units under the same base name in
`/etc/systemd/system`, run `systemctl daemon-reload`, then `systemctl enable --now NAME.timer`.
The timer polls once per minute. The receiver decrypts locally, sets GitHub's webhook secret
to the existing stored value, and stages owner-only files plus a `runners.json` or `repos.json`
fragment. It prints metadata only and recovers lost acknowledgements without replacing files.
After an unclean process termination, remove `receiver.lock` only after confirming no receiver
is running.

Engine Box's shared-App configuration reuses the three delivered `ENGINEBOX_GITHUB_RUNNERS_*`
credentials for repository access and runners. Put the fragment's fields under `app` in the
controller configuration; the `runners.json` filename does not require a separate App. Approve
Contents read/write on the existing installation for repository sync. Do not generate another
credential set just because an older registration lists missing `ENGINEBOX_GITHUB_REPOS_*`
names. Activate a release supporting the shared configuration before connecting GitHub once
in the dashboard. Runner pools still require their own worker configuration.

`kitbash_secret_deliveries` reports `awaiting-upload`, `pending`, `awaiting-controller`, or
`delivered`. **Delivered means files staged and webhook configured, not controller activation
or a successful Actions job.** Merge the fragment into the controller's complete private
configuration, supply installation/pool metadata, and use its normal standby/drain/activation
procedure before running a disposable canary.

## Initial deployment and local authentication

To configure and deploy the broker without configuring GitHub CI:

```sh
pnpm --filter @kitbash/secrets-broker exec wrangler login # only if not already authenticated
pnpm run setup --skip-ci
```

This path uses existing local Wrangler authentication, creates no Cloudflare API tokens, and makes
no GitHub configuration changes. It still validates the application policy and requires its storage provider
credentials. Normal `pnpm run setup` checks the GitHub CLI login first and prompts for browser login
only when missing. `--yes` reuses supplied or saved settings; it never starts an interactive login.

The wizard asks for hostname, account, Worker name, policy and private broker credentials. It saves
settings to ignored `.env` with mode 0600 and connection files under `.kitbash` with mode 0700.
Secret prompts hide input. Keep this checkout outside the bot's workspace. An operator who can
deploy broker code can change how it uses provider credentials.

If the policy file does not exist, the legacy wizard creates a scoped Infisical policy from your
existing project ID, environment, folder and allowed application secret names. For GitHub App
manifest provisioning, edit `packages/secrets-broker/policy.github-app.example.json` before setup.
Provider-generated credentials go directly to the configured application destination, not to the bot.

## Enable deployment automation

Setup configures credentials and the deployment environment. To opt into deploying on pushes to the default branch, run this in your own GitHub copy after setup succeeds:

```sh
gh variable set KIT_BROKER_AUTO_DEPLOY --body true
```

Without that opt-in, use the **Deploy secrets broker** workflow's manual **Run workflow** button or `pnpm run deploy:broker`. Publishing a toolkit release does not itself opt a repository into production deployments.

## Organization deployment credential

The default CI provider is `github`. Setup uses the repository owner's organization and restricts
both deployment credentials to **private repositories**. Organization credentials for private
repositories require a supported GitHub plan; GitHub Free does not expose them to private repos.
The CLI identity needs permission to manage organization Actions secrets and variables.

An existing organization token and matching account variable are reused without replacement.
GitHub does not return secret values, so repeat local deployments use Wrangler's saved login.
Setup stops if the existing account or visibility differs; it never silently broadens access.

You can configure the organization credential manually before setup:

```sh
gh secret set CLOUDFLARE_API_TOKEN --org YOUR_ORG --visibility private
# The preceding command prompts for the value; do not put it in a shell argument.
gh variable set CLOUDFLARE_ACCOUNT_ID --org YOUR_ORG --visibility private --body YOUR_ACCOUNT_ID
```

Alternatively, supply `CLOUDFLARE_API_TOKEN` privately to the initial setup process. Setup writes it
to the organization secret through stdin, verifies the account/zone, and does not save it in `.env`.
The deployment token needs Workers Scripts Write and Account Settings Read for the account, plus
Workers Routes Write and Zone Read for the hostname's zone. These are account-wide Worker
permissions, not permissions limited to one Worker. Other zones require an appropriately scoped token.

When no deployment credential exists, the automatic provisioning path opens Cloudflare's
[prefilled account-token form](https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/).
It requests a one-time setup token with Account API Tokens Edit and Zone Read. The wizard uses
that authorization to generate a deployment token, verify its permissions and activity, and write
it directly to the organization secret. The deployment token cannot create further tokens. Revoke
the setup token after provisioning; it is neither persisted nor deployed. Unattended provisioning
can supply `CLOUDFLARE_TOKEN_PROVISIONING_TOKEN` through the process environment.

Wrangler's standard OAuth login can deploy Workers and upload Worker secrets, but it does not
grant API token creation. Cloudflare requires the initial token authorization through its dashboard.
A Worker secret and a Cloudflare API token are different credentials.

Setup creates or reuses the GitHub deployment environment without changing existing protection
rules. It sets `KIT_BROKER_HOSTNAME`, `KIT_BROKER_WORKER_NAME` and `KIT_BROKER_PRINCIPAL` as
environment variables, and `KIT_BROKER_DEPLOY_ENVIRONMENT`, `KIT_BROKER_CI_PROVIDER` and the
successful-setup flag `KIT_BROKER_CONFIGURED` as repository variables. The account ID stays at
organization level. The default path creates **no Infisical CI identities** and needs no runtime GitHub App.

## MCP connection and repeat setup

Setup checks remote Worker secret names before generating the key. If a broker key already exists,
it warns that the key will be replaced and previous MCP connections will stop authenticating.
Permission errors stop setup before rotation. It generates 32 random bytes and deploys the hash,
policy and provider credentials together using Wrangler's `--secrets-file`.

The terminal output and private `.kitbash/mcp.json` contain:

```json
{
  "mcpServers": {
    "kitbash_secrets": {
      "type": "http",
      "url": "https://secrets.example.com/mcp",
      "headers": { "Authorization": "Bearer <generated-token>" }
    }
  }
}
```

Copy this into the bot's protected MCP connector configuration. Its connector must support bearer
headers; Kitbash does not implement an OAuth login server. Then call `kitbash_secrets` with `status`,
the policy's project alias and an allowed target. The MCP token is the only credential intentionally
printed. Application or provider secret values are never printed.

Each setup run rotates the selected principal's MCP key. It does not rotate application secrets.
Ordinary code deployments use `pnpm run deploy:broker`, preserve existing Worker secrets and do
not require the MCP token. Local deployments use Wrangler login; CI uses the organization token.
Both commands generate private `.kitbash/wrangler.deploy.json` from the shared `wrangler.jsonc`,
applying the saved hostname/account configuration. Use `deploy:broker --dry-run` to check packaging.

## Recovery and optional Infisical CI

Keep `.kitbash/setup-state.json`. It stores resource IDs and pending operations, never raw token
values. An interrupted token creation or organization secret write stops retries for operator
reconciliation rather than minting duplicate tokens. Inspect the recorded token ID and organization
secret before retrying. If a token was created but not stored, revoke that specific orphan before
clearing its checkpoint. Remove a stale lock only after confirming no setup process is running.

Setup writes a unique private `mcp-<id>.json` recovery file before deployment. If Cloudflare accepts
a deployment but the response is lost, that file retains the possibly active key. Previous recovery
files remain available. Temporary provider-credential bundles are deleted on normal completion
or error. Inspect Cloudflare before rerunning a failed deployment; the key may already have changed.

The optional legacy `KIT_BROKER_CI_PROVIDER=infisical` path stores the deployment token in a dedicated
Infisical `/ci/<worker>` folder and creates two exact-workflow OIDC readers (`push` and
`workflow_dispatch`). This path requires suitable project permissions and custom roles. It is
explicitly opt-in and separate from the default organization-secret flow. Existing identities and
vault values are not deleted when changing CI providers. The application provisioning operations
retain their separately configured Infisical/OIDC behavior and production reviewer requirements.

The Worker uses SQLite Durable Objects for serialized operations, metadata checkpoints and
short-lived GitHub App handoffs. Plaintext provider values and conversion codes never enter durable state; enrolled controller uploads temporarily retain encrypted delivery packets.
Request invocation logging and tracing remain disabled because callback URLs contain temporary
GitHub codes. Explicit audit events contain only safe operation metadata.
