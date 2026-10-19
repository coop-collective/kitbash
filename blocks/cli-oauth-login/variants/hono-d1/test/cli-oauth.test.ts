// A person's own CLI with no token signs in with their account over OAuth ("My CLI on this computer") and then acts
// as the person. Revoking the sign-in signs it out at once. Ported from Ideator's test/cli-oauth.test.ts; the whole
// browser flow runs against the Worker in workerd (test/oauth-helpers.ts), no network.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { fill } from "{{paths.lib|rel}}/oauth/pages";
{{#kit.if emailSignIn}}
import { setMailerOverride, type Mail } from "{{paths.lib|rel}}/mail";
{{/kit.if}}
import { AS, LOOPBACK, REMOTE, cliConnect, form, member, raw, rpc, testEnv, toConsent, worker } from "./oauth-helpers";

const loginOf = (clientId: string) =>
  testEnv.DB.prepare("SELECT * FROM {{kit.tablePrefix}}cli_logins WHERE client_id = ?").bind(clientId).first<{ id: string; label: string; member_id: string; loopback: number; revoked_at: number | null }>();

describe("discovery", () => {
  it("a CLI with no token is told where to sign in (401 + resource metadata), also with an empty Bearer", async () => {
    for (const token of [null, ""]) {
      const r = await rpc(token);
      expect(r.status).toBe(401);
      expect(r.headers.get("www-authenticate")).toContain("resource_metadata=");
    }
  });

  it("serves the authorization server and protected resource metadata", async () => {
    const as = (await (await raw("/.well-known/oauth-authorization-server")).json()) as Record<string, unknown>;
    expect(as.authorization_endpoint).toBe(`${AS}/authorize`);
    expect(as.token_endpoint).toBe(`${AS}/oauth/token`);
    expect(as.registration_endpoint).toBe(`${AS}/oauth/register`);
    expect(as.code_challenge_methods_supported).toContain("S256");
    const pr = (await (await raw("/.well-known/oauth-protected-resource{{kit.apiRoute}}")).json()) as Record<string, unknown>;
    expect(pr.resource).toBe(`${AS}{{kit.apiRoute}}`);
    expect(pr.authorization_servers).toEqual([AS]);
  });

  it("plain http on a non-loopback host never reaches the provider", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("http://example.com/authorize"), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("OAuth is not available on this host");
  });
});

describe("CLI sign-in over OAuth", () => {
  it("the authorize page asks to sign in first, branded, and offers the token form", async () => {
    const a = await member("Ada");
    const { signInHtml } = await toConsent(a.token);
    expect(signInHtml).toContain("Sign in to {{kit.brandName}}");
    expect(signInHtml).toContain('action="/authorize/signin/token"');
{{#kit.if emailSignIn}}
    expect(signInHtml).toContain('action="/authorize/signin/email"');
{{kit.else}}
    expect(signInHtml).not.toContain('action="/authorize/signin/email"');
{{/kit.if}}
  });

  it("consent for a loopback redirect: 'on your computer?', no warning", async () => {
    const a = await member("Bo");
    const c = await toConsent(a.token);
    expect(c.status).toBe(200);
    expect(c.html).toContain("on your computer?");
    expect(c.html).toContain('name="connect_as" value="cli"');
    expect(c.html).toContain(a.email);
    expect(c.html).not.toContain("which is not this computer");
  });

  it("approving issues a cli_logins grant; the CLI then acts as the person on the API route", async () => {
    const a = await member("Coop");
    const t = await cliConnect(a.token);
    const login = await loginOf(t.client_id);
    expect(login).toMatchObject({ label: "Claude Code on my laptop", member_id: a.id, loopback: 1, revoked_at: null });
    const r = await rpc(t.access_token);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ email: a.email, via: "oauth", cli_id: login!.id });
    // it is listed for the person, and seen
    const list = (await (await raw("/api/cli-logins", { headers: { authorization: `Bearer ${a.token}` } })).json()) as { cli_logins: { id: string; last_seen_at: number }[] };
    expect(list.cli_logins.map((x) => x.id)).toEqual([login!.id]);
    expect(list.cli_logins[0]!.last_seen_at).toBeGreaterThan(0);
  });

  it("the app's own bearer token skips OAuth and still reaches the API route", async () => {
    const a = await member("Dee");
    const r = await rpc(a.token);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ email: a.email, via: "bearer", cli_id: null });
  });

  it("deny sends the person back with access_denied and makes no sign-in", async () => {
    const a = await member("Eve");
    const c = await toConsent(a.token);
    const denied = await raw("/authorize", { method: "POST", headers: { cookie: c.jar.header }, body: form({ handle: c.handle, connect_as: "cli", decision: "deny" }) });
    expect(denied.status).toBe(302);
    expect(new URL(denied.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
    expect(await loginOf(c.client_id)).toBeNull();
  });

  it("a redirect that is not this computer is {{#kit.if remoteClients == "refuse"}}refused{{kit.else}}warned about{{/kit.if}}", async () => {
    const a = await member("Fay");
    const c = await toConsent(a.token, { redirect: REMOTE, client: "Some Cloud Agent" });
{{#kit.if remoteClients == "refuse"}}
    expect(c.status).toBe(403);
    expect(c.html).toContain("Only a CLI on this computer");
{{kit.else}}
    expect(c.status).toBe(200);
    expect(c.html).toContain("which is not this computer");
    expect(c.html).toContain("agent.example.net");
    const t = await cliConnect(a.token, { redirect: REMOTE });
    expect((await loginOf(t.client_id))!.loopback).toBe(0);
{{/kit.if}}
  });

  it("the client's self-asserted name is escaped on the consent page", async () => {
    const a = await member("Gus");
    const c = await toConsent(a.token, { client: '<img src=x onerror="alert(1)">' });
    expect(c.html).not.toContain("<img src=x");
    expect(c.html).toContain("&#60;img src=x");
  });

  it("revoking the sign-in signs the CLI out at once and its refresh token stops working", async () => {
    const a = await member("Hal");
    const t = await cliConnect(a.token);
    const id = (await loginOf(t.client_id))!.id;
    // someone else cannot revoke it
    const b = await member("Ivy");
    expect((await raw(`/api/cli-logins/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${b.token}` } })).status).toBe(404);
    const del = await raw(`/api/cli-logins/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${a.token}` } });
    expect(del.status).toBe(200);
    expect(((await del.json()) as { grants: number }).grants).toBe(1);
    expect((await rpc(t.access_token)).status).toBe(401);
    const refresh = await raw("/oauth/token", { method: "POST", body: form({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client_id }) });
    expect(refresh.status).toBe(400);
    const list = (await (await raw("/api/cli-logins", { headers: { authorization: `Bearer ${a.token}` } })).json()) as { cli_logins: unknown[] };
    expect(list.cli_logins).toEqual([]);
  });

  it("a refresh token works while the sign-in is live", async () => {
    const a = await member("Jo");
    const t = await cliConnect(a.token);
    const refresh = await raw("/oauth/token", { method: "POST", body: form({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client_id }) });
    expect(refresh.status).toBe(200);
    const next = (await refresh.json()) as { access_token: string };
    expect((await rpc(next.access_token)).status).toBe(200);
  });

  it("/api/cli-logins needs the app's bearer token", async () => {
    expect((await raw("/api/cli-logins")).status).toBe(401);
  });
});

