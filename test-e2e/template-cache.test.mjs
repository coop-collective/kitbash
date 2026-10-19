import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { templateCacheIdentity, templateSourceFilter } from "./template-cache.mjs";

const roots = [];
after(() => Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))));
const fixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kit-template-cache-test-"));
  roots.push(root);
  return root;
};
const put = async (root, relative, contents) => {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
};
const identity = (root, extra = {}) => templateCacheIdentity(root, { pnpmVersion: "12.14.0", ...extra });

test("source, migration, config, test, lock and Kitbash profile edits invalidate the cache", async () => {
  const root = await fixture();
  const inputs = ["package.json", "src/index.ts", "migrations/0001_init.sql", "wrangler.jsonc", "vitest.config.ts", "test/health.test.ts", "pnpm-lock.yaml", ".kit/project.json", ".dev.vars.example"];
  for (const file of inputs) await put(root, file, "before");
  for (const file of inputs) {
    const before = await identity(root);
    await put(root, file, "after");
    assert.notEqual(await identity(root), before, file);
    await put(root, file, "before");
  }
});

test("an absent workspace file is supported; optional config and toolchain changes invalidate", async () => {
  const root = await fixture();
  await put(root, "package.json", "{}");
  const before = await identity(root);
  assert.equal(before.length, 64);
  await put(root, "pnpm-workspace.yaml", "packages: []\n");
  assert.notEqual(await identity(root), before);
  await rm(path.join(root, "pnpm-workspace.yaml"));
  assert.equal(await identity(root), before);
  for (const extra of [{ pnpmVersion: "12.15.0" }, { nodeVersion: "v99.0.0" }, { platform: "other" }, { arch: "other" }]) {
    assert.notEqual(await identity(root, extra), before);
  }
  await assert.rejects(identity(root, { pnpmVersion: "" }), /pnpm version/);
});

test("copying and hashing share one filter and preserve actual cache source code", async () => {
  const root = await fixture();
  const kept = ["package.json", "src/cache/key.ts", ".kit/project.json", ".dev.vars.example"];
  for (const file of kept) await put(root, file, "source");
  const before = await identity(root);
  const ignored = ["node_modules/pkg/index.js", ".wrangler/state.sqlite", "dist/index.js", "coverage/report.json", ".cache/result", ".generated/types.ts", "test-results/result.json", "playwright-report/index.html", "worker-configuration.d.ts", "build.tsbuildinfo", ".kit/plans/plan.json", ".e2e-ready", ".dev.vars", ".env.local"];
  for (const file of ignored) await put(root, file, "generated");
  assert.equal(await identity(root), before);
  const copy = await fixture();
  await cp(root, copy, { recursive: true, filter: source => templateSourceFilter(root, source) });
  assert.equal(await identity(copy), before);
  for (const file of ignored) assert.equal(templateSourceFilter(root, path.join(root, file)), false, file);
  for (const file of kept) assert.equal(templateSourceFilter(root, path.join(root, file)), true, file);
});

test("identity includes additions, deletions and path renames, independent of creation order and root path", async () => {
  const a = await fixture();
  const b = await fixture();
  await put(a, "src/a.ts", "a");
  await put(a, "src/b.ts", "b");
  await put(b, "src/b.ts", "b");
  await put(b, "src/a.ts", "a");
  const before = await identity(a);
  assert.equal(await identity(b), before);
  await rename(path.join(b, "src/b.ts"), path.join(b, "src/c.ts"));
  assert.notEqual(await identity(b), before);
  await rename(path.join(b, "src/c.ts"), path.join(b, "src/b.ts"));
  await put(b, "src/added.ts", "added");
  assert.notEqual(await identity(b), before);
  await rm(path.join(b, "src/added.ts"));
  assert.equal(await identity(b), before);
  await rm(path.join(b, "src/b.ts"));
  assert.notEqual(await identity(b), before);
});

test("ignored dependency symlinks do not escape the tree; source symlinks are refused", async () => {
  const root = await fixture();
  const external = await fixture();
  await put(root, "package.json", "{}");
  const before = await identity(root);
  await symlink(external, path.join(root, "node_modules"), "dir");
  assert.equal(await identity(root), before);
  await put(external, "source.ts", "external");
  await symlink(path.join(external, "source.ts"), path.join(root, "source.ts"), "file");
  await assert.rejects(identity(root), /Template source symlink/);
});
