/**
 * `registryDependencies` for `kit install`: the blocks a block needs installed first, resolved transitively and
 * ordered dependencies first. A dependency already in the lock (any scope, same name) is left alone.
 *
 * Where a dependency comes from:
 * - `--blocks-dir <dir>`: `<dir>/<name>` (a local block directory named after the block), for any root block;
 * - else a local root block: its sibling directory `<dirname(root)>/<name>` (the `blocks/` layout);
 * - else the registry: `@scope/name` (a bare name takes the root block's scope), the highest non-yanked version that
 *   satisfies the range.
 *
 * Planning happens on an overlay of the project (writes kept in memory), so a dry run shows every plan in order and
 * nothing outside `.kit/` is written until `--apply`.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { KitError, parseBlockRef, parseDependencyRef, pickVersion, satisfiesRange, toBytes, type KitFs, type Lock } from "@kitbash/core";
import { apiFor } from "./context.ts";
import type { Io } from "./io.ts";
import { fetchRegistryBlock, loadLocalBlock, type ResolvedBlock } from "./source.ts";

export interface DependencyStep {
  /** the reference as the manifest wrote it */
  ref: string;
  name: string;
  block: ResolvedBlock;
  params: Record<string, string>;
}

export interface DependencyResolution {
  steps: DependencyStep[];
  warnings: string[];
}

const exists = (p: string) => stat(p).then(() => true, () => false);

function depsOf(b: ResolvedBlock): string[] {
  const m = b.bundle.manifest as { registryDependencies?: unknown } | undefined;
  return Array.isArray(m?.registryDependencies) ? m.registryDependencies.filter((x): x is string => typeof x === "string") : [];
}

/** The installed entry for a block name, whatever its scope. */
function installedByName(lock: Lock | null, name: string): { id: string; version: string } | null {
  for (const [id, e] of Object.entries(lock?.blocks ?? {})) if (id.split("/")[1] === name) return { id, version: e.version };
  return null;
}

/**
 * Splits `--param` values into the root block's and its dependencies' (`--param <dependency>.<name>=<value>`).
 */
export function splitParams(all: Record<string, string>): { own: Record<string, string>; deps: Record<string, Record<string, string>> } {
  const own: Record<string, string> = {};
  const deps: Record<string, Record<string, string>> = {};
  for (const [k, v] of Object.entries(all)) {
    const dot = k.indexOf(".");
    if (dot < 0) own[k] = v;
    else (deps[k.slice(0, dot)] ??= {})[k.slice(dot + 1)] = v;
  }
  return { own, deps };
}

export async function resolveDependencies(
  io: Io,
  root: ResolvedBlock,
  lock: Lock | null,
  opts: { blocksDir?: string; depParams: Record<string, Record<string, string>> },
): Promise<DependencyResolution> {
  const steps: DependencyStep[] = [];
  const warnings: string[] = [];
  const rootName = root.blockId.split("/")[1]!;
  const rootScope = parseBlockRef(root.blockId).scope;
  const localRoot = opts.blocksDir ? path.resolve(io.cwd, opts.blocksDir) : root.origin.kind === "local" ? path.dirname(root.origin.dir) : undefined;
  const done = new Set<string>([rootName]);

  async function fetchDep(ref: string, dep: ReturnType<typeof parseDependencyRef>): Promise<ResolvedBlock> {
    if (localRoot) {
      const dir = path.join(localRoot, dep.name);
      if (!(await exists(path.join(dir, "block.json")))) {
        throw new KitError("not_found", `${rootName} needs ${ref}, which is not installed and not at ${dir}; install it first or pass --blocks-dir <dir containing ${dep.name}/>`);
      }
      const b = await loadLocalBlock(io, dir);
      if (!satisfiesRange(b.version, dep.range)) warnings.push(`${ref}: the local block ${dir} is version ${b.version}`);
      return b;
    }
    const id = dep.id ?? `@${rootScope}/${dep.name}`;
    const { api, settings } = await apiFor(io);
    const info = await api.block(id);
    const version = pickVersion((info?.versions ?? []).filter((v) => !v.yanked).map((v) => v.version), dep.range);
    if (!version) throw new KitError("not_found", `${rootName} needs ${ref}: no published version of ${id} satisfies ${dep.range ?? "*"}`);
    return fetchRegistryBlock(api, settings.registryPublicKey, id, { version });
  }

  async function visit(b: ResolvedBlock, chain: string[]): Promise<void> {
    for (const ref of depsOf(b)) {
      const dep = parseDependencyRef(ref);
      if (chain.includes(dep.name)) throw new KitError("invalid_params", `dependency cycle: ${[...chain, dep.name].join(" → ")}`);
      if (done.has(dep.name)) continue;
      const have = installedByName(lock, dep.name);
      if (have) {
        if (!satisfiesRange(have.version, dep.range)) warnings.push(`${ref}: ${have.id}@${have.version} is installed (kit upgrade ${have.id} to move it)`);
        done.add(dep.name);
        continue;
      }
      const resolved = await fetchDep(ref, dep);
      await visit(resolved, [...chain, dep.name]);
      if (done.has(dep.name)) continue;
      done.add(dep.name);
      steps.push({ ref, name: dep.name, block: resolved, params: opts.depParams[dep.name] ?? {} });
    }
  }

  await visit(root, [rootName]);
  for (const n of Object.keys(opts.depParams)) {
    if (!steps.some((s) => s.name === n)) warnings.push(`--param ${n}.…: ${n} is not a dependency being installed; ignored`);
  }
  return { steps, warnings };
}

/** A KitFs whose writes stay in memory over a base (read-through): planning several installs in a row, dry. */
export function overlayFs(base: KitFs): KitFs {
  const writes = new Map<string, Uint8Array>();
  return {
    async readFile(p) {
      return writes.has(p) ? writes.get(p)! : base.readFile(p);
    },
    async writeFile(p, data) {
      writes.set(p, toBytes(data));
    },
    async list(dir) {
      const out = new Set(await base.list(dir) ?? []);
      const prefix = dir === "" || dir === "." ? "" : `${dir.replace(/\/+$/, "")}/`;
      for (const k of writes.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const i = rest.indexOf("/");
        out.add(i < 0 ? rest : `${rest.slice(0, i)}/`);
      }
      return out.size ? [...out].sort() : null;
    },
  };
}
