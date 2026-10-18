/**
 * Runs a block's `verify.commands`: each one re-checked against core's allowlist (`checkVerifyCommand`) at run time,
 * printed before it runs, executed with `execFile` (argv, never a shell), cwd = project root, a timeout, a scrubbed
 * environment, and the last lines of output captured.
 *
 * `npx <bin>` runs the project's own `node_modules/.bin/<bin>` directly: if the binary is not installed, the command
 * is skipped instead of letting npx download a package by that name.
 */
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { checkVerifyCommand } from "@kitbash/core";

export interface RunResult {
  exit: number;
  output: string;
  timedOut?: boolean;
}

export type Runner = (file: string, args: string[], opts: { cwd: string; env: Record<string, string>; timeoutMs: number }) => Promise<RunResult>;

export const execRunner: Runner = (file, args, opts) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd: opts.cwd, env: opts.env, timeout: opts.timeoutMs, maxBuffer: 16 * 1024 * 1024, shell: false, windowsHide: true },
      (err, stdout, stderr) => {
        const output = `${stdout ?? ""}${stderr ?? ""}`;
        if (!err) return resolve({ exit: 0, output });
        const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean; signal?: string };
        if (e.killed || e.signal === "SIGTERM") return resolve({ exit: 124, output: `${output}\n(timed out after ${opts.timeoutMs} ms)`, timedOut: true });
        if (typeof e.code === "number") return resolve({ exit: e.code, output });
        resolve({ exit: 127, output: `${output}${e.message}` });
      },
    );
  });

/** Environment for verify runs: the user's PATH and locale, never registry tokens or other credentials. */
export function scrubbedEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  const deny = /^(KIT_|NPM_TOKEN$|NODE_AUTH_TOKEN$|GITHUB_TOKEN$|GH_TOKEN$|CLOUDFLARE_|CF_|AWS_|ANTHROPIC_|OPENAI_|HQ_)|TOKEN|SECRET|PASSWORD|PRIVATE|API_KEY|CREDENTIAL/i;
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !deny.test(k)) out[k] = v;
  out.CI = "1";
  out.NO_COLOR = "1";
  return out;
}

export interface CommandResult {
  command: string;
  exit: number;
  tail: string;
  skipped?: string;
}

function tail(s: string, lines = 30, max = 4000): string {
  const t = s.split(/\r?\n/).slice(-lines).join("\n");
  return t.length > max ? t.slice(-max) : t;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Resolves the program to run for an allowlisted argv. Returns null with a reason when it can't be run safely. */
export async function resolveProgram(root: string, argv: string[]): Promise<{ file: string; args: string[] } | { skip: string }> {
  const [p0, ...rest] = argv;
  if (p0 === "npx") {
    const bin = rest[0]!;
    const local = path.join(root, "node_modules", ".bin", bin);
    if (!(await exists(local))) return { skip: `${bin} is not installed in the project (node_modules/.bin/${bin}); install dependencies first. kit never lets npx download it.` };
    return { file: local, args: rest.slice(1) };
  }
  if (p0 === "wrangler") {
    const local = path.join(root, "node_modules", ".bin", "wrangler");
    if (!(await exists(local))) return { skip: "wrangler is not installed in the project" };
    return { file: local, args: rest };
  }
  return { file: p0!, args: rest };
}

export async function runVerifyCommands(
  commands: string[],
  opts: { root: string; env: Record<string, string | undefined>; runner: Runner; timeoutMs: number; onStart?: (cmd: string) => void },
): Promise<{ passed: boolean; results: CommandResult[]; duration_ms: number }> {
  const t0 = Date.now();
  const results: CommandResult[] = [];
  let ran = 0;
  for (const command of commands) {
    const chk = checkVerifyCommand(command);
    if (!chk.allowed || !chk.argv) {
      results.push({ command, exit: -1, tail: "", skipped: `not in the verify allowlist: ${chk.reason ?? "refused"}` });
      continue;
    }
    const prog = await resolveProgram(opts.root, chk.argv);
    if ("skip" in prog) {
      results.push({ command, exit: -1, tail: "", skipped: prog.skip });
      continue;
    }
    opts.onStart?.(command);
    ran++;
    const r = await opts.runner(prog.file, prog.args, { cwd: opts.root, env: scrubbedEnv(opts.env), timeoutMs: opts.timeoutMs });
    results.push({ command, exit: r.exit, tail: tail(r.output) });
  }
  const passed = ran > 0 && results.every((r) => r.exit === 0);
  return { passed, results, duration_ms: Date.now() - t0 };
}
