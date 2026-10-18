// Mail the app sends on its own behalf (sign-in codes, invitations, receipts) through Cloudflare Email Service: the
// `send_email` binding EMAIL, from MAIL_FROM on a domain onboarded in Email Service. In dev and tests the message is
// printed instead. With neither, `mailer(env)` is null and the caller refuses the action instead of faking it.
//
// Harvested from Ideator (packages/api/src/mail.ts: mailer(env), layout, escaping) and social-connector
// (telegram-connector/src/auth/mailer.ts: the test override, logging only the Email Service error code).

export const APP_NAME = "{{kit.appName}}";

export type Mail = { to: string; subject: string; text: string; html?: string };
export type Mailer = (m: Mail) => Promise<void>;

/** The part of the Email Service binding this module uses (the generated `SendEmail` type satisfies it). */
export interface EmailBinding {
  send(message: { from: { email: string; name: string }; to: string; subject: string; text: string; html?: string }): Promise<unknown>;
}

/** The bindings and vars this module reads. Declared here so it typechecks before `wrangler types` is re-run. */
export interface MailEnv {
  EMAIL?: EmailBinding;
  MAIL_FROM?: string;
  ENVIRONMENT?: string;
}

const PRINT_ENVIRONMENTS = new Set(["dev", "development", "local", "test"]);

let override: Mailer | null = null;

/** Tests (and local tools) capture mail here instead of sending it; pass null to restore. */
export function setMailerOverride(m: Mailer | null): void {
  override = m;
}

/** The mailer for this environment, or null when mail can't be sent (the caller should answer 501, not pretend). */
export function mailer(env: MailEnv): Mailer | null {
  if (override) return override;
{{#kit.if mailer == "email-service"}}
  if (env.EMAIL && env.MAIL_FROM) {
    const binding = env.EMAIL;
    const from = { email: env.MAIL_FROM, name: APP_NAME };
    return async (m) => {
      await binding.send({ from, to: m.to, subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) });
    };
  }
{{/kit.if}}
  if (PRINT_ENVIRONMENTS.has(env.ENVIRONMENT ?? "")) {
    return async (m) => {
      console.log(JSON.stringify({ msg: "mail (dev only: printed instead of sent)", to: m.to, subject: m.subject, text: m.text }));
    };
  }
  return null;
}

/** Sends one message; throws `MailError` with the Email Service error code (never the message body) on failure. */
export async function sendMail(env: MailEnv, m: Mail): Promise<void> {
  const send = mailer(env);
  if (!send) throw new MailError("not_configured", "no mailer: bind EMAIL and set MAIL_FROM (or run with ENVIRONMENT=dev)");
  try {
    await send(m);
  } catch (err) {
    const code = mailErrorCode(err);
    console.warn(JSON.stringify({ msg: "mail send failed", code }));
    throw new MailError(code, `mail send failed (${code})`);
  }
}

export class MailError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MailError";
  }
}

/** Email Service errors carry a `code` such as E_SENDER_NOT_VERIFIED; that is all that should be logged. */
export function mailErrorCode(err: unknown): string {
  const c = (err as { code?: unknown } | null)?.code;
  return typeof c === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(c) ? c : err instanceof Error ? err.name : "unknown";
}

export const escapeHtml = (v: string): string => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A plain, inline-styled HTML frame with the app name on top. `bodyHtml` must already be escaped. */
export function layout(bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f6f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a">
<div style="max-width:440px;margin:32px auto;background:#fff;border-radius:12px;padding:28px 28px 22px;border:1px solid #e6e6e1">
<div style="font-weight:700;font-size:15px;margin-bottom:18px">${escapeHtml(APP_NAME)}</div>${bodyHtml}
<p style="margin:22px 0 0;font-size:12px;color:#888">If you did not ask for this, you can ignore this email.</p></div></body></html>`;
}
