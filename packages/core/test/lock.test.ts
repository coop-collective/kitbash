import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { memoryFs } from "../src/fs.ts";
import {
  diffAgainstLock,
  emptyLock,
  parseLock,
  pendingRequiredAdapt,
  readLock,
  recordVerify,
  serializeLock,
  setAdaptStatus,
  threeWayMerge,
  upsertLockEntry,
  writeLock,
  LOCK_PATH,
} from "../src/lock.ts";
import { applyPlan, planInstall, readProjectForPlan, renderInstalled } from "../src/plan.ts";
import { applyUpgrade, planUpgrade } from "../src/upgrade.ts";
import { cloneBundle, FIXTURE_ID, fixtures, loadFixtureBlock, loadProject, NOW, text } from "./helpers.ts";

const read = (c: string, f: string) => readFileSync(path.join(fixtures, "merge", c, f), "utf8");

describe("threeWayMerge (Copier-style)", () => {
  it.each(["clean", "overlapping", "conflicting"])("%s fixture", (c) => {
    const r = threeWayMerge(read(c, "base.txt"), read(c, "ours.txt"), read(c, "theirs.txt"));
    expect(r.content).toBe(read(c, "expected.txt"));
    expect(r.clean).toBe(c !== "conflicting");
    expect(r.conflicts).toBe(c === "conflicting" ? 1 : 0);
  });

  it("trivial sides: untouched ours takes theirs; untouched theirs keeps ours; same change on both sides is clean", () => {
    expect(threeWayMerge("a\n", "a\n", "b\n").content).toBe("b\n");
    expect(threeWayMerge("a\n", "b\n", "a\n").content).toBe("b\n");
    expect(threeWayMerge("a\n", "c\n", "c\n")).toEqual({ content: "c\n", clean: true, conflicts: 0 });
  });

  it("labels the markers and handles a missing trailing newline", () => {
    const r = threeWayMerge("x", "y", "z", { ours: "ours (project)", base: "base (1.3.0)", theirs: "theirs (1.4.0)" });
    expect(r.content).toBe("<<<<<<< ours (project)\ny\n||||||| base (1.3.0)\nx\n=======\nz\n>>>>>>> theirs (1.4.0)\n");
  });
});

describe("lock file", () => {
  const entry = {
    version: "1.3.0", variant: "hono-d1", manifest_sha256: "a".repeat(64), registry_signature: "ed25519:x", installed_at: NOW,
    params: { tokenPrefix: "mc_" }, files: [{ target: "src/x.ts", rendered_sha256: "b".repeat(64), block_path: "src/x.ts" }],
    adapt: { "wire-middleware": "pending" as const, "mail-domain": "pending" as const },
  };

  it("round-trips with sorted keys and a trailing newline; rejects malformed locks", async () => {
    const fs = memoryFs();
    expect(await readLock(fs)).toEqual(emptyLock());
    const lock = upsertLockEntry(emptyLock(), "@coop/x", entry);
    await writeLock(fs, lock);
    expect(text(fs.tree[LOCK_PATH])!.endsWith("}\n")).toBe(true);
    expect(await readLock(fs)).toEqual(lock);
    expect(serializeLock(parseLock(serializeLock(lock)))).toBe(serializeLock(lock));
    expect(() => parseLock("{")).toThrow();
    expect(() => parseLock(JSON.stringify({ version: 2, blocks: {} }))).toThrow();
    expect(() => parseLock(JSON.stringify({ version: 1, blocks: { "not-an-id": entry } }))).toThrow();
  });

  it("adapt status, verify records and pending required items", () => {
    let lock = upsertLockEntry(emptyLock(), "@coop/x", entry);
    lock = setAdaptStatus(lock, "@coop/x", "wire-middleware", "done");
    lock = recordVerify(lock, "@coop/x", true, NOW);
    expect(lock.blocks["@coop/x"]!.verify).toEqual({ last_run: NOW, passed: true });
    expect(pendingRequiredAdapt(lock.blocks["@coop/x"]!, ["wire-middleware"])).toEqual([]);
    expect(() => setAdaptStatus(lock, "@coop/x", "nope", "done")).toThrow();
    expect(() => setAdaptStatus(lock, "@coop/y", "x", "done")).toThrow();
  });
});

