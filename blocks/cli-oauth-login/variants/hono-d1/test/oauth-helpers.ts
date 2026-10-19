// The OAuth browser flow a CLI opens (register, authorize with sign-in and consent, PKCE token exchange), scripted
// against the Worker in workerd: no network. Ported from Ideator's test/oauth-helpers.ts.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { expect } from "vitest";
import { issueToken, upsertMember } from "{{paths.lib|rel}}/auth/tokens";
import { requirePerson, type PersonVars } from "{{paths.lib|rel}}/oauth/middleware";
import { oauthWorker } from "{{paths.lib|rel}}/oauth/provider";
import type { OAuthEnv } from "{{paths.lib|rel}}/oauth/types";
import { cliLoginRoutes, oauthRoutes } from "{{paths.routes|rel}}/oauth";

export const AS = "https://app.test";
export const LOOPBACK = "http://127.0.0.1:43123/callback";
export const REMOTE = "https://agent.example.net/oauth/callback";

/** The bindings from wrangler.jsonc plus a test-only pepper (the auth block reads TOKEN_PEPPER). */
export const testEnv = { ...(env as unknown as OAuthEnv), TOKEN_PEPPER: "test-pepper-not-a-secret-32-chars-min" } as OAuthEnv;

/** The app as a host project wires it: the authorize routes, /api/cli-logins, and an API route behind requirePerson. */
export const app = new Hono<{ Bindings: OAuthEnv; Variables: PersonVars }>();
app.route("/", oauthRoutes);
app.route("/api", cliLoginRoutes);
app.all("{{kit.apiRoute}}", requirePerson, (c) => c.json({ email: c.get("member").email, via: c.get("cliLogin") ? "oauth" : "bearer", cli_id: c.get("cliLogin")?.id ?? null }));
export const worker = oauthWorker(app);

export async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(AS + path, { redirect: "manual", ...init }), testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** A person with a bearer token, made through email-code-auth's own upsertMember and issueToken (its members table). */
export async function member(name: string): Promise<{ id: string; email: string; token: string }> {
  const authEnv = testEnv as unknown as Parameters<typeof issueToken>[0];
  const email = `${name.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const { member: m } = await upsertMember(authEnv, email, name);
  const token = await issueToken(authEnv, m.id, "test");
  return { id: m.id, email, token };
}

/** A tiny cookie jar: what the authorize pages set, sent back on the next request. */
export class Jar {
  cookies = new Map<string, string>();
  take(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv!.indexOf("=");
      this.cookies.set(kv!.slice(0, i), kv!.slice(i + 1));
    }
  }
  get header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function pkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

export const form = (o: Record<string, string | string[]>) => {
  const f = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};

export async function register(redirect = LOOPBACK, name = "Claude Code") {
  const r = await raw("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
  });
  expect(r.status).toBe(201);
  return (await r.json()) as { client_id: string };
}

/** Register, open /authorize, sign in with a token (session cookie), and load the consent page. */
export async function toConsent(token: string, opts: { redirect?: string; client?: string } = {}) {
  const redirect = opts.redirect ?? LOOPBACK;
  const { client_id } = await register(redirect, opts.client ?? "Claude Code");
  const { verifier, challenge } = await pkce();
  const q = new URLSearchParams({ response_type: "code", client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state: "s1", scope: "mcp", resource: `${AS}{{kit.apiRoute}}` });
  const authorizeUrl = `/authorize?${q}`;
  const jar = new Jar();
  const signInHtml = await (await raw(authorizeUrl)).text();
  const signed = await raw("/authorize/signin/token", { method: "POST", headers: { origin: AS }, body: form({ token, return: authorizeUrl }) });
  expect(signed.status).toBe(303);
  expect(signed.headers.get("location")).toBe(authorizeUrl);
  jar.take(signed);
  const consent = await raw(authorizeUrl, { headers: { cookie: jar.header } });
  jar.take(consent);
  const html = await consent.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? "";
  return { client_id, verifier, redirect, authorizeUrl, jar, signInHtml, status: consent.status, html, handle };
}

/** The whole flow: consent as "My CLI on this computer", then exchange the code with PKCE. */
export async function cliConnect(token: string, opts: { redirect?: string; label?: string; client?: string } = {}) {
  const c = await toConsent(token, opts);
  expect(c.status).toBe(200);
  const approved = await raw("/authorize", {
    method: "POST",
    headers: { cookie: c.jar.header },
    body: form({ handle: c.handle, connect_as: "cli", decision: "approve", label: opts.label ?? "Claude Code on my laptop" }),
  });
  expect(approved.status).toBe(302);
  const back = new URL(approved.headers.get("location")!);
  expect(back.origin + back.pathname).toBe(c.redirect);
  expect(back.searchParams.get("state")).toBe("s1");
  const code = back.searchParams.get("code")!;
  const res = await raw("/oauth/token", {
    method: "POST",
    body: form({ grant_type: "authorization_code", code, redirect_uri: c.redirect, client_id: c.client_id, code_verifier: c.verifier, resource: `${AS}{{kit.apiRoute}}` }),
  });
  expect(res.status).toBe(200);
  const tok = (await res.json()) as { access_token: string; refresh_token: string; token_type: string };
  return { ...tok, client_id: c.client_id, html: c.html, signInHtml: c.signInHtml };
}

/** A JSON-RPC call to the API route, as an MCP client sends it. */
export const rpc = (token: string | null, method = "tools/list") =>
  raw("{{kit.apiRoute}}", {
    method: "POST",
    headers: { ...(token !== null ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }),
  });
