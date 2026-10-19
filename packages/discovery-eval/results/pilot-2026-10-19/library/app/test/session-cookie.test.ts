import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { cleanupSessions, createSession, destroySession, readSession, revokeOwnerSessions, SESSION_TTL_SECONDS, type SessionEnv } from "../src/lib/session-cookie/session";
import { sessionRoutes } from "../src/lib/session-cookie/routes";
const e: SessionEnv = { DB: env.DB, SESSION_SECRET: "test-only-session-signing-key-not-for-production" };
const req = (cookie?: string, url = "https://app.example.test/") => new Request(url, { headers: cookie ? { cookie } : {} });
const issue = async (owner: string, now = Date.now(), url = "https://app.example.test/") => (await createSession(e, owner, req(undefined, url), now)).setCookie;
const pair = (cookie: string) => cookie.split(";")[0]!;

describe("browser session lifecycle", () => {
  it("sets host-only HTTPS cookies and stores neither the raw id nor signature", async () => {
    const c = await issue("owner_format");
    expect(c).toContain("__Host-session=");
    for (const flag of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) expect(c).toContain(flag);
    expect(c).not.toContain("Domain=");
    const rawId = pair(c).split("=")[1]!.split(".")[0]!;
    const row = await env.DB.prepare("SELECT * FROM browser_sessions WHERE owner_id = ?").bind("owner_format").first();
    expect(JSON.stringify(row)).not.toContain(rawId);
    expect(await readSession(e, req(pair(c)))).toMatchObject({ owner_id: "owner_format" });
  });
  it("rejects forged, truncated, duplicate and unknown cookies", async () => {
    const c = pair(await issue("owner_forge"));
    expect(await readSession(e, req(c.replace(/=(.)/, (_, ch: string) => "=" + (ch === "Z" ? "Y" : "Z"))))).toBeNull();
    expect(await readSession(e, req(c.slice(0, -8)))).toBeNull();
    expect(await readSession(e, req(`${c}; ${c}`))).toBeNull();
    expect(await readSession(e, req())).toBeNull();
    await env.DB.prepare("DELETE FROM browser_sessions WHERE owner_id = ?").bind("owner_forge").run();
    expect(await readSession(e, req(c))).toBeNull();
  });
  it("expires exactly at the deadline and cleans rows without deleting live sessions", async () => {
    const now = Date.now();
    const c = pair(await issue("owner_expiry", now));
    expect(await readSession(e, req(c), now + SESSION_TTL_SECONDS * 1000 - 1)).not.toBeNull();
    expect(await readSession(e, req(c), now + SESSION_TTL_SECONDS * 1000)).toBeNull();
    const later = pair(await issue("owner_later", now + SESSION_TTL_SECONDS * 1000));
    await cleanupSessions(e, now + SESSION_TTL_SECONDS * 1000);
    expect(await readSession(e, req(c), now)).toBeNull();
    expect(await readSession(e, req(later), now + SESSION_TTL_SECONDS * 1000)).not.toBeNull();
  });
  it("revokes the current session and all owner sessions without affecting another owner", async () => {
    const a = pair(await issue("owner_a"));
    const a2 = pair(await issue("owner_a"));
    const b = pair(await issue("owner_b"));
    expect(await destroySession(e, req(a))).toContain("Max-Age=0");
    expect(await readSession(e, req(a))).toBeNull();
    expect(await readSession(e, req(a2))).not.toBeNull();
    expect(await revokeOwnerSessions(e, "owner_a")).toBe(1);
    expect(await readSession(e, req(a2))).toBeNull();
    expect(await readSession(e, req(b))).not.toBeNull();
  });
  it("allows distinct development cookies only on loopback HTTP", async () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      const url = `http://${host}:8787/`;
      const c = await issue(`owner_${host}`, Date.now(), url);
      expect(c).toContain("dev_session=");
      expect(c).not.toContain("Secure");
      expect(await readSession(e, req(pair(c), url))).not.toBeNull();
      expect(await readSession(e, req(pair(c)))).toBeNull();
    }
    await expect(issue("owner_http", Date.now(), "http://app.example.test/")).rejects.toThrow("HTTPS");
    await expect(createSession({ ...e, SESSION_SECRET: "short" }, "owner", req())).rejects.toThrow("SESSION_SECRET");
  });
  it("rotation invalidates old signatures", async () => {
    const c = pair(await issue("owner_rotate"));
    expect(await readSession({ ...e, SESSION_SECRET: "different-test-key-not-for-production-use" }, req(c))).toBeNull();
  });
});

describe("mounted session routes", () => {
  const app = new Hono().route("/api/session-block", sessionRoutes());
  const call = (suffix: string, cookie?: string, origin?: string) => app.request(`https://app.example.test/api/session-block${suffix}`, { method: suffix ? "POST" : "GET", headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) } }, e);
  it("protects reads, blocks absent/foreign/null origins and revokes on logout", async () => {
    expect((await call("")).status).toBe(401);
    const c = pair(await issue("owner_routes"));
    const read = await call("", c);
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toContain("no-store");
    for (const origin of [undefined, "null", "https://other.example.test"]) expect((await call("/logout", c, origin)).status).toBe(403);
    expect((await call("/logout", c, "https://app.example.test")).status).toBe(204);
    expect((await call("", c)).status).toBe(401);
  });
  it("logout-all revokes both browser sessions", async () => {
    const a = pair(await issue("owner_all"));
    const b = pair(await issue("owner_all"));
    expect((await call("/logout-all", a, "https://app.example.test")).status).toBe(204);
    expect((await call("", b)).status).toBe(401);
  });
});
