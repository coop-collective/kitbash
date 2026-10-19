/**
 * Kitbash e2e: install real block directories into a copy of test-e2e/fixtures/hono-d1 with the kit CLI (local path, no server),
 * apply, run each block's verify.commands through `kit verify`, and assert they pass.
 *
 *   node --test test-e2e/install.test.mjs            (from the repo root; also: node test-e2e/install.test.mjs)
 *   KIT_E2E_ONLY=crypto-utils,email-code-auth node --test test-e2e/install.test.mjs     (filter by block / chain name)
 *   KIT_E2E_ONLINE=0 forbids the online fallback for the dependency install.
 *
 * Cases come from blocks/* (defaults) plus test-e2e/cases.json (param sets, chains). See test-e2e/README.md.
 */
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { templateCacheIdentity, templateSourceFilter } from "./template-cache.mjs";
import { installStandalone } from "./pnpm-install.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const TEMPLATE = path.join(repo, "test-e2e", "fixtures", "hono-d1");
const KIT = path.join(repo, "packages", "cli", "src", "kit.ts");
// top level only: node_modules has dist dirs of its own
const SKIP_COPY = /^(\.wrangler|dist|\.kit\/plans)(\/|$)/;

const exists = (p) => stat(p).then(() => true, () => false);
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

/** Run a command to completion; never throws, returns { code, out, err }. */
function sh(cmd, args, { cwd, env = {}, timeout = 600_000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1", ...env } }, (e, stdout, stderr) => {
      resolve({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, out: String(stdout), err: String(stderr) + (e && typeof e.code !== "number" ? `\n${e.message}` : "") });
    });
  });
}

const tmpDirs = [];
const tmp = async (prefix) => {
  const d = await mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
};
after(() => Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true }))));

/* ---------------------------------------------------------------- environment checks */

async function toolingProblem() {
  if (!(await exists(path.join(repo, "node_modules", "@kitbash")) ) && !(await exists(path.join(repo, "packages", "cli", "node_modules", "@kitbash")))) {
    return "workspace dependencies are missing: run `pnpm install` at the repo root";
  }
  const r = await sh("node", [KIT, "--help"], { cwd: repo, timeout: 60_000 });
  if (r.code !== 0 && !/usage|kit /i.test(r.out + r.err)) return `the kit CLI does not start: ${(r.err || r.out).split("\n")[0]}`;
  return null;
}

/* ---------------------------------------------------------------- cached installed template */

let cachePromise;
/** One installed copy of the template, shared by every case; created once per machine and template version. */
function installedTemplate() {
  cachePromise ??= (async () => {
    // Copy the current source before looking up the cache. The version must be resolved in
    // this standalone copy: a root packageManager pin may select a different pnpm version.
    const staging = await tmp("kitbash-e2e-template-stage-");
    await cp(TEMPLATE, staging, { recursive: true, filter: source => templateSourceFilter(TEMPLATE, source) });
    const version = await sh("pnpm", ["--version"], { cwd: staging, timeout: 60_000 });
    assert.equal(version.code, 0, `could not determine standalone pnpm version: ${fmt(version)}`);
    assert.ok(version.out.trim(), "standalone pnpm returned no version");
    const fingerprint = await templateCacheIdentity(staging, { pnpmVersion: version.out.trim() });
    const dir = path.join(os.tmpdir(), `kitbash-e2e-template-${fingerprint.slice(0, 20)}`);
    const marker = path.join(dir, ".e2e-ready");
    if (await exists(marker)) {
      await rm(staging, { recursive: true, force: true });
      return { dir };
    }
    await installStandalone(sh, { cwd: staging, allowOnline: process.env.KIT_E2E_ONLINE !== "0" });
    const t = await sh("pnpm", ["test"], { cwd: staging });
    assert.equal(t.code, 0, `the template's own pnpm test failed: ${fmt(t)}`);
    await writeFile(path.join(staging, ".e2e-ready"), "ok\n");
    await rm(dir, { recursive: true, force: true });
    await rename(staging, dir);
    return { dir };
  })();
  return cachePromise;
}

/** A fresh project: the cached installed template copied (symlinks kept) with a clean git-free tree. */
async function freshProject(base) {
  const dir = await tmp("kitbash-e2e-proj-");
  await cp(base, dir, { recursive: true, verbatimSymlinks: true, filter: (s) => !SKIP_COPY.test(path.relative(base, s).split(path.sep).join("/")) });
  await rm(path.join(dir, ".e2e-ready"), { force: true });
  return dir;
}

/* ---------------------------------------------------------------- block discovery and cases */

