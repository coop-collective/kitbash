import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("saved app copy preserves source and refuses an existing destination", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kit-copy-app-test-"));
  const destination = path.join(root, "app");
  const script = fileURLToPath(new URL("../copy-app.mjs", import.meta.url));
  const source = new URL("../results/v2-2026-10-19/reference/app/src/index.ts", import.meta.url);
  const args = [script, "v2-2026-10-19", "reference", destination];
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    await promisify(execFile)(process.execPath, args, { env });
    assert.equal(await readFile(path.join(destination, "src/index.ts"), "utf8"), await readFile(source, "utf8"));
    assert.match(await readFile(path.join(destination, ".dev.vars"), "utf8"), /^SESSION_SECRET=local-only-session-secret-/);
    const marker = path.join(destination, "src/index.ts");
    await writeFile(marker, "existing user edits\n");
    await assert.rejects(promisify(execFile)(process.execPath, args, { env }), /EEXIST/);
    assert.equal(await readFile(marker, "utf8"), "existing user edits\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
