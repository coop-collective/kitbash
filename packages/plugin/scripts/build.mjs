// Bundles the MCP server and the hook runtime into plugins/kitbash/runtime/kit.mjs (one self-contained ESM file with
// @kitbash/core, the kit CLI library, zod and the MCP SDK inlined), so an installed plugin needs no node_modules.
// The launchers (scripts/kit-mcp.mjs, hooks/session-start.mjs) use it when present and fall back to the sources.
import { build } from "rolldown";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "plugins", "kitbash", "runtime", "kit.mjs");
await build({
  input: path.join(root, "plugins", "kitbash", "scripts", "entry.mjs"),
  platform: "node",
  resolve: { mainFields: ["module", "main"] },
  logLevel: "warn",
  output: { file, format: "esm" },
});
console.log(`built ${path.relative(process.cwd(), file)}`);
