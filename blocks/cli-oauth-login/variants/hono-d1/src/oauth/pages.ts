// The authorize pages. The HTML lives in ./templates/*.html (brand params rendered at install); this file fills them.
// Template syntax (a mustache subset): {{name}} escaped, {{{name}}} raw (only for HTML this file built), {{#name}} … {{/name}}
// kept when truthy, {{^name}} … {{/name}} kept when falsy. Values are inserted in one pass, so text a person typed is never
// read as template syntax.
import code from "./templates/code.html";
import consent from "./templates/consent.html";
import error from "./templates/error.html";
import layout from "./templates/layout.html";
import signin from "./templates/signin.html";

export const TEMPLATES = { code, consent, error, layout, signin } as const;

type Vars = Record<string, unknown>;

export const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const SECTION = /\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/g;
const VALUE = /\{\{\{(\w+)\}\}\}|\{\{(\w+)\}\}/g;

export function fill(template: string, vars: Vars): string {
  let t = template;
  // sections only keep or drop template text; repeat for nesting (no values are inserted yet)
  for (let i = 0; i < 8; i++) {
    const next = t.replace(SECTION, (_, kind: string, name: string, inner: string) => ((kind === "#") === !!vars[name] ? inner : ""));
    if (next === t) break;
    t = next;
  }
  return t.replace(VALUE, (_, raw: string | undefined, name: string | undefined) => (raw ? String(vars[raw] ?? "") : esc(vars[name!])));
}

const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:* http://[::1]:*; frame-ancestors 'none'; base-uri 'none'";

export function page(title: string, body: string, status = 200, headers?: Headers): Response {
  const h = headers ?? new Headers();
  h.set("content-type", "text/html; charset=utf-8");
  h.set("x-frame-options", "DENY");
  h.set("content-security-policy", CSP);
  h.set("cache-control", "no-store");
  h.set("referrer-policy", "no-referrer");
  return new Response(fill(TEMPLATES.layout, { title, body }), { status, headers: h });
}

export const errorPage = (message: string, status = 400) => page("Can't connect", fill(TEMPLATES.error, { message }), status);

export function signInPage(returnTo: string, opts: { emailEnabled: boolean; error?: string; email?: string; step?: "email" | "code" }): Response {
  const vars = { return_to: returnTo, error: opts.error, email: opts.email, email_enabled: opts.emailEnabled };
  if (opts.step === "code") return page("Enter your code", fill(TEMPLATES.code, vars));
  return page("Sign in", fill(TEMPLATES.signin, vars));
}

export function consentPage(
  vars: { handle: string; client_name: string; client_domain?: string; redirect_host: string; loopback: boolean; member_name: string; member_email: string; label: string },
  headers: Headers,
): Response {
  return page(`Connect ${vars.client_name}`, fill(TEMPLATES.consent, vars), 200, headers);
}
