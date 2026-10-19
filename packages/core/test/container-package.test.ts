import { describe, expect, it } from "vitest";
import { containerPackageProblem } from "../src/container-package.ts";
import { forbiddenTarget } from "../src/paths.ts";
import { base64Encode, sha256Hex, toBytes } from "../src/hash.ts";
import { memoryFs } from "../src/fs.ts";
import { applyPlan, planInstall } from "../src/plan.ts";
import { applyUpgrade, planUpgrade } from "../src/upgrade.ts";
import { scanBlock } from "../src/scan.ts";
import { cloneBundle, FIXTURE_ID, loadFixtureBlock, loadProject, NOW } from "./helpers.ts";

const target = "containers/hash-service/package.json";
const manifest = { name: "@kitbash/container-rust", private: true, scripts: { test: "cargo test --locked", deps: "cargo fetch --locked" } };

async function fixture(value = manifest) {
  const bundle = cloneBundle(await loadFixtureBlock());
  bundle.manifest.files.push({ path: "container/package.json", target, role: "service", type: "registry:file", template: false });
  bundle.files["container/package.json"] = JSON.stringify(value);
  const project = loadProject();
  return { bundle, ...project };
}

describe("container subproject manifests", () => {
  it.each([".pnpmfile.mjs", ".pnpmfile.cjs", "pnpmfile.cjs", ".npmrc", ".yarnrc.yml", "pnpm-workspace.yaml", "pnpm-workspace.yml"])("rejects nested auto-loaded %s at every writing boundary", async name => {
    const nested = `containers/hash-service/${name}`;
    expect(forbiddenTarget(nested, "demo")).toMatch(/package manager/);
    expect(forbiddenTarget(`.kit/blocks/demo/${name}`, "demo")).toMatch(/package manager/);
    const { bundle, profile, tree, fs } = await fixture();
    const blocked = cloneBundle(bundle);
    blocked.manifest.files.push({ path: `container/${name}`, target: nested, type: "registry:file", role: "service" });
    blocked.files[`container/${name}`] = "// harmless test marker\n";
    expect((await scanBlock(blocked)).findings.some(f => f.rule === "forbidden_target")).toBe(true);
    await expect(planInstall({ bundle: blocked, profile, project: tree })).rejects.toMatchObject({ code: "forbidden" });
    const plan = await planInstall({ bundle, profile, project: tree, blockId: FIXTURE_ID });
    const content = "// harmless test marker\n";
    const file = { path: nested, action: "create" as const, role: "service", block_path: `container/${name}`, before_sha256: null, after_sha256: await sha256Hex(content), content_b64: base64Encode(toBytes(content)), tracked: true };
    const tampered = structuredClone(plan);
    tampered.kit.files.push(file);
    const before = structuredClone(fs.tree);
    await expect(applyPlan(fs, tampered)).rejects.toMatchObject({ code: "forbidden" });
    expect(fs.tree).toEqual(before);
    const installed = await applyPlan(fs, plan);
    const next = cloneBundle(bundle);
    next.manifest.version = "1.4.0";
    const upgrade = await planUpgrade({ oldBundle: bundle, newBundle: next, entry: installed.lock_entry, blockId: FIXTURE_ID, profile, current: fs.tree });
    upgrade.files.push(file);
    const afterInstall = structuredClone(fs.tree);
    await expect(applyUpgrade(fs, upgrade)).rejects.toMatchObject({ code: "forbidden" });
    expect(fs.tree).toEqual(afterInstall);
  });

  it("installs a private payload while leaving host scripts unchanged; respects file conflicts", async () => {
    const { bundle, profile, tree, fs } = await fixture();
    const plan = await planInstall({ bundle, profile, project: tree, blockId: FIXTURE_ID, now: NOW });
    const result = await applyPlan(fs, plan);
    expect(JSON.parse(new TextDecoder().decode(await fs.readFile(target) ?? undefined))).toEqual(manifest);
    expect(JSON.parse(new TextDecoder().decode(await fs.readFile("package.json") ?? undefined)).scripts).toEqual(JSON.parse(String(tree["package.json"])).scripts);
    const again = await planInstall({ bundle, profile, project: { ...fs.tree, [target]: JSON.stringify({ ...manifest, version: "2.0.0" }) }, blockId: FIXTURE_ID });
    expect(again.conflicts.some(c => c.name === target)).toBe(true);
    expect(result.lock_entry.files.some(f => f.target === target)).toBe(true);
  });

  it.each(["package.json", "src/package.json", "containers/package.json", "containers/hash-service/nested/package.json", "containers/hash-service/pnpm-lock.yaml", "containers/Hash/package.json"])("keeps %s forbidden", path => {
    expect(forbiddenTarget(path, "demo")).toMatch(/package manifest/);
  });

  it.each([
    { ...manifest, private: false },
    { ...manifest, scripts: { preinstall: "node hook.mjs" } },
    { ...manifest, scripts: { posttest: "node hook.mjs" } },
    { ...manifest, pnpm: { hooks: {} } },
    { ...manifest, workspaces: ["../../packages/*"] },
    { ...manifest, dependencies: { payload: "file:../../payload" } },
    { ...manifest, devEngines: { runtime: { name: "bun", version: "latest", onFail: "download" } } },
  ])("rejects implicit execution/configuration at scan, plan and apply", async value => {
    expect(containerPackageProblem(target, JSON.stringify(value))).not.toBeNull();
    const invalid = await fixture(value as typeof manifest);
    expect((await scanBlock(invalid.bundle)).findings.some(f => f.rule === "container_package" && f.severity === "block")).toBe(true);
    await expect(planInstall({ bundle: invalid.bundle, profile: invalid.profile, project: invalid.tree })).rejects.toMatchObject({ code: "forbidden" });
    const good = await fixture();
    const plan = await planInstall({ bundle: good.bundle, profile: good.profile, project: good.tree, blockId: FIXTURE_ID });
    const file = plan.kit.files.find(f => f.path === target)!;
    const content = JSON.stringify(value);
    file.content_b64 = base64Encode(toBytes(content));
    file.after_sha256 = await sha256Hex(content);
    const before = structuredClone(good.fs.tree);
    await expect(applyPlan(good.fs, plan)).rejects.toMatchObject({ code: "forbidden" });
    expect(good.fs.tree).toEqual(before);
  });

  it("rechecks an upgrade's merged or tampered payload before any write", async () => {
    const { bundle, profile, tree, fs } = await fixture();
    const installed = await applyPlan(fs, await planInstall({ bundle, profile, project: tree, blockId: FIXTURE_ID }));
    const next = cloneBundle(bundle);
    next.manifest.version = "1.4.0";
    next.files["container/package.json"] = JSON.stringify({ ...manifest, version: "1.0.1" });
    const upgrade = await planUpgrade({ oldBundle: bundle, newBundle: next, entry: installed.lock_entry, blockId: FIXTURE_ID, profile, current: fs.tree });
    const file = upgrade.files.find(f => f.path === target)!;
    const content = JSON.stringify({ ...manifest, scripts: { prepare: "node hook.mjs" } });
    file.content_b64 = base64Encode(toBytes(content));
    file.after_sha256 = await sha256Hex(content);
    const copy = memoryFs({ ...fs.tree });
    await expect(applyUpgrade(copy, upgrade)).rejects.toMatchObject({ code: "forbidden" });
    expect(copy.tree).toEqual(fs.tree);
  });
});
