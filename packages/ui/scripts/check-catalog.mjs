// Checks that every catalog entry ships a component, its stylesheet, a story under the right title,
// a twist note, and an export from src/index.ts.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../src/", import.meta.url).pathname;
const { components } = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));
const index = readFileSync(join(root, "index.ts"), "utf8");
const problems = [];

for (const c of components) {
  const dir = join(root, "components", c.slug);
  const files = [`${c.export}.tsx`, `${c.slug}.css`, `${c.export}.stories.tsx`];
  for (const file of files) {
    if (!existsSync(join(dir, file))) problems.push(`${c.slug}: missing ${file}`);
  }
  const storyPath = join(dir, `${c.export}.stories.tsx`);
  if (existsSync(storyPath)) {
    const title = `Components/${c.category}/${c.name}`;
    if (!readFileSync(storyPath, "utf8").includes(`title: "${title}"`)) problems.push(`${c.slug}: story title is not "${title}"`);
  }
  if (!c.twist) problems.push(`${c.slug}: catalog twist is empty`);
  if (!index.includes(`./components/${c.slug}/index.ts`)) problems.push(`${c.slug}: not exported from src/index.ts`);
}

const known = new Set(components.map((c) => c.slug));
for (const dir of readdirSync(join(root, "components"))) {
  if (!known.has(dir)) problems.push(`${dir}: component directory is not in catalog.json`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`catalog ok: ${components.length} components`);
