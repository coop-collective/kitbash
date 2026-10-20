import { lstat, readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KitError, ProjectProfileSchema, type ProjectProfile } from "@kitbash/core";

export const PRESETS = ["worker", "vinext", "rust-server"] as const;
export type PresetId = typeof PRESETS[number];
export interface Preset {
  id: PresetId;
  title: string;
  description: string;
  defaultHost: string;
  defaultPort: number;
  compatibilityDate?: string;
  compatibleBlocks: string[];
  profile: Omit<ProjectProfile, "project_id">;
}

export async function catalogRoot(explicit?: string): Promise<string> {
  const candidates = explicit ? [path.resolve(explicit)] : [];
  if (!explicit) {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    while (true) {
      candidates.push(path.join(dir, "catalog"), dir);
      const parent = path.dirname(dir);
      if (dir === parent) break;
      dir = parent;
    }
  }
  for (const dir of candidates) {
    if (await lstat(path.join(dir, "bootstraps", "worker", "bootstrap.json")).then(s => s.isFile(), () => false)) return dir;
  }
  throw new KitError("not_found", "Bootstrap catalog missing. Build the CLI/plugin or set KIT_CATALOG_ROOT to a Kitbash checkout.");
}

export async function loadPreset(root: string, id: string): Promise<Preset> {
  if (!(PRESETS as readonly string[]).includes(id)) throw new KitError("invalid_params", `Unknown preset ${id}; choose ${PRESETS.join(", ")}`);
  const value = JSON.parse(await readFile(path.join(root, "bootstraps", id, "bootstrap.json"), "utf8")) as Preset;
  if (value.id !== id || !Array.isArray(value.compatibleBlocks) || value.compatibleBlocks.some(n => !/^[a-z][a-z0-9-]*$/.test(n))) {
    throw new KitError("invalid_params", `Invalid bootstrap metadata for ${id}`);
  }
  ProjectProfileSchema.parse({ ...value.profile, project_id: "prj_bootstrap" });
  return value;
}

const OMIT = new Set(["node_modules", ".git", ".pnpm", "target", "dist", "coverage", ".wrangler", ".DS_Store"]);

/** Copy trusted, versioned catalog assets; never follow a symlink or include local secret files. */
export async function copyAssets(source: string, destination: string, replacements: Record<string, string> = {}): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (OMIT.has(entry.name) || (/^\.(env|dev\.vars)(\.|$)/.test(entry.name) && !entry.name.endsWith(".example"))) continue;
    if (entry.isSymbolicLink()) throw new KitError("forbidden", `Catalog contains a symlink: ${entry.name}`);
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyAssets(from, to, replacements);
    else if (entry.isFile()) {
      let content = await readFile(from, "utf8");
      for (const [token, value] of Object.entries(replacements)) content = content.replaceAll(token, value);
      await mkdir(path.dirname(to), { recursive: true });
      await writeFile(to, content, { mode: (await lstat(from)).mode & 0o777 });
    }
  }
}
