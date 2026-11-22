import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

test("real compiler failure propagates; missing history never skips checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "kit-typecheck-"));
  try {
    for (const file of ["scripts", "examples", "typecheck.projects.json"]) cpSync(resolve(file), join(dir, file), { recursive: true, filter: path => !path.includes(".cache") });
    symlinkSync(resolve("node_modules"), join(dir, "node_modules"), "dir");
    const run = () => spawnSync(process.execPath, ["scripts/typecheck.mjs", "--since", "missing-ref"], { cwd: dir, encoding: "utf8" });
    const good = run();
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /Checked 2\/2/);
    writeFileSync(join(dir, "examples/shared/src/bad.ts"), "const wrong: string = 42;\n");
    const bad = run();
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /TS2322/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
