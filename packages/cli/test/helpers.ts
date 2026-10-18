import { cp, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";
import { run } from "../src/cli.ts";
import type { Io } from "../src/io.ts";
import type { Runner } from "../src/verify.ts";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, "../../..");
export const TEMPLATE = path.join(repo, "templates", "hono-d1");
export const FIXTURE_BLOCK = path.join(repo, "packages", "core", "test", "fixtures", "blocks", "email-code-auth-fixture");
export const FIXTURE_LOCAL_ID = "@local/email-code-auth-fixture";
export const FIXTURE_ID = "@coop/email-code-auth-fixture";
export const NOW = "2026-10-20T10:11:12.000Z";

const dirs: string[] = [];
const DEFAULT_HOME = path.join(os.tmpdir(), `kit-cli-home-${process.pid}`);
dirs.push(DEFAULT_HOME);
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

export async function tmpDir(prefix = "kit-cli-"): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/** A temp copy of templates/hono-d1 without node_modules. */
export async function templateCopy(): Promise<string> {
  const d = await tmpDir("kit-proj-");
  await cp(TEMPLATE, d, { recursive: true, filter: (src) => !/(^|\/)(node_modules|\.wrangler|dist)(\/|$)/.test(path.relative(TEMPLATE, src)) });
  return d;
}

/** A temp copy of the core fixture block (to edit it). */
export async function fixtureCopy(): Promise<string> {
  const d = await tmpDir("kit-block-");
  await cp(FIXTURE_BLOCK, d, { recursive: true });
  return d;
}

export interface KitResult {
  code: number;
  out: string;
  err: string;
}

export interface KitOpts {
  cwd: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  runner?: Runner;
  stdin?: string;
  home?: string;
}

export const noNetwork: typeof fetch = (async () => {
  throw new Error("network is not allowed in tests");
}) as typeof fetch;

export const failRunner: Runner = async () => {
  throw new Error("the runner must not be called");
};

export async function kit(args: string[], o: KitOpts): Promise<KitResult> {
  let out = "";
  let err = "";
  const home = o.home ?? DEFAULT_HOME;
  const io: Io = {
    cwd: o.cwd,
    env: { PATH: process.env.PATH, KIT_KEYCHAIN: "0", ...(o.env ?? {}) },
    home,
    fetch: o.fetch ?? noNetwork,
    out: (s) => {
      out += s;
    },
    err: (s) => {
      err += s;
    },
    readStdin: async () => o.stdin ?? "",
    now: () => NOW,
    runner: o.runner ?? failRunner,
    platform: process.platform,
  };
  const code = await run(args, io);
  return { code, out, err };
}

/** Every file under a directory (relative paths → content), skipping node_modules. */
export async function snapshot(dir: string, skip: RegExp = /(^|\/)node_modules(\/|$)/): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (rel: string) => {
    for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skip.test(r)) continue;
      if (e.isDirectory()) await walk(r);
      else if (e.isFile()) out[r] = await readFile(path.join(dir, r), "utf8");
    }
  };
  await walk("");
  return out;
}

export async function readJson<T = any>(p: string): Promise<T> {
  return JSON.parse(await readFile(p, "utf8")) as T;
}

export async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export function planIdFrom(out: string): string {
  const m = /plan_[0-9A-Z]{20}/.exec(out);
  if (!m) throw new Error(`no plan id in output:\n${out}`);
  return m[0];
}
