// Loads the runtime: the bundle (`runtime/kit.mjs`, built by `pnpm -F @kitbash/plugin build`, self-contained) when it
// exists, else the sources (inside the monorepo, through the workspace links).
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export async function loadKit() {
  const bundle = new URL("../runtime/kit.mjs", import.meta.url);
  if (fs.existsSync(fileURLToPath(bundle))) return import(bundle.href);
  return import("./entry.mjs");
}
