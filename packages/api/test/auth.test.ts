// email-code-auth, in workerd against the project's migrated D1: the BLOCK-SPEC §10 scenario plus the hygiene the
// block promises (peppered hashes, atomic attempt counting, single use under a race, quiet rate limits).
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { peppered, sha256Hex } from "../src/lib/crypto";
import { setMailerOverride, type Mail } from "../src/lib/mail";
import { consumeCode, GLOBAL_PER_10_MIN, MAX_ATTEMPTS, PER_ADDRESS_PER_HOUR, startCode, verifyCode } from "../src/lib/auth/codes";
import { requireBearer } from "../src/lib/auth/middleware";
import { authenticate, revokeToken, TOKEN_PREFIX, TOKEN_RE, upsertMember } from "../src/lib/auth/tokens";
import { AuthError, type AuthEnv } from "../src/lib/auth/types";
import { authRoutes, meRoutes } from "../src/routes/auth";

// Test-only pepper (not a secret): production reads TOKEN_PEPPER from a Worker secret.
const PEPPER = "test-pepper-for-the-vitest-suite-only-0000";
const authEnv: AuthEnv = { DB: env.DB, TOKEN_PEPPER: PEPPER, ENVIRONMENT: "production" };
const T = (name: string) => `${name}`;

const outbox: Mail[] = [];
setMailerOverride(async (m) => void outbox.push(m));
afterEach(() => {
  outbox.length = 0;
  setMailerOverride(async (m) => void outbox.push(m));
  vi.restoreAllMocks();
});

/** The code in the newest mail to `to`. */
function lastCode(to: string): string {
  const m = [...outbox].reverse().find((x) => x.to === to);
  if (!m) throw new Error(`no mail to ${to}`);
  return /\b(\d{6})\b/.exec(m.subject)![1]!;
}

const wrongFor = (code: string) => (code === "000000" ? "111111" : "000000");

const app = new Hono<{ Bindings: AuthEnv }>();
app.route("/auth", authRoutes);
app.route("/", meRoutes);
const post = (path: string, payload: unknown, headers: Record<string, string> = {}, e: AuthEnv = authEnv) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload) }, e);

