import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { memoryFs, type BlockBundle, type FileTree } from "../src/fs.ts";
import type { ProjectProfile } from "../src/profile.ts";
import { readBlockDir } from "../src/node.ts";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const fixtures = path.join(here, "fixtures");
export const FIXTURE_BLOCK = path.join(fixtures, "blocks", "email-code-auth-fixture");
export const FIXTURE_ID = "@coop/email-code-auth-fixture";
export const NOW = "2026-10-20T10:11:12Z";

export async function loadFixtureBlock(): Promise<BlockBundle> {
  return readBlockDir(FIXTURE_BLOCK);
}

/** A deep copy of the bundle with a mutable manifest. */
export function cloneBundle(b: BlockBundle): BlockBundle & { manifest: Record<string, any> } {
  return { ...b, manifest: structuredClone(b.manifest) as Record<string, any>, files: { ...b.files }, modes: { ...(b.modes ?? {}) }, symlinks: [...(b.symlinks ?? [])] };
}

export function readTreeSync(dir: string): FileTree {
  const out: FileTree = {};
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      const full = path.join(dir, r);
      if (statSync(full).isDirectory()) walk(r);
      else out[r] = readFileSync(full, "utf8");
    }
  };
  walk("");
  return out;
}

export function loadProject(name = "hono-d1-min") {
  const tree = readTreeSync(path.join(fixtures, "projects", name));
  const profile = JSON.parse(tree[".kit/project.json"] as string) as ProjectProfile;
  return { tree, profile, fs: memoryFs({ ...tree }) };
}

export const text = (d: string | Uint8Array | undefined) => (d === undefined ? undefined : typeof d === "string" ? d : new TextDecoder().decode(d));
