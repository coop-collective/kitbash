// Writes src/components/<slug>/index.ts for every catalog entry, so each component is its own import path
// (@kitbash/ui/<slug>) and can be code-split with React.lazy. `--check` fails if any entry is missing or stale.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const src = new URL("../src/", import.meta.url);
const { components } = JSON.parse(readFileSync(new URL("catalog.json", src), "utf8"));
const check = process.argv.includes("--check");
const stale = [];

for (const c of components) {
  const file = new URL(`components/${c.slug}/index.ts`, src);
  const text = `export * from "./${c.export}.tsx";\n`;
  if (existsSync(file) && readFileSync(file, "utf8") === text) continue;
  if (check) stale.push(c.slug);
  else writeFileSync(file, text);
}

if (stale.length) {
  console.error(`component entry points are missing or stale: ${stale.join(", ")}; run pnpm -F @kitbash/ui gen-entries`);
  process.exit(1);
}
console.log(check ? `entry points current: ${components.length}` : `wrote entry points for ${components.length} components`);