async function blockDirs() {
  const out = new Map(); // name -> abs dir
  const root = path.join(repo, "blocks");
  if (await exists(root)) {
    for (const e of await readdir(root, { withFileTypes: true })) {
      if (e.isDirectory() && (await exists(path.join(root, e.name, "block.json")))) out.set(e.name, path.join(root, e.name));
    }
  }
  return out;
}

/** A block's own cases: `<block dir>/e2e.json` (core allows it undeclared; it is never installed). */
async function blockE2e(dir) {
  const f = path.join(dir, "e2e.json");
  return (await exists(f)) ? readJson(f) : {};
}

/** Cases by name, later sources winning (cases.json first, then the block's e2e.json). */
const byName = (...lists) => [...new Map(lists.flat().filter(Boolean).map((c) => [c.name, c])).values()];

async function loadPlan() {
  const cfg = await readJson(path.join(here, "cases.json"));
  const dirs = await blockDirs();
  for (const [name, c] of Object.entries(cfg.blocks ?? {})) {
    if (c.path) dirs.set(name, path.resolve(repo, c.path));
  }
  const step = (block, s = {}) => {
    const dir = dirs.get(block);
    if (!dir) throw new Error(`unknown block ${block} (not in blocks/ and no cases.json "path")`);
    return { block, dir, variant: s.variant, params: s.params ?? {}, dependencyParams: s.dependencyParams ?? {} };
  };
  const entries = [];
  const chains = [...(cfg.chains ?? [])];
  for (const [name, dir] of [...dirs].sort(([a], [b]) => a.localeCompare(b))) {
    const c = cfg.blocks?.[name] ?? {};
    const own = await blockE2e(dir);
    for (const k of byName([{ name: "defaults", params: {} }], c.cases, own.cases)) {
      entries.push({ title: `${name} [${k.name}]`, filter: name, steps: [step(name, k)] });
    }
    for (const k of byName(c.conflicts, own.conflicts)) {
      entries.push({ title: `${name} [conflict: ${k.name}]`, filter: name, conflict: k, steps: [step(name, k)] });
    }
    chains.push(...(own.chains ?? []));
  }
  for (const ch of byName(chains)) {
    entries.push({ title: `chain ${ch.name}`, filter: ch.name, steps: ch.steps.map((s) => step(s.block, s)) });
  }
  const only = (process.env.KIT_E2E_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return only.length ? entries.filter((e) => only.includes(e.filter) || e.steps.some((s) => only.includes(s.block))) : entries;
}

/* ---------------------------------------------------------------- the tests */

const BLOCKS = path.join(repo, "blocks");
const kit = (args, cwd, home) => sh("node", [KIT, ...args], { cwd, timeout: 600_000, env: { KIT_KEYCHAIN: "0", HOME: home } });
const paramArgs = (p) => Object.entries(p).flatMap(([k, v]) => ["--param", `${k}=${v}`]);
const depParamArgs = (dp) => Object.entries(dp).flatMap(([dep, p]) => paramArgs(Object.fromEntries(Object.entries(p).map(([k, v]) => [`${dep}.${k}`, v]))));
/** `kit install` resolves the block's registryDependencies itself (from blocks/, by directory name) and installs them first. */
const installArgs = (s, extra = []) => ["install", s.dir, "--blocks-dir", BLOCKS, ...(s.variant ? ["--variant", s.variant] : []), ...paramArgs(s.params), ...depParamArgs(s.dependencyParams), ...extra];
const fmt = (r) => `exit ${r.code}\n${r.out}\n${r.err}`.slice(-4000);

/** Blocks that add npm dependencies change package.json: install them (offline first) as a person would. */
async function installAddedDependencies(dir, base) {
  const [now, was] = await Promise.all([readFile(path.join(dir, "package.json"), "utf8"), readFile(path.join(base, "package.json"), "utf8")]);
  if (now === was) return null;
  const pkg = JSON.parse(now);
  const added = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((n) => !/"/.test(n));
  const missing = async () => (await Promise.all(added.map(async (n) => ((await exists(path.join(dir, "node_modules", n, "package.json"))) ? null : n)))).filter(Boolean);
  await installStandalone(sh, { cwd: dir, allowOnline: process.env.KIT_E2E_ONLINE !== "0" });
  const left = await missing();
  assert.deepEqual(left, [], `pnpm install did not provide ${left.join(", ")}`);
  return added;
}

const problem = await toolingProblem();
const plan = await loadPlan();

describe("kitbash e2e: blocks installed into test-e2e/fixtures/hono-d1 and verified", () => {
  if (plan.length === 0) it("has cases", { skip: "no blocks found (blocks/* is empty and cases.json lists none)" }, () => {});
  for (const c of plan) {
    it(c.title, { timeout: 900_000 }, async () => {
      assert.equal(problem, null, problem ?? undefined);
      const base = await installedTemplate();
      const dir = await freshProject(base.dir);
      const home = await tmp("kitbash-e2e-home-");
      const steps = c.steps.map((s) => ({ ...s }));

      if (c.conflict) {
        // setup files → the dry run reports the listed conflicts (exit 1, nothing written) → resolve → verify passes
        for (const [rel, content] of Object.entries(c.conflict.setup ?? {})) {
          await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
          await writeFile(path.join(dir, rel), content);
        }
        const dry = await kit(installArgs(steps[0], ["--json"]), dir, home);
        assert.equal(dry.code, 1, `the dry run reports conflicts: ${fmt(dry)}`);
        const out = JSON.parse(dry.out);
        const conflicts = out.conflicts ?? out.error?.conflicts ?? [];
        for (const want of c.conflict.expect ?? []) {
          assert.ok(
            conflicts.some((x) => Object.entries(want).every(([k, v]) => x[k] === v)),
            `expected conflict ${JSON.stringify(want)} in ${JSON.stringify(conflicts)}`,
          );
        }
        assert.equal(await exists(path.join(dir, ".kit", "lock.json")), false, "nothing installed by a dry run with conflicts");
        const res = c.conflict.resolve ?? {};
        steps[0].params = { ...steps[0].params, ...(res.params ?? {}) };
        steps[0].onConflict = res.on_conflict;
      }

      for (const s of steps) {
        const r = await kit(installArgs(s, ["--apply", ...(s.onConflict ? ["--on-conflict", s.onConflict] : [])]), dir, home);
        assert.equal(r.code, 0, `kit install ${s.block} ${JSON.stringify(s.params)} failed: ${fmt(r)}`);
      }
      await installAddedDependencies(dir, base.dir);
      // The project's generated Worker types must reflect the config the blocks patched (as `pnpm typecheck` does).
      const ty = await sh(path.join(dir, "node_modules", ".bin", "wrangler"), ["types", "--strict-vars=false"], { cwd: dir, timeout: 180_000 });
      assert.equal(ty.code, 0, `wrangler types failed: ${fmt(ty)}`);

      const lock = await readJson(path.join(dir, ".kit", "lock.json"));
      const byBlock = (name) => Object.keys(lock.blocks ?? {}).find((id) => id.split("/")[1] === name);
      for (const s of steps) {
        const manifest = await readJson(path.join(s.dir, "block.json"));
        const id = byBlock(manifest.name);
        assert.ok(id, `lock records ${manifest.name}`);
        if (s.variant) assert.equal(lock.blocks[id].variant, s.variant, `lock variant for ${id}`);
        for (const [k, v] of Object.entries(s.params)) {
          const recorded = lock.blocks[id].params?.[k];
          if (recorded !== undefined) assert.equal(String(recorded), String(v), `lock params.${k} for ${id}`);
        }
        for (const [dep, p] of Object.entries(s.dependencyParams)) {
          const depId = byBlock(dep);
          assert.ok(depId, `lock records the dependency ${dep}`);
          for (const [k, v] of Object.entries(p)) assert.equal(String(lock.blocks[depId].params?.[k]), String(v), `lock params.${k} for ${depId}`);
        }
      }
      // a block's e2e.json is the harness's, never the project's
      for (const id of Object.keys(lock.blocks)) {
        assert.equal(await exists(path.join(dir, ".kit", "blocks", id.split("/")[1], "e2e.json")), false, `${id}: e2e.json is not installed`);
      }
      // every installed block, dependencies included, is verified
      for (const id of Object.keys(lock.blocks)) {
        const v = await kit(["verify", id, "--timeout", "600"], dir, home);
        assert.equal(v.code, 0, `kit verify ${id} failed: ${fmt(v)}`);
        const ran = (v.out.match(/PASS \(exit 0\)/g) ?? []).length;
        assert.ok(ran > 0 && !/FAIL \(exit/.test(v.out), `every verify command of ${id} passed:\n${v.out}`);
        assert.equal((await readJson(path.join(dir, ".kit", "lock.json"))).blocks[id].verify?.passed, true, `lock records ${id} verify.passed`);
      }
      // Installing the last block again must be refused with conflicts (its own files and tables now exist).
      const last = steps.at(-1);
      const again = await kit(installArgs(last), dir, home);
      assert.equal(again.code, 1, `a second install of ${last.block} reports conflicts: ${fmt(again)}`);
      assert.match(again.out + again.err, /conflict/i);
    });
  }
});
