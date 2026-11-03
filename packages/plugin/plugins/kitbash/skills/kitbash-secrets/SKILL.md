---
name: kitbash-secrets
description: Generate application secrets, upload local credential files through MCP, deliver secrets to controllers, and provision GitHub or Worker access through Kitbash. Use when setting up secrets without returning their values in chat or tool results.
---

# Manage secrets through the broker

Use `kitbash_secrets` with a registered project alias and explicit `target` (`local`, `staging`, or `production`).
Remote agents such as Grok Bot connect to the broker's authenticated `/mcp` endpoint, which exposes this tool
directly. They need no local Infisical login or `KIT_SECRETS_BROKER_URL`. For the local plugin or shell client,
the operator configures the broker endpoint and scoped credential in the plugin environment. Tool arguments cannot
select credentials, URLs, secret paths, repositories, or Worker destinations. Project files do not authorize access.

For a new project on the Cloudflare MCP, call `kitbash_register_secrets` first with `project`, `target`,
and `secrets: [{ "name": "SESSION_SECRET", "generate": true }]`. Repeat for each target. This saves metadata
under the principal's operator-granted account/store namespace; it needs no per-project policy edit or restart.
Use `generate: false` for provider-issued credentials, and never generate substitutes for API tokens or private keys.
An empty secrets array registers only the namespace. Identical retries preserve existing rules; subsequent calls
can add names. Registration returns public `bindings` for Wrangler's `secrets_store_secrets` array. The application
still needs those bindings deployed; registration does not attach secrets to a Worker or provision GitHub Apps.

- Start with `setup` for routine bootstrap: it generates every allowed missing application key, preserves existing
  values, and registers configured GitHub Actions and Worker sync access in one call. Do not ask the user to create
  routine random secrets manually. Required provider-issued credentials that are absent produce `pending` with
  missing names; optional absent credentials do not block setup. Random bytes cannot replace a provider API token.
- `status` returns registered secret names with presence status, plus connection status.
- `presence`, with `name`, returns only that registered name and `present` or `missing`.
- `generate`, with `name`, creates a registered application secret inside the broker and stores it in the configured Cloudflare Secrets Store or Infisical destination.
  Existing values are preserved. It cannot generate a valid third-party API credential or rotate a live signing key.
- `provision-github` registers the configured repository/environment's Actions OIDC access and non-secret variables.
  It does not create GitHub Apps or App credentials.
- `provision-github-app` starts registration of a **new** App using the operator-reviewed manifest. Give any
  `approvalUrl` to the human to open in their own browser, outside the bot computer; do not open or inspect it
  with browser tools. GitHub returns the credentials to the broker, which writes directly to the configured storage provider.
  Check `status` or `presence` after the human completes the handoff. A `pending` response without a link means
  the human has already started registration. Do not ask the human to copy callback URLs or codes. This does not
  import an existing App, rotate credentials, install the App on repositories, or configure Actions access.
- For provider credentials captured or downloaded on your computer, use `kitbash_upload_secrets`. Register
  names with `generate: false`, then call with `operation: "begin"`, `project`, `target`, and `names`.
  Save its result as a private ticket file, download the returned Python helper, verify its returned SHA-256,
  and run it on your computer with `--ticket /absolute/ticket.json --secret NAME=/absolute/private/file`
  for each name. Preserve PEM newlines. Capture to files directly; do not print values or include them in
  MCP arguments. This is an automated computer workflow: do not send the user to an upload page.
  The helper requires mode-0600 owned regular files and prints names/status only. It needs no local vault
  login or long-lived MCP bearer. Tickets last 15 minutes; request one after files are ready.
  After an uncertain response, call `operation: "status"` with the same project/target and `uploadId`.
  Existing values are preserved; a partial pending write requires reconciliation, not another credential.
- For controller delivery, first call `kitbash_secret_deliveries` with `{}` or an `integration` ID. It returns
  the destination's project, target, `uploadNames`, required public `metadataFields`, and status. Include its
  ID as `delivery` plus that public `metadata` when starting a generic upload. For an existing GitHub App,
  metadata is `{"clientId":"..."}`. Keep the App and existing webhook secret. `delivered` means private files
  staged and the webhook configured; activation and a real Actions run require separate verification.
  Controller enrollment is an operator action; ordinary file uploads need no enrollment or GitHub integration.
- `provision-worker-sync` connects the configured Infisical source to its registered Worker destination.

Call mutating operations only for the project, environment, and work the user requested. Existing authorization is
sufficient; do not ask for the same approval again. Never put a secret value, token, or credential in a tool argument
or chat. A `pending` result is incomplete; do not report access or synchronization as working until verified.
For an unregistered project/name, use `kitbash_register_secrets` when available and authorized. If registration
itself is denied or an existing rule conflicts, report its status and let the operator reconcile access; do not
fall back to reading local credentials, vault exports, or arbitrary provider commands. After an uncertain write,
check status before retrying instead of generating a second value.

```json
{"operation":"setup","project":"scoreboard","target":"staging"}
```

The broker must run under a separate trusted identity outside the agent's accessible filesystem/process environment
for enforced separation. A same-user local script with hidden output only reduces accidental disclosure. The broker exposes no read-value operation and does not materialize `.dev.vars`. The upload helper reads only
explicitly selected local credential files; it keeps their values out of tool arguments and command output. For
local work, use dummy credentials or a trusted runtime outside the agent boundary. Generated projects retain their
`scripts/secrets.mjs` helper for trusted operator workflows; it does not provide this isolation.

Secret-consuming Actions and Workers can disclose values if their code is changed to do so. Use reviewed workflow
code, protected environments, restricted OIDC claims, and a broker policy owned outside the agent-editable repo.
Provisioning access does not prove an application deployment succeeded. See the repository's `docs/SECRETS-BROKER.md`
for operator setup and the separation between CI deployment and continuous Worker sync.

If the tool is missing, use `docs/GROK-BOT.md` for remote connector setup. A feature-registry connection or a saved
skill alone does not connect the broker. If the harness cannot securely attach a bearer credential, leave access
pending; do not move the credential into a prompt, project file, or URL query string.