describe("the sign-in scenario (BLOCK-SPEC §10)", () => {
  it("start, 5 wrong guesses lock the code, a fresh code verifies once, the token works until logout", async () => {
    const email = "ada@example.com";
    expect((await post("/auth/email/start", { email: " Ada@Example.com " })).status).toBe(200);
    const first = lastCode(email);
    expect(first).toMatch(/^\d{6}$/);
    for (let i = 0; i < MAX_ATTEMPTS; i++) expect((await post("/auth/email/verify", { email, code: wrongFor(first) })).status).toBe(401);
    expect((await post("/auth/email/verify", { email, code: first })).status).toBe(401); // locked

    expect((await post("/auth/email/start", { email })).status).toBe(200);
    const fresh = lastCode(email);
    const ok = await post("/auth/email/verify", { email, code: fresh });
    expect(ok.status).toBe(200);
    const signIn = (await ok.json()) as { token: string; member: { id: string; email: string }; created: boolean };
    expect(signIn.token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(signIn.token).toMatch(TOKEN_RE);
    expect(signIn.member.email).toBe(email);
    expect(signIn.created).toBe(true);
    expect((await post("/auth/email/verify", { email, code: fresh })).status).toBe(401); // single use

    const auth = { authorization: `Bearer ${signIn.token}` };
    const me = await app.request("/api/me", { headers: auth }, authEnv);
    expect(me.status).toBe(200);
    expect(((await me.json()) as { member: { id: string } }).member.id).toBe(signIn.member.id);

    expect((await post("/auth/logout", {}, auth)).status).toBe(200);
    expect((await app.request("/api/me", { headers: auth }, authEnv)).status).toBe(401);
  });

  it("a revoked token gets 401; a second sign-in reuses the member", async () => {
    const email = "bob@example.com";
    await startCode(authEnv, email);
    const a = (await verifyCode(authEnv, email, lastCode(email)))!;
    expect(await authenticate(authEnv, a.token)).toMatchObject({ email });
    expect(await revokeToken(authEnv, a.token)).toBe(true);
    expect(await authenticate(authEnv, a.token)).toBeNull();
    expect((await app.request("/api/me", { headers: { authorization: `Bearer ${a.token}` } }, authEnv)).status).toBe(401);
    await startCode(authEnv, email);
    const b = (await verifyCode(authEnv, email, lastCode(email)))!;
    expect(b.created).toBe(false);
    expect(b.member.id).toBe(a.member.id);
  });

  it("consumeCode uses the code and returns the (lowercased) member without minting a token", async () => {
    const email = "consume@example.com";
    await startCode(authEnv, " CONSUME@Example.com ");
    const tokensBefore = await env.DB.prepare(`SELECT count(*) AS n FROM ${T("member_tokens")}`).first<{ n: number }>();
    const r = (await consumeCode(authEnv, "Consume@Example.COM", lastCode(email)))!;
    expect(r.member.email).toBe(email);
    expect(r.created).toBe(true);
    const tokensAfter = await env.DB.prepare(`SELECT count(*) AS n FROM ${T("member_tokens")}`).first<{ n: number }>();
    expect(tokensAfter!.n).toBe(tokensBefore!.n);
    expect(await consumeCode(authEnv, email, lastCode(email))).toBeNull(); // single use
  });

  it(`the ${PER_ADDRESS_PER_HOUR + 1}th code in an hour is quietly dropped`, async () => {
    const email = "cy@example.com";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < PER_ADDRESS_PER_HOUR; i++) expect(await startCode(authEnv, email)).toEqual({ sent: true });
    expect(outbox.filter((m) => m.to === email)).toHaveLength(PER_ADDRESS_PER_HOUR);
    const res = await post("/auth/email/start", { email });
    expect(res.status).toBe(200); // same reply
    expect(outbox.filter((m) => m.to === email)).toHaveLength(PER_ADDRESS_PER_HOUR); // no mail
    const n = await env.DB.prepare(`SELECT count(*) AS n FROM ${T("login_codes")} WHERE email = ?`).bind(email).first<{ n: number }>();
    expect(n!.n).toBe(PER_ADDRESS_PER_HOUR);
    expect(warn).toHaveBeenCalled();
  });
});

