// cf-email-sender: which mailer each environment gets, what reaches the binding, and how failures surface.
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_NAME, escapeHtml, layout, mailer, MailError, mailErrorCode, sendMail, setMailerOverride, type EmailBinding, type Mail, type MailEnv } from "../src/lib/mail";

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
  it("never sends through a binding in console mode", async () => {
    const EMAIL = fakeBinding();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await mailer({ EMAIL, MAIL_FROM: "login@example.com", ENVIRONMENT: "dev" })!(hello);
    expect(EMAIL.sent).toHaveLength(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(mailer({ EMAIL, MAIL_FROM: "login@example.com", ENVIRONMENT: "production" })).toBeNull();
  });

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
