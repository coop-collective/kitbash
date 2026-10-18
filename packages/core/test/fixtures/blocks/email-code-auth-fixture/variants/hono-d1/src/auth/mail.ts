import type { AuthEnv } from "./types";

type Hook = (to: string, code: string) => void;
let hook: Hook | null = null;

/** Tests capture codes here instead of sending mail. */
export function setMailHook(h: Hook | null): void {
  hook = h;
}

export async function sendCode(env: AuthEnv, to: string, code: string): Promise<void> {
  if (hook) return hook(to, code);
{{#kit.if mailer == "console"}}
  console.log(`[auth] login code for ${to}: ${code}`);
{{kit.else}}
  if (!env.EMAIL) {
    if (env.ENVIRONMENT === "production") throw new Error("EMAIL binding missing: refusing to sign in without mail");
    console.log(`[auth] (dev, no EMAIL binding) login code for ${to}: ${code}`);
    return;
  }
  await env.EMAIL.send({
    from: env.MAIL_FROM ?? "login@{{kit.appDomain}}",
    to,
    subject: "Your sign-in code",
    text: `Your code is ${code}. It expires in {{kit.codeTtlMin}} minutes.`,
  });
{{/kit.if}}
}
