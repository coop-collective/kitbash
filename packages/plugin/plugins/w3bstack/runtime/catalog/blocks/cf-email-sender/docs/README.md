# cf-email-sender

Transactional mail for a Worker through Cloudflare Email Service's `send_email` binding.

- Production: `EMAIL` bound and `MAIL_FROM` on an onboarded domain → mail is sent.
- Dev (`ENVIRONMENT=dev`): mail is printed as a JSON log line, so sign-in codes are readable in `wrangler dev`.
- Anything else: `mailer(env)` is `null` and `sendMail` throws `not_configured`; the app answers 501 instead of
  pretending a mail went out.

Harvested from Ideator (`packages/api/src/mail.ts`) and social-connector (`telegram-connector/src/auth/mailer.ts`).
