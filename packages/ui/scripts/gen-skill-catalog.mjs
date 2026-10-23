// Writes the kitbash-ui skill's catalog reference from src/catalog.json. `--check` fails if the file is stale.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const catalogPath = new URL("../src/catalog.json", import.meta.url);
const target = new URL("../../plugin/plugins/kitbash/skills/kitbash-ui/references/catalog.md", import.meta.url);
const { components } = JSON.parse(readFileSync(catalogPath, "utf8"));

const byCategory = new Map();
for (const c of components) {
  if (!byCategory.has(c.category)) byCategory.set(c.category, []);
  byCategory.get(c.category).push(c);
}

const lines = [
  "# Styrene component catalog",
  "",
  "Generated from `packages/ui/src/catalog.json` by `pnpm -F @kitbash/ui gen-skill-catalog`; do not edit by hand.",
  "Each component lives in `src/components/<slug>/` as `<Export>.tsx`, `<slug>.css` and `<Export>.stories.tsx`.",
  "",
];
for (const [category, items] of byCategory) {
  lines.push(`## ${category}`, "", "| Component | Slug | What makes it Styrene |", "|---|---|---|");
  for (const c of items) lines.push(`| ${c.name} (\`${c.export}\`) | \`${c.slug}\` | ${c.twist.replaceAll("|", "\\|")} |`);
  lines.push("");
}
const text = lines.join("\n");

if (process.argv.includes("--check")) {
  if (!existsSync(target) || readFileSync(target, "utf8") !== text) {
    console.error("kitbash-ui references/catalog.md is stale; run pnpm -F @kitbash/ui gen-skill-catalog");
    process.exit(1);
  }
  console.log("skill catalog reference is current");
} else {
  writeFileSync(target, text);
  console.log(`wrote ${components.length} components to the kitbash-ui skill reference`);
}
