// Self-check of the harness: if these fail, every other test in the project is running against the wrong database.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("vitest-workerd harness", () => {
  it("runs inside workerd with the D1 binding from wrangler.jsonc", async () => {
    expect(await env.DB.prepare("SELECT 1 AS one").first<{ one: number }>()).toEqual({ one: 1 });
  });

  it("applied every migration in ./migrations before the test file started", async () => {
    const migrations = (env as unknown as { TEST_MIGRATIONS: { name: string }[] }).TEST_MIGRATIONS;
    expect(migrations.length).toBeGreaterThan(0);
    const { results } = await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(migrations.map((m) => m.name));
  });
});
