---
name: kitbash-secrets
description: Generate registered application secrets and provision GitHub Actions OIDC or Cloudflare Worker secret sync through a configured Kitbash broker, receiving metadata only. Use when setting up secrets or CI access without bringing secret values into the agent workspace.
---

# Manage secrets through the broker

Use `kitbash_secrets` with the operator's project alias and explicit `target` (`local`, `staging`, or `production`).
The operator configures the broker endpoint and scoped credential in the plugin environment; tool arguments cannot
select credentials, URLs, secret paths, repositories, or Worker destinations. Project files do not authorize access.

- Start with `setup` for routine bootstrap: it generates every allowed missing application key, preserves existing
  values, and registers configured GitHub Actions and Worker sync access in one call. Do not ask the user to create
  routine random secrets manually. Required provider-issued credentials that are absent produce `pending` with
  missing names; optional absent credentials do not block setup. Random bytes cannot replace a provider API token.
- `status` returns registered secret names with presence status, plus connection status.
- `generate`, with `name`, creates a registered application secret inside the broker and stores it in Infisical.
  Existing values are preserved. It cannot generate a valid third-party API credential or rotate a live signing key.
- `provision-github` registers the configured repository/environment's Actions OIDC access and non-secret variables.
- `provision-worker-sync` connects the configured Infisical source to its registered Worker destination.

Call mutating operations only for the project, environment, and work the user requested. Existing authorization is
sufficient; do not ask for the same approval again. Never put a secret value, token, or credential in a tool argument
or chat. A `pending` result is incomplete; do not report access or synchronization as working until verified.
If an operation is denied or conflicts, report its status and let the operator reconcile the broker policy; do not
fall back to reading local credentials, vault exports, or arbitrary provider commands. After an uncertain write,
check status before retrying instead of generating a second value.

```json
{"operation":"setup","project":"scoreboard","target":"staging"}
```

The broker must run under a separate trusted identity outside the agent's accessible filesystem/process environment
for enforced separation. A same-user local script with hidden output only reduces accidental disclosure. The tool
does not materialize `.dev.vars`, inject secrets into agent-run commands, or expose a read-value operation. For
local work, use dummy credentials or a trusted runtime outside the agent boundary. Generated projects retain their
`scripts/secrets.mjs` helper for trusted operator workflows; it does not provide this isolation.

Secret-consuming Actions and Workers can disclose values if their code is changed to do so. Use reviewed workflow
code, protected environments, restricted OIDC claims, and a broker policy owned outside the agent-editable repo.
Provisioning access does not prove an application deployment succeeded. See the repository's `docs/SECRETS-BROKER.md`
for operator setup and the separation between CI deployment and continuous Worker sync.
