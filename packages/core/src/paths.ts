/**
 * Path safety. Every path that comes from a block, a plan file or a param is checked here before it is used.
 * Paths are POSIX, relative, normalized, with no `.`/`..`/empty segments, no backslashes, no drive letters,
 * no control characters and no NUL.
 */

export type PathProblem =
  | "empty"
  | "absolute"
  | "traversal"
  | "backslash"
  | "dot_segment"
  | "empty_segment"
  | "control_char"
  | "drive_letter"
  | "too_long";

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f\u0080-\u009f]/;

/** Returns why `p` is not a safe relative path, or null when it is. */
export function pathProblem(p: string): PathProblem | null {
  if (typeof p !== "string" || p.length === 0) return "empty";
  if (p.length > 512) return "too_long";
  if (CONTROL.test(p)) return "control_char";
  if (p.includes("\\")) return "backslash";
  if (p.startsWith("/") || p.startsWith("~")) return "absolute";
  if (/^[A-Za-z]:/.test(p)) return "drive_letter";
  const segs = p.split("/");
  for (const s of segs) {
    if (s === "..") return "traversal";
    if (s === ".") return "dot_segment";
    if (s === "") return "empty_segment";
  }
  return null;
}

export function isSafeRelativePath(p: string): boolean {
  return pathProblem(p) === null;
}

/**
 * Normalizes a joined path (collapses `./`, duplicate slashes) and returns null when it escapes the root
 * (any `..` that climbs above the start) or is absolute.
 */
export function normalizeRelative(p: string): string | null {
  if (typeof p !== "string" || p.length === 0) return null;
  if (p.includes("\\") || p.includes("\0") || CONTROL.test(p)) return null;
  if (p.startsWith("/") || p.startsWith("~") || /^[A-Za-z]:/.test(p)) return null;
  const out: string[] = [];
  for (const s of p.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") return null; // never allow climbing, even when it would stay inside
    out.push(s);
  }
  if (out.length === 0) return null;
  return out.join("/");
}

export function joinPath(...parts: string[]): string {
  return parts.filter((x) => x.length > 0).join("/").replace(/\/+/g, "/");
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

export function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

/** Relative path from directory `fromDir` to `to` (both project-relative). Always starts with `./` or `../`. */
export function relativePath(fromDir: string, to: string): string {
  const a = fromDir.split("/").filter(Boolean);
  const b = to.split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const up = a.length - i;
  const rest = b.slice(i);
  if (up === 0) return rest.length ? `./${rest.join("/")}` : ".";
  return [...Array(up).fill(".."), ...rest].join("/");
}

/**
 * Project paths a block may never write, whatever its manifest says: VCS internals, installed packages, and the
 * kit's own state (except `.kit/blocks/<this block>/`).
 */
export function forbiddenTarget(target: string, blockName: string): string | null {
  const lower = target.toLowerCase();
  const first = lower.split("/")[0] ?? "";
  if (first === ".git" || first === ".hg" || first === ".svn") return "VCS directory";
  if (lower.split("/").includes("node_modules")) return "node_modules";
  if (first === ".kit") {
    if (lower.startsWith(`.kit/blocks/${blockName.toLowerCase()}/`)) return null;
    return "kit state (.kit/ is written by the installer only)";
  }
  if (first === ".github" && lower.includes("/workflows/")) return "CI workflow";
  if (first === ".claude" || first === ".codex" || first === ".agents" || first === ".cursor") {
    return "agent configuration";
  }
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  if (base === "package.json" || base === "package-lock.json" || base === "pnpm-lock.yaml" || base === "yarn.lock") {
    return "package manifest (dependencies are added by the planner from `dependencies[]`, never by a block file)";
  }
  if (lower === ".npmrc" || lower === ".yarnrc" || lower === ".yarnrc.yml" || lower === ".pnpmfile.cjs") {
    return "package manager configuration";
  }
  if (/(^|\/)\.(dev\.vars|env)(\.[a-z]+)?$/.test(lower) && !lower.endsWith(".example")) {
    return "secret file (only *.example env files may be written)";
  }
  return null;
}