async function installFixture() {
  const bundle = await loadFixtureBlock();
  const { fs, profile } = loadProject();
  const project = await readProjectForPlan(fs, { bundle, profile, blockId: FIXTURE_ID });
  const plan = await planInstall({ bundle, profile, project, blockId: FIXTURE_ID, params: { tokenPrefix: "mc_" } });
  await applyPlan(fs, plan, { now: NOW });
  return { bundle, fs, profile, entry: (await readLock(fs)).blocks[FIXTURE_ID]! };
}

describe("diffAgainstLock", () => {
  it("reports modified (with a hunk), deleted and unchanged files against the rendered install", async () => {
    const { bundle, fs, profile, entry } = await installFixture();
    fs.tree["src/lib/auth/codes.ts"] = text(fs.tree["src/lib/auth/codes.ts"])!.replace("const MAX_ATTEMPTS = 5;", "const MAX_ATTEMPTS = 3;");
    delete fs.tree["src/lib/auth/mail.ts"];
    const rendered = renderInstalled(bundle, entry, profile, FIXTURE_ID);
    expect(Object.keys(rendered)).toContain("migrations/0005_auth.sql");
    const d = await diffAgainstLock(entry, fs.tree, rendered);
    const byPath = Object.fromEntries(d.map((x) => [x.path, x]));
    expect(byPath["src/lib/auth/codes.ts"]!.status).toBe("modified");
    expect(byPath["src/lib/auth/codes.ts"]!.diff).toContain("-const MAX_ATTEMPTS = 5;\n+const MAX_ATTEMPTS = 3;");
    expect(byPath["src/lib/auth/mail.ts"]!.status).toBe("deleted");
    expect(byPath["src/lib/auth/crypto.ts"]!.status).toBe("unchanged");
  });
});

/** A v1.4.0 of the fixture: crypto.ts gains a function, codes.ts changes MAX_ATTEMPTS, a new migration and adapt item. */
async function fixtureV14() {
  const b = cloneBundle(await loadFixtureBlock());
  b.manifest.version = "1.4.0";
  b.files["variants/hono-d1/src/auth/crypto.ts"] = text(b.files["variants/hono-d1/src/auth/crypto.ts"]) + "\nexport function randomId(): string {\n  return crypto.randomUUID();\n}\n";
  b.files["variants/hono-d1/src/auth/codes.ts"] = text(b.files["variants/hono-d1/src/auth/codes.ts"])!.replace("const MAX_ATTEMPTS = 5;", "const MAX_ATTEMPTS = 4;");
  b.files["variants/hono-d1/migrations/0002_sessions.sql"] = "CREATE TABLE {{kit.tablePrefix}}sessions (id TEXT PRIMARY KEY);\n";
  b.manifest.files.push({ path: "migrations/0002_sessions.sql", type: "registry:file", target: "{{paths.migrations}}/0002_sessions.sql", role: "migration", variant: "hono-d1" });
  b.manifest.migrations.push({ file: "migrations/0002_sessions.sql", name: "sessions", creates: ["{{kit.tablePrefix}}sessions"] });
  b.manifest.tables.push("{{kit.tablePrefix}}sessions");
  b.manifest.agent.adapt.push({ id: "session-cleanup", required: false, title: "Schedule session cleanup" });
  b.files["CHANGELOG.md"] = "## 1.4.0\n\n- Sessions table; 4 attempts.\n\n## Upgrade\n\nApply the new migration.\n\n## 1.3.0\n\n- Resend cooldown.\n";
  return b;
}