describe("authorize page edges", () => {
  it("a wrong token shows an error, and a foreign return address falls back to /authorize", async () => {
    const bad = await raw("/authorize/signin/token", { method: "POST", headers: { origin: AS }, body: form({ token: "{{kit.tokenPrefix}}nope", return: "/authorize?x=1" }) });
    expect(bad.status).toBe(200);
    expect(await bad.text()).toContain("That token is not valid");
    const a = await member("Kit");
    const ok = await raw("/authorize/signin/token", { method: "POST", headers: { origin: AS }, body: form({ token: a.token, return: "https://evil.example/authorize?x" }) });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/authorize");
    expect(ok.headers.get("set-cookie")).toMatch(/^__Host-oauth_session=.+; Path=\/; Secure; HttpOnly; SameSite=Lax/);
  });

  it("an unknown sign-in method is a 404", async () => {
    expect((await raw("/authorize/signin/password", { method: "POST", body: form({}) })).status).toBe(404);
  });

  it("posting consent without a session is refused", async () => {
    const r = await raw("/authorize", { method: "POST", body: form({ handle: "x", decision: "approve" }) });
    expect(r.status).toBe(401);
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

{{#kit.if emailSignIn}}
  it("email sign-in sends a code and a wrong code is refused", async () => {
    const email = `new-${crypto.randomUUID().slice(0, 8)}@example.test`;
    const sent = await raw("/authorize/signin/email", { method: "POST", headers: { origin: AS }, body: form({ email, return: "/authorize?x=1" }) });
    expect(sent.status).toBe(200);
    const html = await sent.text();
    expect(html).toContain("Check your email");
    expect(html).toContain(email);
    const wrong = await raw("/authorize/signin/code", { method: "POST", headers: { origin: AS }, body: form({ email, code: "12345x", return: "/authorize?x=1" }) });
    expect(await wrong.text()).toContain("That code is wrong or expired");
  });

  it("the right code signs in through email-code-auth's consumeCode and mints no bearer token", async () => {
    const outbox: Mail[] = [];
    setMailerOverride(async (m) => void outbox.push(m));
    try {
      const email = `code-${crypto.randomUUID().slice(0, 8)}@example.test`;
      await raw("/authorize/signin/email", { method: "POST", headers: { origin: AS }, body: form({ email: email.toUpperCase(), return: "/authorize?x=1" }) });
      const code = /\b(\d{6})\b/.exec(outbox.find((m) => m.to === email)!.subject)![1]!;
      const tokens = () => testEnv.DB.prepare("SELECT count(*) AS n FROM {{kit.authTablePrefix}}member_tokens").first<{ n: number }>();
      const before = (await tokens())!.n;
      const ok = await raw("/authorize/signin/code", { method: "POST", headers: { origin: AS }, body: form({ email, code, return: "/authorize?x=1" }) });
      expect(ok.status).toBe(303);
      expect(ok.headers.get("set-cookie")).toMatch(/^__Host-oauth_session=/);
      expect((await tokens())!.n).toBe(before);
      const m = await testEnv.DB.prepare("SELECT email FROM {{kit.authTablePrefix}}members WHERE email = ?").bind(email).first<{ email: string }>();
      expect(m?.email).toBe(email);
    } finally {
      setMailerOverride(null);
    }
  });
{{/kit.if}}
});

describe("page templates", () => {
  it("fills values once: typed text is never read as template syntax", () => {
    expect(fill("<p>{{a}}</p>{{#b}}[{{b}}]{{/b}}{{^c}}none{{/c}}", { a: "{{b}}<x>", b: "yes" })).toBe("<p>{{b}}&#60;x&#62;</p>[yes]none");
    expect(fill("{{{raw}}}", { raw: "<b>ok</b>" })).toBe("<b>ok</b>");
  });

  it("uses the loopback constant the CLI flow relies on", () => {
    expect(new URL(LOOPBACK).hostname).toBe("127.0.0.1");
  });
});


describe("OAuth browser login CSRF", () => {
  it("rejects foreign, missing and opaque Origin on every sign-in method before setting cookies", async () => {
    const attacker = await member("LoginCsrfAttacker");
    const before = await testEnv.OAUTH_KV.list({ prefix: "oauth_session:" });
    for (const how of ["token", "email", "code"]) {
      for (const origin of [undefined, "null", "https://untrusted.example.test", `${AS}.evil.example.test`, `${AS}:444`]) {
        const response = await raw(`/authorize/signin/${how}`, {
          method: "POST",
          headers: origin === undefined ? {} : { origin },
          body: form({ token: attacker.token, email: attacker.email, code: "123456", return: "/authorize?client_id=example" }),
        });
        expect(response.status, `${how}: ${origin}`).toBe(403);
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
    }
    expect((await testEnv.OAUTH_KV.list({ prefix: "oauth_session:" })).keys).toEqual(before.keys);
  });

  it("keeps the native form Origin available without disclosing referrers cross-origin", async () => {
    const response = await raw("/authorize/signin/token", { method: "POST", headers: { origin: AS }, body: form({ token: "invalid" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

{{#kit.if emailSignIn}}
  it("rejects foreign email sends and preserves a valid code for the same-origin submission", async () => {
    const outbox: Mail[] = [];
    setMailerOverride(async m => void outbox.push(m));
    try {
      const email = `csrf-${crypto.randomUUID().slice(0, 8)}@example.test`;
      const blocked = await raw("/authorize/signin/email", { method: "POST", headers: { origin: "https://untrusted.example.test" }, body: form({ email }) });
      expect(blocked.status).toBe(403);
      expect(outbox).toHaveLength(0);
      await raw("/authorize/signin/email", { method: "POST", headers: { origin: AS }, body: form({ email }) });
      const code = /\b(\d{6})\b/.exec(outbox[0]!.subject)![1]!;
      const forged = await raw("/authorize/signin/code", { method: "POST", headers: { origin: "https://untrusted.example.test" }, body: form({ email, code }) });
      expect(forged.status).toBe(403);
      expect(forged.headers.get("set-cookie")).toBeNull();
      const valid = await raw("/authorize/signin/code", { method: "POST", headers: { origin: AS }, body: form({ email, code }) });
      expect(valid.status).toBe(303);
      expect(valid.headers.get("set-cookie")).toMatch(/^__Host-oauth_session=/);
    } finally { setMailerOverride(null); }
  });
{{/kit.if}}
});
