import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, symlink, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
test("coverage includes unimported source and fails its per-file gate", async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), "kitbash-coverage-"));
  try {
    await cp(root, scratch, { recursive: true, filter: (source) => !/(^|\/)(node_modules|coverage|\.wrangler)(\/|$)/.test(path.relative(root, source)) });
    await symlink(path.join(root, "node_modules"), path.join(scratch, "node_modules"), "dir");
    await writeFile(path.join(scratch, "src/unimported.ts"), "export const uncovered = () => 42;\n");
    const result = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--coverage"], { cwd: scratch, encoding: "utf8", timeout: 120000 });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(await readFile(path.join(scratch, "coverage/coverage-summary.json"), "utf8"));
    const entry = Object.entries(report).find(([name]) => name.endsWith("/src/unimported.ts"));
    assert.ok(entry, "unimported module must appear in coverage");
    assert.equal(entry[1].functions.pct, 0);
    assert.match(result.stdout + result.stderr, /threshold/i);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