describe("planUpgrade / applyUpgrade (3-way re-apply)", () => {
  it("refreshes rendered interface metadata so subsequent installs detect new bindings", async () => {
    const { bundle, fs, profile, entry } = await installFixture();
    const next = await fixtureV14();
    next.manifest.params.push({ name: "cacheBinding", type: "identifier", default: "EXTRA_CACHE" });
    next.manifest.bindings.push({ type: "kv", name: "{{kit.cacheBinding}}" });
    next.manifest.routes.push({ method: "GET", path: "/{{kit.cacheBinding}}", auth: "public" });
    const upgrade = await planUpgrade({ oldBundle: bundle, newBundle: next, entry, blockId: FIXTURE_ID, profile, current: fs.tree });
    await applyUpgrade(fs, upgrade);
    const lock = await readLock(fs);
    expect(lock.blocks[FIXTURE_ID]!.interface).toMatchObject({
      tables: expect.arrayContaining(["sessions"]),
      bindings: expect.arrayContaining(["kv:EXTRA_CACHE"]),
      routes: expect.arrayContaining(["GET /EXTRA_CACHE"]),
    });
    const collision = cloneBundle(bundle);
    collision.manifest.name = "other-feature";
    for (const file of collision.manifest.files) if (file.target) file.target = file.target.replace(".kit/blocks/email-code-auth-fixture/", ".kit/blocks/other-feature/");
    collision.manifest.bindings.push({ type: "r2", name: "EXTRA_CACHE" });
    const plan = await planInstall({ bundle: collision, blockId: "@coop/other-feature", profile, project: fs.tree, lock });
    expect(plan.conflicts).toContainEqual(expect.objectContaining({ kind: "binding", name: "EXTRA_CACHE" }));
  });

  it("untouched files merge clean, edited files conflict, new migrations renumber after the project's highest", async () => {
    const { bundle, fs, profile, entry } = await installFixture();
    // the project edits codes.ts on the same line upstream changes, and tokens.ts elsewhere
    fs.tree["src/lib/auth/codes.ts"] = text(fs.tree["src/lib/auth/codes.ts"])!.replace("const MAX_ATTEMPTS = 5;", "const MAX_ATTEMPTS = 10;");
    fs.tree["src/lib/auth/tokens.ts"] = "// project note\n" + text(fs.tree["src/lib/auth/tokens.ts"]);
    fs.tree["migrations/0006_project.sql"] = "CREATE TABLE things (id TEXT);\n";
    const v14 = await fixtureV14();
    const up = await planUpgrade({ oldBundle: bundle, newBundle: v14, entry, blockId: FIXTURE_ID, profile, current: fs.tree, now: NOW });
    expect(up.from).toBe("1.3.0");
    expect(up.to).toBe("1.4.0");
    expect(up.clean).toEqual(expect.arrayContaining(["src/lib/auth/crypto.ts", "src/lib/auth/tokens.ts"]));
    expect(up.conflicted.map((c) => c.path)).toEqual(["src/lib/auth/codes.ts"]);
    expect(up.migrations).toEqual({ "0002_sessions.sql": "0007_sessions.sql" });
    expect(up.added).toContain("migrations/0007_sessions.sql");
    expect(up.new_adapt).toEqual([{ id: "session-cleanup", required: false, status: "pending" }]);
    expect(up.changelog_upgrade_section).toBe("Apply the new migration.");
    expect(up.next_entry.params.tokenPrefix).toBe("mc_");

    const res = await applyUpgrade(fs, up, { now: NOW });
    expect(res.changed_files).toContain(LOCK_PATH);
    expect(text(fs.tree["src/lib/auth/crypto.ts"])).toContain("export function randomId");
    expect(text(fs.tree["src/lib/auth/tokens.ts"])).toMatch(/^\/\/ project note\n/);
    expect(text(fs.tree["src/lib/auth/tokens.ts"])).toContain('"mc_"');
    expect(text(fs.tree["src/lib/auth/codes.ts"])).toContain("<<<<<<< ours (project)\nconst MAX_ATTEMPTS = 10;\n||||||| base (1.3.0)\nconst MAX_ATTEMPTS = 5;\n=======\nconst MAX_ATTEMPTS = 4;\n>>>>>>> theirs (1.4.0)");
    expect(text(fs.tree["migrations/0007_sessions.sql"])).toBe("CREATE TABLE sessions (id TEXT PRIMARY KEY);\n");
    const lock = await readLock(fs);
    expect(lock.blocks[FIXTURE_ID]!.version).toBe("1.4.0");
    expect(lock.blocks[FIXTURE_ID]!.migrations).toEqual({ "0001_auth.sql": "0005_auth.sql", "0002_sessions.sql": "0007_sessions.sql" });
    expect(lock.blocks[FIXTURE_ID]!.adapt["session-cleanup"]).toBe("pending");
  });

  it("refuses an upgrade to the installed version and a stale upgrade plan", async () => {
    const { bundle, fs, profile, entry } = await installFixture();
    await expect(planUpgrade({ oldBundle: bundle, newBundle: bundle, entry, blockId: FIXTURE_ID, profile, current: fs.tree })).rejects.toThrow(/already at/);
    const up = await planUpgrade({ oldBundle: bundle, newBundle: await fixtureV14(), entry, blockId: FIXTURE_ID, profile, current: fs.tree, now: NOW });
    fs.tree["src/lib/auth/crypto.ts"] += "// edited after planning\n";
    await expect(applyUpgrade(fs, up)).rejects.toMatchObject({ code: "plan_stale" });
  });
});
