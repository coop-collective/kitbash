/**
 * The only I/O surface of core: an injected file-system adapter. Core never imports `node:fs`; `@kitbash/core/node`
 * provides a Node adapter, and `memoryFs` is used by tests and by the Worker.
 */
import { KitError } from "./errors.ts";
import { toBytes, tryDecodeUtf8, type FileData } from "./hash.ts";
import { normalizeRelative } from "./paths.ts";

/** An in-memory file tree: project- or block-relative POSIX path → content. */
export type FileTree = Record<string, FileData>;

/** A block as fetched or read from disk: the raw manifest plus every file of the block directory. */
export interface BlockBundle {
  /** The parsed `block.json` (raw JSON, not zod-parsed: signatures are over the raw object). */
  manifest: unknown;
  /** Block-relative path → content, excluding `block.json`. */
  files: FileTree;
  /** Optional POSIX modes by path (to detect executable bits). */
  modes?: Record<string, number>;
  /** Paths that were symlinks on disk (never followed). */
  symlinks?: string[];
  /** Registry co-signature, publisher signature and keys, when the bundle came from a registry. */
  registry_signature?: string;
  publisher_signature?: string;
}

export interface KitFs {
  /** Returns null when the file does not exist. Paths are project-relative. */
  readFile(path: string): Promise<Uint8Array | null>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Entry names of a directory (files and directories; directories end with `/`), or null when absent. */
  list(dir: string): Promise<string[] | null>;
}

export async function readText(fs: KitFs, path: string): Promise<string | null> {
  const b = await fs.readFile(path);
  if (b === null) return null;
  return tryDecodeUtf8(b);
}

export async function writeText(fs: KitFs, path: string, text: string): Promise<void> {
  await fs.writeFile(path, toBytes(text));
}

/** An in-memory adapter over a mutable tree. Refuses unsafe paths like the Node adapter does. */
export function memoryFs(tree: FileTree = {}): KitFs & { tree: FileTree } {
  const safe = (p: string) => {
    const n = normalizeRelative(p);
    if (n === null || n !== p) throw new KitError("forbidden", `unsafe path ${JSON.stringify(p)}`);
    return n;
  };
  return {
    tree,
    async readFile(p) {
      const n = safe(p);
      return Object.hasOwn(tree, n) ? toBytes(tree[n]!) : null;
    },
    async writeFile(p, data) {
      tree[safe(p)] = data;
    },
    async list(dir) {
      const prefix = dir === "" || dir === "." ? "" : `${safe(dir)}/`;
      const out = new Set<string>();
      for (const k of Object.keys(tree)) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const i = rest.indexOf("/");
        out.add(i < 0 ? rest : `${rest.slice(0, i)}/`);
      }
      return out.size ? [...out].sort() : null;
    },
  };
}
