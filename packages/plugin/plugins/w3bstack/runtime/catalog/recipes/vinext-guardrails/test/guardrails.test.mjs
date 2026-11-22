import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { inspectConfiguration, inspectClient, checkProject } from "../scripts/check-vinext.mjs";

const pkg = { dependencies: { vinext: "1.2.1", react: "19.3.1", "react-dom": "19.3.1", "@cloudflare/vite-plugin": "1.62.5" }, scripts: { build: "vite build" } };
const config = { main: "worker/index.ts", compatibility_flags: ["nodejs_compat"], assets: { directory: "dist/client", not_found_handling: "none" }, observability: { enabled: true, traces: { enabled: true } } };
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "vinext-guard-"));
  try {
    mkdirSync(join(root, "dist/client"), { recursive: true });
    writeFileSync(join(root, "dist/client/app.js"), "export const hello = 'world';");
    writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
    writeFileSync(join(root, "wrangler.jsonc"), "// source config\n" + JSON.stringify(config));
    fn(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test("tested configuration and built client pass", () => fixture(root => {
  assert.deepEqual(checkProject(root, 1000).errors, []);
  assert.equal(checkProject(root, 1000).size.files, 1);
}));
test("mismatched React, floating vinext and legacy build are actionable failures", () => {
  const invalid = structuredClone(pkg);
  invalid.dependencies.vinext = "latest";
  invalid.dependencies["react-dom"] = "19.2.0";
  invalid.scripts.build = "next build";
  const errors = inspectConfiguration(invalid, config);
  assert.equal(errors.length, 3);
});
test("SPA fallback and disabled observability are rejected", () => {
  const invalid = structuredClone(config);
  invalid.assets.not_found_handling = "single-page-application";
  invalid.observability.traces.enabled = false;
  assert.equal(inspectConfiguration(pkg, invalid).length, 2);
});
test("empty artifacts, over-budget bundles and invalid JSON cannot pass", () => fixture(root => {
  assert.equal(checkProject(root, 1).errors.length, 1);
  rmSync(join(root, "dist/client/app.js"));
  assert.throws(() => checkProject(root, 1000), /No client JavaScript/);
  writeFileSync(join(root, "wrangler.jsonc"), "{ broken }");
  assert.throws(() => checkProject(root, 1000), /Invalid/);
}));
test("symlinks and escaping client paths are refused", () => fixture(root => {
  symlinkSync(join(root, "package.json"), join(root, "dist/client/leak.js"));
  assert.throws(() => inspectClient(join(root, "dist/client"), 1000), /symlink/);
  writeFileSync(join(root, "wrangler.jsonc"), JSON.stringify({ ...config, assets: { ...config.assets, directory: "../../" } }));
  assert.throws(() => checkProject(root, 1000), /escapes/);
}));
test("CLI failure reaches the caller", () => fixture(root => {
  const result = spawnSync(process.execPath, [resolve("scripts/check-vinext.mjs"), root, "1"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /exceeds/);
}));
