import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { getProfile, getPublicProfile, parseProfile, saveProfile } from "{{paths.lib|rel}}/member-profiles/profiles";
import { profileRoutes } from "{{paths.lib|rel}}/member-profiles/routes";
const input = (handle: string, revision = 0) => ({ handle, display_name: "Alice", bio: "Builds things", avatar_id: 1, is_public: false, revision });

describe("profile storage and validation", () => {
  it("normalizes handles and text, excludes identity fields, and defaults to private", async () => {
    const saved = await saveProfile(env, "owner_one", { ...input("  ALICE_ONE  "), display_name: " Alice " });
    expect(saved).toMatchObject({ ok: true, profile: { handle: "alice_one", display_name: "Alice", revision: 1, is_public: false } });
    expect(await getPublicProfile(env, "alice_one")).toBeNull();
    expect(JSON.stringify(await getProfile(env, "owner_one"))).not.toContain("owner_id");
    expect(await getProfile(env, "missing")).toBeNull();
  });
  it("rejects unknown keys, dangerous types, invalid handles, avatars and oversized text", () => {
    for (const value of [null, [], { ...input("valid"), owner_id: "other" }, { ...input("valid"), role: "admin" }, input("x"), input("../other"), { ...input("valid"), handle: 4 }, { ...input("valid"), display_name: "a".repeat(81) }, { ...input("valid"), bio: "a".repeat(501) }, { ...input("valid"), bio: "nul\u0000" }, { ...input("valid"), avatar_id: {{kit.avatarCount}} + 1 }, { ...input("valid"), revision: -1 }, { ...input("valid"), is_public: "true" }]) expect(parseProfile(value)).toBeNull();
    expect(parseProfile({ ...input("valid"), avatar_id: null })).not.toBeNull();
  });
  it("enforces handle uniqueness for both creation and updates in SQL", async () => {
    expect((await saveProfile(env, "owner_unique_a", input("unique_a"))).ok).toBe(true);
    expect(await saveProfile(env, "owner_unique_b", input("UNIQUE_A"))).toEqual({ ok: false, error: "conflict" });
    await saveProfile(env, "owner_unique_b", input("unique_b"));
    expect(await saveProfile(env, "owner_unique_b", input("unique_a", 1))).toEqual({ ok: false, error: "conflict" });
    expect((await getProfile(env, "owner_unique_b"))?.handle).toBe("unique_b");
  });
  it("only one concurrent writer can advance a revision and stale creation cannot overwrite", async () => {
    await saveProfile(env, "owner_cas", input("cas_handle"));
    const results = await Promise.all([saveProfile(env, "owner_cas", { ...input("cas_handle", 1), display_name: "First" }), saveProfile(env, "owner_cas", { ...input("cas_handle", 1), display_name: "Second" })]);
    expect(results.filter(x => x.ok)).toHaveLength(1);
    expect(results.filter(x => !x.ok)).toHaveLength(1);
    expect((await getProfile(env, "owner_cas"))?.revision).toBe(2);
    expect(await saveProfile(env, "owner_cas", input("cas_handle"))).toEqual({ ok: false, error: "conflict" });
    expect(await saveProfile(env, "owner_absent", input("absent", 9))).toEqual({ ok: false, error: "conflict" });
  });
  it("publishes only the allowlisted view and removes it immediately when hidden", async () => {
    await saveProfile(env, "owner_public", { ...input("public_name"), is_public: true });
    expect(await getPublicProfile(env, "public_name")).toEqual({ handle: "public_name", display_name: "Alice", bio: "Builds things", avatar_id: 1 });
    await saveProfile(env, "owner_public", input("public_name", 1));
    expect(await getPublicProfile(env, "public_name")).toBeNull();
  });
});

describe("mounted profile routes", () => {
  // Test identity adapter only; production must verify a session or token.
  const app = new Hono().route("{{kit.routePrefix}}", profileRoutes(request => request.headers.get("x-test-owner")));
  const call = (path: string, method = "GET", owner?: string, body?: unknown, headers: Record<string, string> = {}) => app.request(`https://app.example.test{{kit.routePrefix}}${path}`, { method, headers: { "content-type": "application/json", origin: "https://app.example.test", ...(owner ? { "x-test-owner": owner } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  it("requires sign-in, derives ownership from the adapter and protects mutations", async () => {
    expect((await call("/me")).status).toBe(401);
    expect(await (await call("/me", "GET", "owner_routes")).json()).toEqual({ profile: null, revision: 0 });
    expect((await call("/me", "PUT", "owner_routes", input("route_handle"), { origin: "https://evil.example.test" })).status).toBe(403);
    expect((await call("/me", "PUT", "owner_routes", input("route_handle"), { origin: "" })).status).toBe(403);
    expect((await call("/me", "PUT", "owner_routes", { ...input("route_handle"), owner_id: "victim" })).status).toBe(400);
    expect((await call("/me", "PUT", "owner_routes", input("route_handle"))).status).toBe(200);
    expect((await call("/me", "PUT", "owner_routes", input("route_handle"))).status).toBe(409);
    expect(await getProfile(env, "victim")).toBeNull();
    expect(await getProfile(env, "owner_other")).toBeNull();
    expect((await call("/public/route_handle")).status).toBe(404);
  });
  it("bounds JSON independently of Content-Length and protects response caching", async () => {
    const large = "x".repeat(8193);
    expect((await call("/me", "PUT", "owner_large", large)).status).toBe(413);
    expect((await call("/me", "PUT", "owner_large", input("small"), { "content-length": "9000" })).status).toBe(413);
    expect((await call("/me", "PUT", "owner_large", input("small"), { "content-type": "text/plain" })).status).toBe(415);
    const invalid = await app.request("https://app.example.test{{kit.routePrefix}}/me", { method: "PUT", headers: { origin: "https://app.example.test", "x-test-owner": "owner_large", "content-type": "application/json" }, body: "{" }, env);
    expect(invalid.status).toBe(400);
    expect((await call("/me", "GET", "owner_large")).headers.get("cache-control")).toContain("no-store");
  });
});
