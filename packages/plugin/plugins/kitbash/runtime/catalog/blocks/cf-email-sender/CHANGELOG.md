# Changelog

## 2.0.0

Source payloads mirror installation paths.

### Upgrade

Use `src/lib/cf-email-sender/` and the declared route paths; update imports and catalog checkouts. HTTP URLs and database migrations are unchanged.

## 1.0.1

- `e2e.json` is no longer declared in `files[]` (it was copied into projects as a doc/fixture); core allows it undeclared and the e2e harness reads it from the block directory.

## 1.0.0

- First harvest from Ideator `mail.ts` (mailer(env), dev printing, layout) with social-connector's test override and
  error-code-only logging. Params `appName`, `appDomain`, `mailer`.
