// Invitation mail through Cloudflare Email Service (the send_email binding EMAIL, from MAIL_FROM). In dev it is printed
// instead; with neither, there is no mailer and the invite stands without mail. To send through cf-email-sender or
// another mailer, change sendMail only.
import type { OrgsEnv } from "./types";

export type Mail = { to: string; subject: string; text: string; html: string };
export type Mailer = (m: Mail) => Promise<void>;

let hook: Mailer | null = null;
/** Tests capture invitation mail here instead of sending it. */
export function setMailHook(h: Mailer | null): void {
  hook = h;
}

export function mailer(env: OrgsEnv): Mailer | null {
  if (hook) return hook;
  if (env.EMAIL && env.MAIL_FROM) {
    const mail = env.EMAIL;
    const from = { email: env.MAIL_FROM, name: "{{kit.brandName}}" };
    return async (m) => {
      await mail.send({ from, to: m.to, subject: m.subject, text: m.text, html: m.html });
    };
  }
  if (env.ENVIRONMENT === "dev") {
    return async (m) => {
      console.log(JSON.stringify({ msg: "invite mail (dev only: printed instead of sent)", to: m.to, subject: m.subject }));
    };
  }
  return null;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const layout = (body: string) => `<!doctype html><html><body style="margin:0;background:#f6f6f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a">
<div style="max-width:440px;margin:32px auto;background:#fff;border-radius:12px;padding:28px 28px 22px;border:1px solid #e6e6e1">
<div style="font-weight:700;font-size:15px;margin-bottom:18px">{{kit.brandName}}</div>${body}
<p style="margin:22px 0 0;font-size:12px;color:#888">If you did not expect this, you can ignore this email.</p></div></body></html>`;

export function inviteMail(to: string, orgName: string, inviter: string): Mail {
  return {
    to,
    subject: `${inviter} added you to ${orgName} on {{kit.brandName}}`,
    text: `${inviter} added you to ${orgName} on {{kit.brandName}}.\n\nSign in at {{kit.appUrl}} with this email address (${to}) and pick ${orgName}.`,
    html: layout(`<p style="margin:0 0 10px;font-size:14px"><b>${esc(inviter)}</b> added you to <b>${esc(orgName)}</b> on {{kit.brandName}}.</p>
<p style="margin:0;font-size:13px;color:#555">Sign in at <a href="{{kit.appUrl}}">{{kit.appUrl}}</a> with this address (${esc(to)}) and pick ${esc(orgName)}.</p>`),
  };
}
