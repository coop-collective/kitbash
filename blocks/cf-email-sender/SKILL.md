---
name: cf-email-sender
description: Use when a Worker must send its own transactional mail (codes, invitations) through Cloudflare Email Service, printed in dev and refused in production when unconfigured.
license: MIT
metadata:
  kitbash: "@coop/cf-email-sender@2.0.0"
---

# cf-email-sender

## What it adds

`<paths.lib>/mail.ts` and its test, a `send_email` binding `EMAIL` and a `MAIL_FROM` var in `wrangler.jsonc`.

## Interface

- `mailer(env): Mailer | null`. Order: the test override; `EMAIL` + `MAIL_FROM` → Email Service (from
  `{ email: MAIL_FROM, name: APP_NAME }`); `ENVIRONMENT` in dev/development/local/test → prints the mail as one JSON
  log line; otherwise `null`.
- `sendMail(env, { to, subject, text, html? })`: throws `MailError` with `code` `not_configured` or the Email
  Service error code (`E_SENDER_NOT_VERIFIED`, …). Logs only that code, never the body.
- `setMailerOverride(fn | null)`: capture mail in tests.
- `layout(bodyHtml)`, `escapeHtml(s)`, `APP_NAME`, types `Mail`, `Mailer`, `MailEnv`, `EmailBinding`.
- Params: `appName` (display name, layout heading), `appDomain` (`MAIL_FROM` default `login@<appDomain>`), `mailer`
  (`email-service` | `console`; console never sends and drops the binding from the patch).

## Install

`kit install @coop/cf-email-sender --param appName="Acme" --param appDomain=acme.dev`; review the
`wrangler.jsonc` hunk (an existing `MAIL_FROM` keeps the project's value). No tables, routes or secrets.

## Adapt

1. Call `sendMail(c.env, mail)` (or `mailer(c.env)`) from your code; map `not_configured` to HTTP 501.
2. Before deploy: onboard `appDomain` in Email Service and set `ENVIRONMENT` to `production`.

## Verify

`npx vitest run test/mail.test.ts` and `pnpm typecheck`.

## Known limits

- No retries, idempotency keys or per-recipient limits; callers rate-limit (email-code-auth does).
- No attachments, cc/bcc or reply-to in the `Mail` type (the binding supports them; extend `Mail`).
- The override is per isolate: set and clear it inside a test.
