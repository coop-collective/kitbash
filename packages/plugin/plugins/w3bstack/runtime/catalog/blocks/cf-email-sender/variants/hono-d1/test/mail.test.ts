// cf-email-sender: which mailer each environment gets, what reaches the binding, and how failures surface.
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_NAME, escapeHtml, layout, mailer, MailError, mailErrorCode, sendMail, setMailerOverride, type EmailBinding, type Mail, type MailEnv } from "{{paths.lib|rel}}/cf-email-sender/mail";

type Sent = Parameters<EmailBinding["send"]>[0];

function fakeBinding(fail?: unknown): EmailBinding & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    async send(message) {
      if (fail) throw fail;
      sent.push(message);
      return { messageId: "test" };
    },
  };
}

const hello: Mail = { to: "ada@example.com", subject: "Hello", text: "Hi Ada", html: "<p>Hi Ada</p>" };

afterEach(() => {
  setMailerOverride(null);
  vi.restoreAllMocks();
});

describe("mailer(env)", () => {
{{#kit.if mailer == "email-service"}}
  it("sends through the EMAIL binding from MAIL_FROM with the app name", async () => {
    const EMAIL = fakeBinding();
    const send = mailer({ EMAIL, MAIL_FROM: "login@example.com", ENVIRONMENT: "production" });
    expect(send).not.toBeNull();
    await send!(hello);
    expect(EMAIL.sent).toEqual([{ from: { email: "login@example.com", name: APP_NAME }, to: "ada@example.com", subject: "Hello", text: "Hi Ada", html: "<p>Hi Ada</p>" }]);
  });

  it("omits html when the mail has none", async () => {
    const EMAIL = fakeBinding();
    await mailer({ EMAIL, MAIL_FROM: "login@example.com" })!({ to: "b@example.com", subject: "s", text: "t" });
    expect(EMAIL.sent[0]).not.toHaveProperty("html");
  });
{{kit.else}}
  it("never sends through a binding in console mode", async () => {
    const EMAIL = fakeBinding();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await mailer({ EMAIL, MAIL_FROM: "login@example.com", ENVIRONMENT: "dev" })!(hello);
    expect(EMAIL.sent).toHaveLength(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(mailer({ EMAIL, MAIL_FROM: "login@example.com", ENVIRONMENT: "production" })).toBeNull();
  });
{{/kit.if}}

  it("prints instead of sending in dev when there is no binding", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await mailer({ ENVIRONMENT: "dev" })!(hello);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({ to: "ada@example.com", subject: "Hello", text: "Hi Ada" });
  });

  it("is null in production without a binding (callers refuse, they don't fake it)", () => {
    expect(mailer({ ENVIRONMENT: "production" })).toBeNull();
    expect(mailer({ ENVIRONMENT: "production", MAIL_FROM: "login@example.com" })).toBeNull();
    expect(mailer({})).toBeNull();
  });

  it("an override captures every mail", async () => {
    const got: Mail[] = [];
    setMailerOverride(async (m) => void got.push(m));
    await sendMail({ ENVIRONMENT: "production" }, hello);
    expect(got).toEqual([hello]);
  });
});

describe("sendMail", () => {
  it("throws not_configured without a mailer", async () => {
    await expect(sendMail({ ENVIRONMENT: "production" }, hello)).rejects.toMatchObject({ code: "not_configured" });
  });

{{#kit.if mailer == "email-service"}}
  it("surfaces only the Email Service error code", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env: MailEnv = { EMAIL: fakeBinding(Object.assign(new Error("sender example.com is not verified"), { code: "E_SENDER_NOT_VERIFIED" })), MAIL_FROM: "login@example.com" };
    const err = await sendMail(env, hello).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailError);
    expect((err as MailError).code).toBe("E_SENDER_NOT_VERIFIED");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Hi Ada");
  });
{{/kit.if}}

  it("mailErrorCode ignores junk codes", () => {
    expect(mailErrorCode({ code: "E_RATE_LIMITED" })).toBe("E_RATE_LIMITED");
    expect(mailErrorCode({ code: "<script>" })).toBe("unknown");
    expect(mailErrorCode(new TypeError("x"))).toBe("TypeError");
  });
});

describe("html", () => {
  it("escapes and frames", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&#60;a href=&#34;x&#34;&#62;&#39;&#38;&#39;&#60;/a&#62;");
    const page = layout("<p>body</p>");
    expect(page).toContain("<p>body</p>");
    expect(page).toContain(escapeHtml(APP_NAME));
    expect(page.startsWith("<!doctype html>")).toBe(true);
  });
});
