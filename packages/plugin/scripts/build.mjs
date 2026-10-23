// Bundles the MCP server and the hook runtime into plugins/kitbash/runtime/kit.mjs (one self-contained ESM file with
// @kitbash/core, the kit CLI library, zod and the MCP SDK inlined), so an installed plugin needs no node_modules.
// The launchers (scripts/kit-mcp.mjs, hooks/session-start.mjs) use it when present and fall back to the sources.
import { build } from "rolldown";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "plugins", "kitbash", "runtime", "kit.mjs");
const catalog = path.join(path.dirname(file), "catalog");
await fs.rm(catalog, { recursive: true, force: true });
// The Styrene UI catalog travels as source (no Storybook build) so kitbash-ui can point an installed plugin at it.
const sources = { bootstraps: "bootstraps", blocks: "blocks", skills: "skills", ui: "packages/ui" };
const uiTooling = [".storybook", "scripts"];
for (const [name, from] of Object.entries(sources)) {
  await fs.cp(path.resolve(root, "../..", from), path.join(catalog, name), {
    recursive: true,
    filter: (source) => {
      const base = path.basename(source);
      if (["node_modules", ".git", ".pnpm", ".wrangler", "target", "dist", "coverage", "runtime", ".kit"].includes(base)) return false;
      if (name === "ui" && uiTooling.includes(base) && path.dirname(source) === path.resolve(root, "../..", from)) return false;
      if (/^(?:\.env|\.dev\.vars)(?:\.|$)/.test(base) && !base.endsWith(".example")) return false;
      return !base.endsWith(".log") && base !== ".DS_Store";
    },
  });
}
await build({
  input: path.join(root, "plugins", "kitbash", "scripts", "entry.mjs"),
  platform: "node",
  resolve: { mainFields: ["module", "main"] },
  logLevel: "warn",
  output: { file, format: "esm" },
});
console.log(`built ${path.relative(process.cwd(), file)}`);
