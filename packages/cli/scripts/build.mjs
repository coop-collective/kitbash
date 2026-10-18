// Single-file build: dist/kit.js bundles the CLI and @kitbash/core (with its npm deps), runnable with plain node.
import { build } from "rolldown";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "dist", "kit.js");
await build({
  input: path.join(root, "src", "kit.ts"),
  platform: "node",
  resolve: { mainFields: ["module", "main"] },
  logLevel: "warn",
  output: { file, format: "esm", banner: "#!/usr/bin/env node" },
});
await chmod(file, 0o755);
console.log(`built ${path.relative(process.cwd(), file)}`);