describe("hygiene", () => {
  it("stores codes and tokens only as peppered HMACs", async () => {
    const email = "dee@example.com";
    await startCode(authEnv, email);
    const code = lastCode(email);
    const row = await env.DB.prepare(`SELECT code_hash FROM ${T("login_codes")} WHERE email = ?`).bind(email).first<{ code_hash: string }>();
    expect(row!.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.code_hash).not.toBe(await sha256Hex(`${email}:${code}`)); // the unpeppered scheme this block replaces
    expect(row!.code_hash).toBe(await peppered(PEPPER, "login-code/v1", `${email}\n${code}`));

    const { token, member } = (await verifyCode(authEnv, email, code))!;
    const t = await env.DB.prepare(`SELECT token_hash FROM ${T("member_tokens")} WHERE member_id = ?`).bind(member.id).first<{ token_hash: string }>();
    expect(t!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t!.token_hash).not.toBe(await sha256Hex(token));
    // the pepper is part of the key: the same token under another pepper does not authenticate
    expect(await authenticate({ ...authEnv, TOKEN_PEPPER: `${PEPPER}-rotated` }, token)).toBeNull();
    expect(await authenticate(authEnv, token)).not.toBeNull();
  });

  it("refuses to run without a 32+ character pepper", async () => {
    for (const TOKEN_PEPPER of [undefined, "", "short"]) {
      const e = { ...authEnv, TOKEN_PEPPER };
      await expect(startCode(e, "eve@example.com")).rejects.toMatchObject({ status: 500, code: "not_configured" });
      expect((await post("/auth/email/start", { email: "eve@example.com" }, {}, e)).status).toBe(500);
      expect((await app.request("/api/me", { headers: { authorization: `Bearer ${TOKEN_PREFIX}${"a".repeat(43)}` } }, e)).status).toBe(500);
    }
    expect(outbox).toHaveLength(0);
  });

  it("an expired code does not verify", async () => {
    const email = "fay@example.com";
    await startCode(authEnv, email);
    await env.DB.prepare(`UPDATE ${T("login_codes")} SET expires_at = ? WHERE email = ?`).bind(Date.now() - 1, email).run();
    expect(await verifyCode(authEnv, email, lastCode(email))).toBeNull();
  });

  it("only the newest code counts, and malformed input never costs an attempt", async () => {
    const email = "gus@example.com";
    await startCode(authEnv, email);
    const older = lastCode(email);
    await startCode(authEnv, email);
    const newer = lastCode(email);
    if (older !== newer) expect(await verifyCode(authEnv, email, older)).toBeNull();
    expect(await verifyCode(authEnv, email, "12ab56")).toBeNull();
    expect(await verifyCode(authEnv, "not-an-email", newer)).toBeNull();
    expect(await verifyCode(authEnv, email, ` ${newer.slice(0, 3)} ${newer.slice(3)} `)).not.toBeNull(); // spaces are ignored
  });

  it("a code is single use even when two verifies race", async () => {
    const email = "hal@example.com";
    await startCode(authEnv, email);
    const code = lastCode(email);
    const results = await Promise.all([verifyCode(authEnv, email, code), verifyCode(authEnv, email, code), verifyCode(authEnv, email, code)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it(`stops all sending past ${GLOBAL_PER_10_MIN} codes per 10 minutes`, async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const now = Date.now();
    const ins = env.DB.prepare(`INSERT INTO ${T("login_codes")} (id, email, code_hash, expires_at, created_at) VALUES (?, ?, 'x', ?, ?)`);
    await env.DB.batch(Array.from({ length: GLOBAL_PER_10_MIN }, (_, i) => ins.bind(`flood_${i}`, `flood${i}@example.com`, now + 60_000, now)));
    try {
      await startCode(authEnv, "ivy@example.com");
      expect(outbox).toHaveLength(0);
    } finally {
      await env.DB.prepare(`DELETE FROM ${T("login_codes")} WHERE id LIKE 'flood_%'`).run();
    }
  });
});

describe("routes and middleware", () => {
  it("validates input", async () => {
    expect((await post("/auth/email/start", { email: "nope" })).status).toBe(400);
    expect((await post("/auth/email/start", "not an object")).status).toBe(400);
    expect((await post("/auth/email/verify", { email: "jo@example.com" })).status).toBe(400);
    expect((await post("/auth/email/verify", { email: "jo@example.com", code: "123456" })).status).toBe(401);
  });

  it("rejects missing, malformed and unknown tokens with WWW-Authenticate", async () => {
    for (const h of [undefined, "Bearer", "Basic abc", `Bearer ${TOKEN_PREFIX}short`, `Bearer ${TOKEN_PREFIX}${"a".repeat(43)}`]) {
      const res = await app.request("/api/me", h ? { headers: { authorization: h } } : {}, authEnv);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("Bearer");
    }
  });

  it("answers 501 when no mailer is configured, 503 when sending fails, and keeps no code", async () => {
    setMailerOverride(null); // production env, no EMAIL binding: no mailer
    expect((await post("/auth/email/start", { email: "kim@example.com" })).status).toBe(501);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setMailerOverride(async () => {
      throw Object.assign(new Error("boom"), { code: "E_SENDER_NOT_VERIFIED" });
    });
    expect((await post("/auth/email/start", { email: "kim@example.com" })).status).toBe(503);
    const n = await env.DB.prepare(`SELECT count(*) AS n FROM ${T("login_codes")} WHERE email = ?`).bind("kim@example.com").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("upsertMember is idempotent per address", async () => {
    const a = await upsertMember(authEnv, "lea@example.com", "Lea");
    const b = await upsertMember(authEnv, "lea@example.com");
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.member).toEqual(a.member);
    expect(a.member.name).toBe("Lea");
  });

  it("AuthError carries status and code", () => {
    const e = new AuthError(501, "not_configured", "x");
    expect(e).toBeInstanceOf(Error);
    expect([e.status, e.code]).toEqual([501, "not_configured"]);
  });
});

// Compile-time check of the adapt steps against the project's generated Env (tsc covers this file).
export const wiringCheck = new Hono<{ Bindings: Env }>().use("/api/*", requireBearer).route("/auth", authRoutes).route("/", meRoutes);
