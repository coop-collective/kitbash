import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { SignJWT, base64url, decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, it, vi } from "vitest";
import { cleanupJwtSessionRevocations, createJwtSession, destroyJwtSession, readJwtSession, revokeOwnerJwtSessions, setJwtSessionOwnerEnabled, JWT_SESSION_TTL_SECONDS, type JwtSessionEnv } from "{{paths.lib|rel}}/jwt-session-cookie/session";
import { jwtSessionRoutes } from "{{paths.lib|rel}}/jwt-session-cookie/routes";

const e: JwtSessionEnv = { DB: env.DB, JWT_SESSION_SECRET: "test-only-jwt-session-secret-never-deploy-this", JWT_SESSION_ORIGIN: "https://app.example.test" };
const now = () => Math.floor(Date.now() / 1000);
const req = (cookie?: string, url = e.JWT_SESSION_ORIGIN + "/") => new Request(url, { headers: cookie ? { cookie } : {} });
const post = (cookie: string, origin: string = e.JWT_SESSION_ORIGIN) => new Request(e.JWT_SESSION_ORIGIN + "/", { method: "POST", headers: { cookie, origin } });
const pair = (cookie: string) => cookie.split(";")[0]!;
const token = (cookie: string) => pair(cookie).split("=")[1]!;
const issue = async (id: string, at = now(), config = e) => (await createJwtSession(config, id, req(undefined, config.JWT_SESSION_ORIGIN + "/"), at)).setCookie;
const withToken = (value: string) => req(`__Host-{{kit.cookieName}}=${value}`);
async function fixtureKey(info = `kitbash/jwt-session-cookie/v1\n{{kit.cookieName}}\n${e.JWT_SESSION_ORIGIN}`) {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", encoder.encode(e.JWT_SESSION_SECRET), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: encoder.encode(info) }, material, 256));
}

