import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

// Source inputs only. Keep .kit/project.json and real src/cache modules; omit install,
// runtime, generated-type and test-output artifacts from BOTH copying and hashing.
const ARTIFACT_DIRS = new Set(["node_modules", ".git", ".wrangler", "dist", "coverage", ".cache", ".generated", "test-results", "playwright-report"]);
const ARTIFACT_FILES = new Set(["worker-configuration.d.ts", ".e2e-ready", ".DS_Store"]);

export function templateSourceFilter(root, source) {
  const relative = path.relative(root, source);
  if (relative === "") return true;
  const parts = relative.split(path.sep);
  if (path.isAbsolute(relative) || parts.includes("..")) return false;
  if (parts.some(part => ARTIFACT_DIRS.has(part))) return false;
  const name = parts.at(-1);
  if (ARTIFACT_FILES.has(name) || name.endsWith(".tsbuildinfo")) return false;
  if (parts[0] === ".kit" && parts[1] === "plans") return false;
  // Local secrets are never template inputs; their checked-in examples are.
  if (/^(?:\.env|\.dev\.vars)(?:\.|$)/.test(name) && !name.endsWith(".example")) return false;
  return true;
}

/** Every copied source path/content plus the actual standalone install toolchain. */
export async function templateCacheIdentity(root, { pnpmVersion, nodeVersion = process.version, platform = process.platform, arch = process.arch }) {
  if (!pnpmVersion?.trim()) throw new Error("A pnpm version is required for the template cache identity");
  const hash = createHash("sha256");
  hash.update(JSON.stringify(["kitbash-template-cache-v2", pnpmVersion.trim(), nodeVersion, platform, arch]));
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const source = path.join(directory, entry.name);
      if (!templateSourceFilter(root, source)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Following source symlinks would let bytes outside the fingerprint's tree change
      // underneath an installed cache. Dependency symlinks were already filtered above.
      if (entry.isSymbolicLink()) throw new Error(`Template source symlink is not supported: ${relative}`);
      if (entry.isDirectory()) {
        hash.update(JSON.stringify(["directory", relative]));
        await visit(source, relative);
      } else if (entry.isFile()) {
        const mode = (await lstat(source)).mode & 0o777;
        const contentHash = createHash("sha256").update(await readFile(source)).digest("hex");
        hash.update(JSON.stringify(["file", relative, mode, contentHash]));
      } else {
        throw new Error(`Unsupported template source entry: ${relative}`);
      }
    }
  }
  await visit(root);
  return hash.digest("hex");
}
