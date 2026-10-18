// `pnpm typecheck` for a plain-JS package: every .mjs under scripts/, test/ and the plugin must parse (node --check).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "runtime", ".git"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith(".mjs")) files.push(full);
  }
})(root);
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status !== 0) {
    bad++;
    console.error(`${path.relative(root, f)}:\n${r.stderr}`);
  }
}
if (bad) process.exit(1);
console.log(`checked ${files.length} files`);