describe("HKDF JWT browser sessions", () => {
  it("issues the exact JWT profile in a hardened host-only cookie without persisting the bearer", async () => {
    const at = now();
    const c = await issue("jwt_format", at);
    expect(c).toContain("__Host-{{kit.cookieName}}=");
    for (const flag of ["Path=/", "Secure", "HttpOnly", "SameSite=Lax", `Max-Age=${JWT_SESSION_TTL_SECONDS}`]) expect(c).toContain(flag);
    expect(c).not.toContain("Domain=");
    expect(decodeProtectedHeader(token(c))).toEqual({ alg: "HS256", typ: "kitbash-session+jwt" });
    expect(decodeJwt(token(c))).toMatchObject({ sub: "jwt_format", iss: e.JWT_SESSION_ORIGIN, aud: "kitbash:{{kit.cookieName}}:browser", iat: at, exp: at + JWT_SESSION_TTL_SECONDS });
    const row = await env.DB.prepare("SELECT * FROM {{kit.tablePrefix}}jwt_session_owners WHERE owner_id = ?").bind("jwt_format").first();
    expect(row).toMatchObject({ version: decodeJwt(token(c)).v, disabled: 0 });
    expect(JSON.stringify(row)).not.toContain(token(c));
    expect(await readJwtSession(e, req(pair(c)), at)).toMatchObject({ owner_id: "jwt_format", created_s: at, expires_s: at + JWT_SESSION_TTL_SECONDS });
  });

  it("separates session keys from the raw secret and other purposes; rotation invalidates tokens", async () => {
    const c = await issue("jwt_keys");
    const claims = decodeJwt(token(c));
    for (const key of [new TextEncoder().encode(e.JWT_SESSION_SECRET), await fixtureKey("mail-links-v1")]) {
      const forged = await new SignJWT(claims).setProtectedHeader({ alg: "HS256", typ: "kitbash-session+jwt" }).sign(key);
      expect(await readJwtSession(e, withToken(forged))).toBeNull();
    }
    expect(await readJwtSession({ ...e, JWT_SESSION_SECRET: "another-test-only-jwt-secret-not-for-production" }, req(pair(c)))).toBeNull();
    await expect(readJwtSession({ ...e, JWT_SESSION_SECRET: "short" }, req(pair(c)))).rejects.toThrow("JWT_SESSION_SECRET");
  });

  it("rejects signed tokens with the wrong type, algorithm, issuer, audience or claims", async () => {
    const claims = decodeJwt(token(await issue("jwt_claims")));
    const key = await fixtureKey();
    const signed = (payload: Record<string, unknown>, header = { alg: "HS256", typ: "kitbash-session+jwt" }) => new SignJWT(payload).setProtectedHeader(header).sign(key);
    for (const patch of [
      { iss: "https://other.example.test" }, { aud: "different-service" }, { aud: [claims.aud] },
      { sub: "other-owner" }, { v: crypto.randomUUID() }, { jti: "invalid" }, { roles: ["admin"] },
      { iat: now() + 10 }, { iat: now() + 0.5 }, { exp: Number(claims.iat) + JWT_SESSION_TTL_SECONDS + 1 },
    ]) expect(await readJwtSession(e, withToken(await signed({ ...claims, ...patch })))).toBeNull();
    for (const name of ["exp", "iat", "sub", "jti", "v", "iss", "aud"]) {
      const incomplete = { ...claims };
      delete incomplete[name];
      expect(await readJwtSession(e, withToken(await signed(incomplete)))).toBeNull();
    }
    expect(await readJwtSession(e, withToken(await signed(claims, { alg: "HS256", typ: "JWT" })))).toBeNull();
    const alternate = await new SignJWT(claims).setProtectedHeader({ alg: "HS384", typ: "kitbash-session+jwt" }).sign(new Uint8Array(64));
    expect(await readJwtSession(e, withToken(alternate))).toBeNull();
    const unsigned = `${base64url.encode(JSON.stringify({ alg: "none", typ: "kitbash-session+jwt" }))}.${base64url.encode(JSON.stringify(claims))}.`;
    expect(await readJwtSession(e, withToken(unsigned))).toBeNull();
  });

  it("rejects tampering, duplicate names, oversized and noncanonical cookies", async () => {
    const c = pair(await issue("jwt_malformed"));
    expect(await readJwtSession(e, req(`${c}; ${c}`))).toBeNull();
    expect(await readJwtSession(e, req(c.slice(0, -8)))).toBeNull();
    expect(await readJwtSession(e, req(c + "="))).toBeNull();
    expect(await readJwtSession(e, req(c + "; filler=" + "x".repeat(16384)))).toBeNull();
    expect(await readJwtSession(e, withToken("x".repeat(3801)))).toBeNull();
    const parts = token(c).split(".");
    const signature = parts[2]!;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const noncanonical = signature.slice(0, -1) + alphabet[alphabet.indexOf(signature.at(-1)!) + 1];
    expect(base64url.decode(noncanonical)).toEqual(base64url.decode(signature));
    parts[2] = noncanonical;
    expect(await readJwtSession(e, withToken(parts.join(".")))).toBeNull();
    parts[2] = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
    expect(await readJwtSession(e, withToken(parts.join(".")))).toBeNull();
    expect(await readJwtSession(e, req())).toBeNull();
  });

  it("expires exactly at its signed deadline without sliding renewal", async () => {
    const at = now();
    const c = pair(await issue("jwt_expiry", at));
    expect(await readJwtSession(e, req(c), at + JWT_SESSION_TTL_SECONDS - 1)).not.toBeNull();
    expect(await readJwtSession(e, req(c), at + JWT_SESSION_TTL_SECONDS)).toBeNull();
    expect(await readJwtSession(e, req(c), at - 1)).toBeNull();
  });

  it("logout revokes the current JWT while another browser remains valid", async () => {
    const a = pair(await issue("jwt_browser"));
    const b = pair(await issue("jwt_browser"));
    await expect(destroyJwtSession(e, req(a))).rejects.toThrow("POST");
    const cleared = await destroyJwtSession(e, post(a));
    for (const flag of ["__Host-{{kit.cookieName}}=;", "Max-Age=0", "Path=/", "Secure", "HttpOnly"]) expect(cleared).toContain(flag);
    expect(await readJwtSession(e, req(a))).toBeNull();
    expect(await readJwtSession(e, req(b))).not.toBeNull();
    await destroyJwtSession(e, post(a));
    expect(await readJwtSession(e, req(a))).toBeNull();
  });

  it("revoke-all rotates the version, including same-second sessions, without affecting other owners", async () => {
    const at = now();
    const a = pair(await issue("jwt_all", at));
    const b = pair(await issue("jwt_all", at));
    const other = pair(await issue("jwt_other", at));
    await revokeOwnerJwtSessions(e, "jwt_all");
    for (const c of [a, b]) expect(await readJwtSession(e, req(c), at)).toBeNull();
    expect(await readJwtSession(e, req(other), at)).not.toBeNull();
    const next = pair(await issue("jwt_all", at));
    expect(await readJwtSession(e, req(next), at)).not.toBeNull();
  });

  it("disable prevents both reads and new logins; re-enable does not resurrect prior tokens", async () => {
    const c = pair(await issue("jwt_disabled"));
    await setJwtSessionOwnerEnabled(e, "jwt_disabled", false);
    expect(await readJwtSession(e, req(c))).toBeNull();
    await expect(issue("jwt_disabled")).rejects.toThrow("disabled");
    await revokeOwnerJwtSessions(e, "jwt_disabled");
    await expect(issue("jwt_disabled")).rejects.toThrow("disabled");
    await setJwtSessionOwnerEnabled(e, "jwt_disabled", true);
    expect(await readJwtSession(e, req(c))).toBeNull();
    expect(await readJwtSession(e, req(pair(await issue("jwt_disabled"))))).not.toBeNull();
  });

  it("reads uncached primary state each time and surfaces database failure", async () => {
    const c = pair(await issue("jwt_authority"));
    const spy = vi.spyOn(env.DB, "withSession");
    try {
      expect(await readJwtSession(e, req(c))).not.toBeNull();
      expect(await readJwtSession(e, req(c))).not.toBeNull();
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith("first-primary");
      spy.mockImplementationOnce(() => { throw new Error("D1 unavailable"); });
      await expect(readJwtSession(e, req(c))).rejects.toThrow("D1 unavailable");
    } finally { spy.mockRestore(); }
    await env.DB.prepare("DELETE FROM {{kit.tablePrefix}}jwt_session_owners WHERE owner_id = ?").bind("jwt_authority").run();
    expect(await readJwtSession(e, req(c))).toBeNull();
  });

  it("cleanup retains live revocations and removes only expired entries", async () => {
    const at = now();
    const c = pair(await issue("jwt_cleanup", at));
    const id = decodeJwt(token(c)).jti!;
    await destroyJwtSession(e, post(c), at);
    await cleanupJwtSessionRevocations(e, at + JWT_SESSION_TTL_SECONDS - 1);
    expect(await readJwtSession(e, req(c), at + JWT_SESSION_TTL_SECONDS - 1)).toBeNull();
    expect(await env.DB.prepare("SELECT jti FROM {{kit.tablePrefix}}jwt_session_revocations WHERE jti = ?").bind(id).first()).not.toBeNull();
    await cleanupJwtSessionRevocations(e, at + JWT_SESSION_TTL_SECONDS);
    expect(await env.DB.prepare("SELECT jti FROM {{kit.tablePrefix}}jwt_session_revocations WHERE jti = ?").bind(id).first()).toBeNull();
    expect(await readJwtSession(e, req(c), at + JWT_SESSION_TTL_SECONDS)).toBeNull();
  });

  it("binds sessions to a configured origin and separates loopback development cookies", async () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      const local = { ...e, JWT_SESSION_ORIGIN: `http://${host}:8787` };
      const c = await issue(`jwt_local_${host}`, now(), local);
      expect(c).toContain("dev_{{kit.cookieName}}=");
      expect(c).not.toContain("Secure");
      expect(await readJwtSession(local, req(pair(c), local.JWT_SESSION_ORIGIN))).not.toBeNull();
      expect(await readJwtSession(e, req(pair(c)))).toBeNull();
    }
    await expect(issue("bad_origin", now(), { ...e, JWT_SESSION_ORIGIN: "http://app.example.test" })).rejects.toThrow("HTTPS");
    await expect(issue("bad_path", now(), { ...e, JWT_SESSION_ORIGIN: e.JWT_SESSION_ORIGIN + "/path" })).rejects.toThrow("canonical");
    await expect(createJwtSession(e, "jwt_wrong_host", req(undefined, "https://other.example.test"))).rejects.toThrow("Origin");
    await expect(createJwtSession(e, "jwt_login_csrf", new Request(e.JWT_SESSION_ORIGIN, { method: "POST" }))).rejects.toThrow("Origin");
    expect(await env.DB.prepare("SELECT owner_id FROM {{kit.tablePrefix}}jwt_session_owners WHERE owner_id = ?").bind("jwt_login_csrf").first()).toBeNull();
  });
});

