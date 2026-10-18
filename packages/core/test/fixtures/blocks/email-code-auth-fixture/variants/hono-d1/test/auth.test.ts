import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { verifyCode, startCode } from "{{paths.lib|rel}}/auth/codes";
import { hmacHex, randomDigits, timingSafeEqualHex } from "{{paths.lib|rel}}/auth/crypto";
import { setMailHook } from "{{paths.lib|rel}}/auth/mail";
import { authenticate, revokeToken, TOKEN_PREFIX } from "{{paths.lib|rel}}/auth/tokens";
import type { AuthEnv } from "{{paths.lib|rel}}/auth/types";
import { authRoutes, meRoutes } from "{{paths.routes|rel}}/auth";

const authEnv = { DB: env.DB, TOKEN_PEPPER: "test-pepper-not-a-secret" } as AuthEnv;

async function signIn(email: string): Promise<string> {
  let code = "";
  setMailHook((_to, c) => {
    code = c;
  });
  await startCode(authEnv, email);
  const r = await verifyCode(authEnv, email, code);
  if (!r) throw new Error("sign-in failed");
  return r.token;
}

afterEach(() => setMailHook(null));

describe("crypto", () => {
  it("hmacHex is deterministic and keyed", async () => {
    expect(await hmacHex("k", "m")).toBe(await hmacHex("k", "m"));
    expect(await hmacHex("k", "m")).not.toBe(await hmacHex("k2", "m"));
  });
  it("randomDigits gives n digits", () => {
    expect(randomDigits(6)).toMatch(/^\d{6}$/);
  });
  it("timingSafeEqualHex", () => {
    expect(timingSafeEqualHex("ab", "ab")).toBe(true);
    expect(timingSafeEqualHex("ab", "ac")).toBe(false);
    expect(timingSafeEqualHex("ab", "abc")).toBe(false);
  });
});

describe("codes and tokens", () => {
  it("a code verifies once and yields a prefixed token", async () => {
    let code = "";
    setMailHook((_to, c) => {
      code = c;
    });
    await startCode(authEnv, "Ada@Example.com");
    expect(code).toMatch(/^\d{6}$/);
    const r = await verifyCode(authEnv, "ada@example.com", code);
    expect(r?.token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(await verifyCode(authEnv, "ada@example.com", code)).toBeNull();
    const member = await authenticate(authEnv, r!.token);
    expect(member?.email).toBe("ada@example.com");
  });

  it("locks after five wrong codes", async () => {
    let code = "";
    setMailHook((_to, c) => {
      code = c;
    });
    await startCode(authEnv, "bob@example.com");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect(await verifyCode(authEnv, "bob@example.com", wrong)).toBeNull();
    expect(await verifyCode(authEnv, "bob@example.com", code)).toBeNull();
  });

  it("a revoked token no longer authenticates", async () => {
    const token = await signIn("cy@example.com");
    expect(await authenticate(authEnv, token)).not.toBeNull();
    await revokeToken(authEnv, token);
    expect(await authenticate(authEnv, token)).toBeNull();
  });
});

describe("routes", () => {
  const app = new Hono<{ Bindings: AuthEnv }>();
  app.route("{{kit.routePrefix}}", authRoutes);
  app.route("/", meRoutes);

  it("rejects a bad email", async () => {
    const res = await app.request("{{kit.routePrefix}}/email/start", { method: "POST", body: JSON.stringify({ email: "nope" }) }, authEnv);
    expect(res.status).toBe(400);
  });

  it("/api/me needs a bearer token", async () => {
    expect((await app.request("/api/me", {}, authEnv)).status).toBe(401);
    const token = await signIn("dee@example.com");
    const res = await app.request("/api/me", { headers: { authorization: `Bearer ${token}` } }, authEnv);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { email: string }).email).toBe("dee@example.com");
  });
});
