import { test } from "node:test";
import assert from "node:assert/strict";
import { selectProjects, runBounded, validateProjects } from "../scripts/plan.mjs";

const projects = [
  { name: "core", path: "packages/core", dependsOn: [] },
  { name: "api", path: "packages/api", dependsOn: ["core"] },
  { name: "web", path: "packages/web", dependsOn: ["api"] },
  { name: "other", path: "packages/other", dependsOn: [] },
];
test("transitive consumers are selected for edits and deletions", () => {
  assert.deepEqual(selectProjects(projects, ["packages/core/deleted.ts"]).map(p => p.name), ["core", "api", "web"]);
  assert.deepEqual(selectProjects(projects, ["packages/api/src/x.ts"]).map(p => p.name), ["api", "web"]);
});
test("unknown/root paths and missing history check everything", () => {
  for (const diff of [null, ["pnpm-lock.yaml"], ["tsconfig.base.json"], ["packages/core-new/a.ts"]]) assert.equal(selectProjects(projects, diff), projects);
  assert.deepEqual(selectProjects(projects, []), []);
});
test("invalid dependency graph cannot silently skip", () => {
  assert.throws(() => validateProjects([{ name: "a", path: "../a", dependsOn: [] }]));
  assert.throws(() => validateProjects([{ name: "a", path: "a", dependsOn: ["missing"] }]));
});
test("work overlaps but never exceeds the configured bound", async () => {
  let active = 0, peak = 0;
  const releases = [];
  const task = runBounded([0, 1, 2, 3], 2, async value => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => releases.push(resolve));
    active--; return value === 2 ? 1 : 0;
  });
  assert.equal(active, 2);
  while (releases.length) {
    releases.shift()();
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.deepEqual(await task, [0, 0, 1, 0]);
  assert.equal(peak, 2);
});
test("exceptions and invalid concurrency fail", async () => {
  assert.deepEqual(await runBounded([1], 1, async () => { throw new Error("failed"); }), [1]);
  await assert.rejects(runBounded([], 0, async () => 0));
});
