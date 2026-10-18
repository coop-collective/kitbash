import { describe, expect, it } from "vitest";
import { call, E, member } from "./helpers";

describe("auth", () => {
  it("/health answers without a token", async () => {
    const r = await call("/health");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, service: "kit-api" });
  });

  it("refuses /api without a token: 401 with the envelope and WWW-Authenticate", async () => {
    const r = await call("/api/me");
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("unauthorized");
    expect(r.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("refuses a malformed, an unknown and a revoked token", async () => {
    expect((await call("/api/me", { token: "hq_nope" })).status).toBe(401);
    expect((await call("/api/me", { token: `kit_${"A".repeat(43)}` })).status).toBe(401);
    const a = await member();
    expect((await call("/api/me", { token: a.token })).status).toBe(200);
    await E.DB.prepare("UPDATE member_tokens SET revoked_at = '2026-10-18T00:00:00Z' WHERE member_id = ?").bind(a.id).run();
    expect((await call("/api/me", { token: a.token })).status).toBe(401);
  });

  it("stores only the HMAC of a token", async () => {
    const a = await member();
    const row = await E.DB.prepare("SELECT token_hash FROM member_tokens WHERE member_id = ?").bind(a.id).first<{ token_hash: string }>();
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.token_hash).not.toContain(a.token.slice(4));
  });

  it("/api/me is the registry_whoami shape", async () => {
    const a = await member("whoami-org");
    const r = await call("/api/me", { token: a.token });
    expect(r.json).toEqual({ member: a.id, orgs: ["@whoami-org"], scope_default: "@whoami-org", plan: "free" });
  });

  it("serves the registry's public key for pinning", async () => {
    const a = await member();
    const r = await call("/api/registry/key", { token: a.token });
    expect(r.status).toBe(200);
    expect(r.json.public_key).toMatch(/^ed25519:[A-Za-z0-9_-]{43}$/);
    expect(r.json.key_id).toMatch(/^k_[0-9a-f]{16}$/);
  });

  it("refuses /mcp without a token", async () => {
    const r = await call("/mcp", { body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(r.status).toBe(401);
  });

  it("answers unknown routes with a JSON 404 envelope", async () => {
    const a = await member();
    const r = await call("/api/nope", { token: a.token });
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe("not_found");
  });
});

describe("worker entry", () => {
  it("exports only the default handler (workerd refuses other named exports from the main module)", async () => {
    const mod = await import("../src/index");
    expect(Object.keys(mod)).toEqual(["default"]);
  });
});