describe("JWT session routes", () => {
  const app = new Hono().route("{{kit.routePrefix}}", jwtSessionRoutes());
  const call = (suffix: string, cookie?: string, origin?: string) => app.request(`${e.JWT_SESSION_ORIGIN}{{kit.routePrefix}}${suffix}`, { method: suffix ? "POST" : "GET", headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) } }, e);
  it("protects reads and rejects absent, null and foreign mutation origins before logout", async () => {
    expect((await call("")).status).toBe(401);
    const c = pair(await issue("jwt_route"));
    const read = await call("", c);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ owner_id: "jwt_route" });
    expect(read.headers.get("cache-control")).toBe("private, no-store");
    for (const origin of [undefined, "null", "https://other.example.test"]) {
      expect((await call("/logout", c, origin)).status).toBe(403);
      expect((await call("/logout-all", c, origin)).status).toBe(403);
    }
    expect((await call("", c)).status).toBe(200);
    const logout = await call("/logout", c, e.JWT_SESSION_ORIGIN);
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await call("", c)).status).toBe(401);
  });
  it("logout-all immediately rejects both existing browser JWTs", async () => {
    const a = pair(await issue("jwt_route_all"));
    const b = pair(await issue("jwt_route_all"));
    expect((await call("/logout-all", a, e.JWT_SESSION_ORIGIN)).status).toBe(204);
    expect((await call("", a)).status).toBe(401);
    expect((await call("", b)).status).toBe(401);
  });
});
