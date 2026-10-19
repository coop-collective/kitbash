import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("health", () => {
  it("answers ok with the migrated schema", async () => {
    const res = await exports.default.fetch("http://example.com/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, schema: "init" });
  });

  it("has migrations applied to the test database", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").all();
    expect(results).toHaveLength(1);
  });

  it("returns a JSON 404", async () => {
    const res = await exports.default.fetch("http://example.com/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
