/**
 * Node adapter for core (`@kitbash/core/node`): a `KitFs` rooted at a project directory that refuses to read or
 * write outside it (including through symlinks), and `readBlockDir()` for a block directory on disk.
 * The main entry stays free of `node:*` imports so it runs in workerd.
 */
import { lstat, mkdir, readdir, readFile, realpath, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { KitError } from "./errors.ts";
import type { BlockBundle, FileTree, KitFs } from "./fs.ts";
import { normalizeRelative } from "./paths.ts";

const SKIP_DIRS = new Set([".git", "node_modules", ".DS_Store", ".wrangler", "dist", "coverage", ".turbo", "target", ".pnpm"]);

/**
 * A file-system adapter rooted at `root`. Every path is project-relative and normalized; any path whose existing
 * prefix is a symlink is refused (a symlink inside the project could point anywhere).
 */
export function nodeFs(root: string): KitFs & { root: string } {
  const abs = path.resolve(root);
  const resolve = async (p: string, forWrite: boolean): Promise<string> => {
    const n = p === "" || p === "." ? "" : normalizeRelative(p);
    if (n === null || (n !== "" && n !== p)) throw new KitError("forbidden", `path outside the project root: ${JSON.stringify(p)}`, { rule: "path_traversal" });
    const full = n === "" ? abs : path.join(abs, ...n.split("/"));
    if (full !== abs && !full.startsWith(abs + path.sep)) throw new KitError("forbidden", `path outside the project root: ${JSON.stringify(p)}`, { rule: "path_traversal" });
    // walk existing components; refuse symlinks
    let cur = abs;
    for (const seg of n === "" ? [] : n.split("/")) {
      cur = path.join(cur, seg);
      let st;
      try {
        st = await lstat(cur);
      } catch {
        break; // the rest doesn't exist yet
      }
      if (st.isSymbolicLink()) throw new KitError("forbidden", `refusing to ${forWrite ? "write" : "read"} through a symlink: ${path.relative(abs, cur)}`, { rule: "symlink" });
    }
    return full;
  };
  return {
    root: abs,
    async readFile(p) {
      const full = await resolve(p, false);
      try {
        const st = await lstat(full);
        if (!st.isFile()) return null;
        return new Uint8Array(await readFile(full));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "ENOTDIR") return null;
        throw e;
      }
    },
    async writeFile(p, data) {
      const full = await resolve(p, true);
      await mkdir(path.dirname(full), { recursive: true });
      // re-check after mkdir: a racing symlink in the parent chain is refused
      await resolve(p, true);
      const tmp = `${full}.kit-tmp-${process.pid}-${Date.now()}`;
      await writeFile(tmp, data, { flag: "wx", mode: 0o644 });
      await rename(tmp, full);
    },
    async list(dir) {
      const full = await resolve(dir, false);
      try {
        const entries = await readdir(full, { withFileTypes: true });
        return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "ENOTDIR") return null;
        throw e;
      }
    },
  };
}

/**
 * Reads a block directory: `block.json` (parsed), every other file (bytes), modes, and symlinks (recorded, never
 * followed). Skips `.git`, `node_modules` and similar.
 */
export async function readBlockDir(dir: string): Promise<BlockBundle> {
  const abs = await realpath(path.resolve(dir));
  const files: FileTree = {};
  const modes: Record<string, number> = {};
  const symlinks: string[] = [];
  let manifest: unknown;
  const walk = async (rel: string) => {
    const entries = await readdir(path.join(abs, rel), { withFileTypes: true });
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIP_DIRS.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(abs, r);
      const st = await lstat(full);
      if (st.isSymbolicLink()) {
        symlinks.push(r);
        continue;
      }
      if (st.isDirectory()) {
        await walk(r);
        continue;
      }
      if (!st.isFile()) continue;
      const data = new Uint8Array(await readFile(full));
      if (r === "block.json") {
        try {
          manifest = JSON.parse(new TextDecoder().decode(data));
        } catch {
          throw new KitError("invalid_params", `${dir}/block.json is not valid JSON`);
        }
        continue;
      }
      files[r] = data;
      modes[r] = st.mode & 0o777;
    }
  };
  await walk("");
  if (manifest === undefined) throw new KitError("not_found", `${dir} has no block.json`);
  return { manifest, files, modes, symlinks };
}

/** Writes a FileTree (e.g. a harvest draft) under `dir` through a rooted adapter. */
export async function writeTree(fs: KitFs, dir: string, tree: FileTree): Promise<string[]> {
  const written: string[] = [];
  for (const [p, d] of Object.entries(tree)) {
    const target = dir ? `${dir}/${p}` : p;
    await fs.writeFile(target, typeof d === "string" ? new TextEncoder().encode(d) : d);
    written.push(target);
  }
  return written;
}

/** Reads every file under `paths` (files or directories) of a project, for `harvestDraft`. */
export async function readTree(fs: KitFs, paths: string[]): Promise<FileTree> {
  const out: FileTree = {};
  const visit = async (p: string) => {
    const n = normalizeRelative(p.replace(/\/+$/, ""));
    if (n === null) throw new KitError("forbidden", `path outside the project root: ${JSON.stringify(p)}`);
    const data = await fs.readFile(n);
    if (data !== null) {
      out[n] = data;
      return;
    }
    const entries = await fs.list(n);
    if (!entries) return;
    for (const e of entries) {
      const name = e.replace(/\/$/, "");
      if (SKIP_DIRS.has(name)) continue;
      await visit(`${n}/${name}`);
    }
  };
  for (const p of paths) await visit(p);
  return out;
}
