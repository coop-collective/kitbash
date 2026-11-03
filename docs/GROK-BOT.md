# Kitbash Account Manager for Grok Bot

Use one Bot to manage company service accounts through Agent Vault. Claude Code and
other coding tools handle application changes and Infisical Secrets Manager access.
Kitbash contributes the workflow and code changes through those tools; Grok does not
need an Infisical MCP connection. Grok can use the isolated Kitbash secrets broker's
own remote MCP connector for approved secret setup. Use the template setup command to deploy your own connector; adding it to Grok remains a secure UI step.

## Connect the secrets broker

If the feature-registry tool reports a missing `KIT_SECRETS_BROKER_URL`, it is using
the local client path. Connect the broker directly instead:

1. Use your own copy of the repository and run `pnpm install`, then `pnpm run setup`
   in your trusted terminal outside the bot computer. Follow [template setup](BROKER-SETUP.md) to configure the
   hostname, Cloudflare Secrets Store or Infisical credentials, Worker deployment, and GitHub CI. Setup checks GitHub authentication
   and starts the login prompt only if needed.
2. Copy the generated MCP JSON from your terminal. Setup generates and deploys the scoped token for you;
   a repeat run announces and replaces the existing remote token. The private file is `.kitbash/mcp.json`.
3. Add `https://YOUR-BROKER/mcp` as a custom remote MCP connection named **Kitbash secrets**.
   Use supported protected connection controls for its bearer credential. Confirm the
   installed Grok Bot version can send the header; the service does not implement OAuth
   login. Keep the capability out of chat, the bot filesystem, and URL query strings.
4. Where your team's network restrictions apply, allow the broker hostname. Enable the
   connection for the intended Bot and verify discovery lists `kitbash_secrets`. The Cloudflare Worker
   also exposes `kitbash_register_secrets` for principals granted registration access.
5. For a new project, call `kitbash_register_secrets` with its alias, target and secret names, then
   call `status` through `kitbash_secrets`. Repeat registration for each target. No per-project policy
   edit or broker restart is needed. See [registration](BROKER-SETUP.md#register-projects-through-mcp).
   A successful response proves broker
   access; missing names are expected in an existing source folder before setup. If the source environment/folder
   does not exist yet, an authorized `setup` creates it first. An `unavailable` or `forbidden` result
   is incomplete. Load the `kitbash-secrets` skill separately if the Bot needs workflow guidance.

For the example policy, the initial read-only call is:

```json
{"operation":"status","project":"engine-box-runners","target":"staging"}
```

The broker serves the operations without a local Infisical login or broker environment
variables on Grok's computer. `provision-github` configures Actions OIDC. For a new GitHub
App, use [the manifest handoff](SECRETS-BROKER.md#new-github-app-credentials) through
`provision-github-app`, then verify `presence`. Credentials captured on the Bot computer use `kitbash_upload_secrets` and its local-file helper; no human upload page is needed. Use `kitbash_secret_deliveries` for enrolled controller delivery. See [uploads](BROKER-SETUP.md#upload-secret-files-from-the-bot-computer).

The implementation is covered by local MCP/provider-fixture tests. A live Grok connection,
provider registration, and deployment still require the target environment's configuration
and verification. See [Grok Bot connected apps](https://docs.x.ai/grok-bot/computer-and-apps)
and [network controls](https://docs.x.ai/grok-bot/security); do not assume Grok.com, the xAI
API, and Grok Bot expose identical authentication controls.

## Start in Grok

1. Paste the message below into an **existing Grok Bot**, replacing the example addresses.
2. Have it create or reuse **Kitbash Account Manager** and enable the existing private
   **Kitbash accounts** skill. If the skill is not saved yet, supply
   [the account-management skill](../packages/plugin/plugins/kitbash/skills/kitbash-accounts/SKILL.md)
   and [the Grok setup reference](../packages/plugin/plugins/kitbash/skills/kitbash-accounts/references/grok-bot.md).
3. Check the resulting Bot's skill list and readiness report. Connect its Agent Vault
   access through supported secure controls when requested.

```text
Create or reuse one Bot named Kitbash Account Manager. Enable the existing private
skill Kitbash accounts (kitbash-accounts) for that Bot and preserve its instructions.
If the skill cannot be found, identify that missing dependency. Remember this profile
and have the account-manager Bot perform the first task below.

Our signup pattern is devaccounts+{service}@example.com. Mail reaches our agent through
the devaccounts@example.com group. Our receiving inbox is company-agent@mail.grokbot.com.
Agent Vault holds automation credentials. Claude Code and our other coding tools manage
application credentials in Infisical, scoped to project and environment. Kitbash supports
their implementation work. Grok needs no Infisical MCP. Preserve the company signup
address for login/recovery.

First inspect available connections and report inbox access, tagged-address delivery
evidence, Agent Vault proxy-role access, and browser password-fill support. Prepare the
handoff format for our coding tools: provider/app IDs, project/environment, redirect
URIs, scopes, credential names/references, and completed/pending work. Include no values.
Report unknown access as pending and request missing non-secret configuration. Use secure
controls for credentials. Do not create provider accounts, send mail, deploy services,
or enable routines during this check. Bot creation and skill enablement are authorized.
```

The Kitbash plugin also includes this workflow as `$kitbash-accounts` for agents that
load its skills. An MCP-only connection exposes tools, not the skill instructions.

## Native template import

Grok supports reusable templates through **Share → Create template**, then **Copy link**.
A recipient opens that link and selects **Add to Grok Bot**. Templates carry configuration;
they do not transfer your browser logins or computer. Review copied skills after import.
See [Grok's template documentation](https://docs.x.ai/grok-bot/bots).

The prompt above sets up the Bot through conversation; it is not a Grok JSON export.
Kitbash cannot mint a native share link without access to a configured Bot. Once the pilot
works, create a generic copy with example addresses and no private infrastructure details
before publishing a reusable template. Keep the real account inventory private.

## What is ready

| Piece | State |
| --- | --- |
| Bot instructions, destination rules, readiness check, pilot procedure | Included in this starter |
| Application secret generation and GitHub/Worker provisioning | Existing [Kitbash broker](SECRETS-BROKER.md), requires operator configuration |
| Remote `kitbash_secrets` connector | Broker `/mcp` implemented; scoped auth, hosting, and Grok connection must be configured |
| Agent Vault deployment and Grok connection | Must be configured and tested in the target environment |
| Infisical access | Broker-owned; Grok can request scoped operations through Kitbash MCP; no general Infisical connector required |
| Agent Vault password substitution in Grok's browser | Candidate integration; requires a synthetic browser test |
| GitHub App credential capture | Generic MCP uploads from local credential files implemented; optional App manifest and controller delivery integrations |
| Recurring signup/maintenance jobs | Not enabled by this starter |

After the Bot is created, finish Agent Vault connection and check tagged mail delivery.
Choose one provider and application for the pilot. Grok handles account setup; coding
tools handle application changes and Infisical provisioning from its metadata handoff.
Provider-issued values still require a trusted capture path or secure human entry into
Infisical. Moving a task between agents does not hide a secret already exposed to a model.
Keep incomplete phases in the receipt so work resumes without duplicate accounts or rotation.
