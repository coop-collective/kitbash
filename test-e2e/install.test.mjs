/**
 * Kitbash e2e: install real block directories into a copy of templates/hono-d1 with the kit CLI (local path, no server),
 * apply, run each block's verify.commands through `kit verify`, and assert they pass.
 *
 *   node --test test-e2e/install.test.mjs            (from the repo root; also: node test-e2e/install.test.mjs)
 *   KIT_E2E_ONLY=crypto-utils,email-code-auth node --test test-e2e/install.test.mjs     (filter by block / chain name)
 *   KIT_E2E_ONLINE=0 forbids the online fallback for the dependency install.
 *
 * Cases come from blocks/* (defaults) plus test-e2e/cases.json (param sets, chains). See test-e2e/README.md.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const TEMPLATE = path.join(repo, "templates", "hono-d1");
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
    const h = createHash("sha256");
    for (const f of ["package.json", "pnpm-workspace.yaml"]) h.update(await readFile(path.join(TEMPLATE, f)));
    const dir = path.join(os.tmpdir(), `kitbash-e2e-template-${h.digest("hex").slice(0, 12)}`);
    const marker = path.join(dir, ".e2e-ready");
    if (await exists(marker)) return { dir };
    const staging = `${dir}.${process.pid}.tmp`;
    await rm(staging, { recursive: true, force: true });
    await cp(TEMPLATE, staging, { recursive: true, filter: (s) => !/(^|\/)(node_modules|\.wrangler|dist)(\/|$)/.test(path.relative(TEMPLATE, s)) });
    // The template quirks: pnpm may exit non-zero (ignored build scripts) while still linking node_modules, so the
    // install exit code is not trusted; `pnpm test` below is.
    const flags = ["install", "--ignore-workspace", "--config.confirmModulesPurge=false"];
    let r = await sh("pnpm", [...flags, "--offline"], { cwd: staging });
    if (!(await exists(path.join(staging, "node_modules", ".bin", "vitest"))) && process.env.KIT_E2E_ONLINE !== "0") {
      r = await sh("pnpm", flags, { cwd: staging });
    }
    if (!(await exists(path.join(staging, "node_modules", ".bin", "vitest")))) {
      return { skip: `templates/hono-d1 dependencies could not be installed (offline, then online): ${(r.err || r.out).trim().split("\n").slice(-3).join(" | ")}` };
    }
    const t = await sh("pnpm", ["test"], { cwd: staging });
    if (t.code !== 0) return { skip: `the template's own \`pnpm test\` fails (exit ${t.code}); fix the template first:\n${(t.out + t.err).slice(-1500)}` };
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

async function loadPlan() {
  const cfg = await readJson(path.join(here, "cases.json"));
  const dirs = await blockDirs();
  for (const [name, c] of Object.entries(cfg.blocks ?? {})) {
    if (c.path) dirs.set(name, path.resolve(repo, c.path));
  }
  const entries = [];
  for (const [name, dir] of [...dirs].sort(([a], [b]) => a.localeCompare(b))) {
    const c = cfg.blocks?.[name] ?? {};
    const manifest = await readJson(path.join(dir, "block.json"));
    const cases = [{ name: "defaults", params: {} }, ...(c.cases ?? [])];
    for (const k of cases) entries.push({ title: `${name} [${k.name}]`, filter: name, steps: [...(await depsOf(manifest, dirs, k.dependencyParams ?? {})), { block: name, dir, params: k.params ?? {} }] });
  }
  for (const ch of cfg.chains ?? []) {
    const steps = ch.steps.map((s) => {
      const dir = dirs.get(s.block);
      if (!dir) throw new Error(`chain ${ch.name}: unknown block ${s.block}`);
      return { block: s.block, dir, params: s.params ?? {} };
    });
    entries.push({ title: `chain ${ch.name}`, filter: ch.name, steps });
  }
  const only = (process.env.KIT_E2E_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return only.length ? entries.filter((e) => only.includes(e.filter) || e.steps.some((s) => only.includes(s.block))) : entries;
}

/** registryDependencies resolved (transitively, dependencies first) to block directories by their directory name. */
async function depsOf(manifest, dirs, depParams, seen = new Set()) {
  const steps = [];
  for (const ref of manifest.registryDependencies ?? []) {
    const name = String(typeof ref === "string" ? ref : ref.name ?? ref.id).replace(/^@[^/]+\//, "").replace(/@.*$/, "");
    if (seen.has(name)) continue;
    seen.add(name);
    const dir = dirs.get(name);
    if (!dir) throw new Error(`${manifest.name} depends on ${name}, which is not in blocks/ (add it to cases.json "path" if it lives elsewhere)`);
    steps.push(...(await depsOf(await readJson(path.join(dir, "block.json")), dirs, depParams, seen)), { block: name, dir, params: depParams[name] ?? {} });
  }
  return steps;
}

/* ---------------------------------------------------------------- the tests */

const kit = (args, cwd, home) => sh("node", [KIT, ...args], { cwd, timeout: 600_000, env: { KIT_KEYCHAIN: "0", HOME: home } });
const paramArgs = (p) => Object.entries(p).flatMap(([k, v]) => ["--param", `${k}=${v}`]);
const fmt = (r) => `exit ${r.code}\n${r.out}\n${r.err}`.slice(-4000);

const problem = await toolingProblem();
const plan = await loadPlan();

describe("kitbash e2e: blocks installed into templates/hono-d1 and verified", () => {
  if (plan.length === 0) it("has cases", { skip: "no blocks found (blocks/* is empty and cases.json lists none)" }, () => {});
  for (const c of plan) {
    it(c.title, { timeout: 900_000, skip: problem ?? false }, async (t) => {
      const base = await installedTemplate();
      if (base.skip) return t.skip(base.skip);
      const dir = await freshProject(base.dir);
      const home = await tmp("kitbash-e2e-home-");
      const ids = [];
      for (const s of c.steps) {
        const manifest = await readJson(path.join(s.dir, "block.json"));
        const id = `@local/${manifest.name}`;
        const r = await kit(["install", s.dir, "--apply", ...paramArgs(s.params)], dir, home);
        assert.equal(r.code, 0, `kit install ${s.block} ${JSON.stringify(s.params)} failed: ${fmt(r)}`);
        ids.push({ id, step: s, manifest });
      }
      // The project's generated Worker types must reflect the config the blocks patched (as `pnpm typecheck` does).
      const ty = await sh(path.join(dir, "node_modules", ".bin", "wrangler"), ["types", "--strict-vars=false"], { cwd: dir, timeout: 180_000 });
      assert.equal(ty.code, 0, `wrangler types failed: ${fmt(ty)}`);

      const lock = await readJson(path.join(dir, ".kit", "lock.json"));
      for (const { id, step } of ids) {
        assert.ok(lock.blocks?.[id], `lock records ${id}`);
        for (const [k, v] of Object.entries(step.params)) {
          const recorded = lock.blocks[id].params?.[k];
          if (recorded !== undefined) assert.equal(String(recorded), String(v), `lock params.${k} for ${id}`);
        }
      }
      for (const { id, manifest } of ids) {
        const cmds = manifest.verify?.commands ?? [];
        assert.ok(cmds.length > 0, `${id} declares verify.commands`);
        const v = await kit(["verify", id, "--timeout", "600"], dir, home);
        assert.equal(v.code, 0, `kit verify ${id} failed: ${fmt(v)}`);
        assert.equal((v.out.match(/PASS \(exit 0\)/g) ?? []).length, cmds.length, `every verify command of ${id} passed:\n${v.out}`);
        assert.equal((await readJson(path.join(dir, ".kit", "lock.json"))).blocks[id].verify?.passed, true, `lock records ${id} verify.passed`);
      }
      // Installing the last block again must be refused with conflicts (its own files and tables now exist).
      const last = ids.at(-1).step;
      const again = await kit(["install", last.dir, ...paramArgs(last.params)], dir, home);
      assert.equal(again.code, 1, `a second install of ${last.block} reports conflicts: ${fmt(again)}`);
      assert.match(again.out + again.err, /conflict/i);
    });
  }
});
