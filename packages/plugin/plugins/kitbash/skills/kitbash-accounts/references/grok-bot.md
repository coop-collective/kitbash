# Grok Bot setup and first trial

Checked against primary documentation on 2026-10-23. Recheck the installed product's
capabilities before connecting live credentials.

## Bring the workflow into Grok

Ask an existing Grok Bot to create or reuse **Kitbash Account Manager** and enable the
existing private skill **Kitbash accounts** (`kitbash-accounts`). If the skill is not
saved yet, supply `SKILL.md` and this reference and ask Grok to save it. Confirm the skill
is visible and enabled for the destination Bot; a prompt alone does not prove installation.

Supply a private profile containing the signup pattern, receiving inbox, Agent Vault
service location, and coding-tool handoff destination. Claude Code and other coding tools
own Infisical access and application changes; no Infisical MCP is required in Grok.
Include project/environment aliases as handoff metadata when known. Leave unknown
endpoints unconfigured. Grok can also use the Kitbash broker's remote `/mcp` endpoint for scoped secret
operations without its own Infisical login. Configure its bearer credential through protected connector
controls and verify discovery of `kitbash_secrets` plus a successful `status` for the registered project/target.
The feature registry connection and a saved skill do not configure this separate service.
Enter connector credentials only through supported secure
connection controls. Account details stay out of the reusable public template.

Grok's documented native template flow is **Share → Create template → Copy link**.
Recipients choose **Add to Grok Bot**. There is no native JSON import schema established
by this kit. Create the Bot first; a text attachment is a starter, not a native template
export. Template copies do not carry logins. Inspect the destination Bot's skill list
after import instead of assuming the preview guarantees installed skills.

## First task: readiness

After authorized Bot creation and skill enablement, inspect connected tools and existing
evidence without mutating providers. Report these capabilities:

| Capability | What proves it |
| --- | --- |
| Receiving inbox | Grok confirms the configured inbox; a relevant delivered message proves routing |
| Tagged company address | Receipt of a message actually addressed to the service-specific alias |
| Agent Vault | Authenticated metadata check and an enforced proxy role for the intended vault |
| Browser credential use | A dummy login through the actual browser/proxy path, including failure behavior |
| Coding-tool handoff | Identified coding tool/owner and intended project/environment; references only |
| Provider-secret capture | Existing evidence from the trusted capture path, or pending for a separate synthetic test |

If a capability is missing, state what configuration or implementation is needed. Do
not install a vault beside the agent and call that isolation. Do not send a test email,
create a provider account, or enable a routine as part of this read-only check. Running
a dummy write is a separate test; lack of previous test evidence should be reported as pending.

## Prove password entry before a live signup

Agent Vault's open-source service rules support placeholders in JSON and URL-encoded
request bodies. A provider adapter may let Grok type a harmless placeholder and replace
it in the outgoing request on the approved host/path. This is not verified in Grok's
browser. Confirm browser routing and certificate trust through supported configuration;
setting `HTTPS_PROXY` alone does not prove the browser uses it.

Use synthetic credentials with a controlled test service before real account passwords.
Check intended substitution, denial on an unintended destination/path, and absence of
the real dummy value from model-visible output, screenshots, traces, and readback.
Account for client-side password transformations; multipart and compressed bodies are
not supported by the documented substitution mechanism. A passing API test is not a
passing browser test. Session cookies remain credentials even when the password is hidden.

If browser integration cannot be established, use the native secure secret card or human
takeover. This is a supported fallback, not evidence of Agent Vault integration. Record
the remaining manual step. For provider credentials that can be captured or downloaded to private local
files, use `kitbash_upload_secrets` and its local helper. It sends those files directly to the registered
store and returns names/status. A human upload page is not required.

## One authorized provider pilot

Obtain the provider, application name, intended owner, project/environment, callback
URLs, and scopes from the task and existing records. Then run signup or account reuse,
verification, login, and app registration in Grok. Hand metadata to the coding tools for
application changes and a scoped runtime check. Use the Kitbash MCP file-upload tools for credential delivery.
Keep a phase receipt so a blocked step can resume without duplicate accounts/apps.
Keep recurring work disabled until the owner requests it after a successful trial.

## Sources

- [Grok Bot creation and native template sharing](https://docs.x.ai/grok-bot/bots)
- [Saving skills and testing routines](https://docs.x.ai/grok-bot/skills-routines-and-automations)
- [Native email behavior](https://cursor.com/help/grok-bot/agent-email)
- [Secure secret input and browser fill](https://cursor.com/help/grok-bot/secrets)
- [Open-source Agent Vault credentials, roles, and OAuth](https://github.com/Infisical/agent-vault/blob/main/docs/learn/credentials.mdx)
- [Agent Vault service matching and substitutions](https://github.com/Infisical/agent-vault/blob/main/docs/learn/services.mdx)
