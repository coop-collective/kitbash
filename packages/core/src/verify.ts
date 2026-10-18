/**
 * The `verify.commands` allowlist (BLOCK-SPEC §9). A block can only ask the client to run tests and type checks.
 *
 * Rules:
 * - A command is split on whitespace into argv; quotes, shell metacharacters, globs, `$`, backticks, redirections,
 *   newlines and environment assignments are refused, so the client runs it with `execFile` (never a shell).
 * - The program and subcommand must match one of the shapes below; every further argument is either a safe relative
 *   path (no `..`, not absolute) or a flag from that shape's own allowlist. Flags that load code or config from a
 *   path (`--config`, `--require`, `--import`, `--loader`, `--reporter=<file>`, `--setupFiles`, `--inspect`…) are
 *   refused.
 * - `wrangler` is allowed only for `d1 migrations apply|list <name> --local`.
 */

export interface CommandCheck {
  allowed: boolean;
  argv?: string[];
  reason?: string;
}

/** Plain-text list for skills and error messages. */
export const VERIFY_ALLOWLIST = [
  "npx vitest [run] [<test paths>] [--passWithNoTests --project=<name> --bail=<n> --silent --reporter=default|dot|verbose|basic|tap]",
  "pnpm vitest [run] [...same as npx vitest]",
  "pnpm test [--] [<test paths>] [...vitest flags]",
  "npm test [--] [<test paths>] [...vitest flags]",
  "node --test [--test-reporter=spec|dot|tap] [<test paths>]",
  "npx tsc --noEmit [-p <tsconfig path>]",
  "pnpm typecheck",
  "[npx|pnpm] wrangler d1 migrations apply <name> --local",
  "[npx|pnpm] wrangler d1 migrations list <name> --local",
] as const;

const SAFE_TOKEN = /^[A-Za-z0-9_@%+=:,./-]+$/;
const NAME = /^[A-Za-z0-9_-]{1,64}$/;

function isSafePathArg(a: string): boolean {
  if (a.startsWith("-")) return false;
  if (!SAFE_TOKEN.test(a)) return false;
  if (a.startsWith("/") || a.startsWith("~")) return false;
  const segs = a.split("/");
  if (segs.some((s) => s === ".." || s === "")) return false;
  return true;
}

const VITEST_FLAGS: Record<string, RegExp | null> = {
  "--run": null,
  "--passWithNoTests": null,
  "--silent": null,
  "--no-color": null,
  "--project": /^[A-Za-z0-9_-]{1,64}$/,
  "--bail": /^\d{1,3}$/,
  "--reporter": /^(default|dot|verbose|basic|tap|tap-flat)$/,
};

function checkVitestArgs(args: string[]): string | null {
  let i = 0;
  if (args[0] === "run") i = 1;
  for (; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--") continue;
    if (a.startsWith("-")) {
      const eq = a.indexOf("=");
      const flag = eq < 0 ? a : a.slice(0, eq);
      if (!(flag in VITEST_FLAGS)) return `flag ${flag} is not allowed`;
      const valueRe = VITEST_FLAGS[flag];
      if (valueRe === null) {
        if (eq >= 0) return `flag ${flag} takes no value`;
        continue;
      }
      const value = eq >= 0 ? a.slice(eq + 1) : args[++i];
      if (value === undefined || !valueRe!.test(value)) return `bad value for ${flag}`;
      continue;
    }
    if (!isSafePathArg(a)) return `argument ${JSON.stringify(a)} is not a safe relative path`;
  }
  return null;
}

/** Splits a command into argv, or returns a reason it can't be run without a shell. */
export function parseCommand(cmd: string): { argv: string[] } | { reason: string } {
  if (typeof cmd !== "string" || cmd.trim() === "") return { reason: "empty command" };
  if (cmd.length > 300) return { reason: "command too long" };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(cmd.replace(/ /g, ""))) return { reason: "control characters" };
  if (/[;&|`$<>(){}[\]*?!~#'"\\]/.test(cmd)) return { reason: "shell metacharacters are not allowed" };
  const argv = cmd.trim().split(/ +/);
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0]!)) return { reason: "environment assignments are not allowed" };
  for (const a of argv) if (!SAFE_TOKEN.test(a)) return { reason: `unsafe token ${JSON.stringify(a)}` };
  return { argv };
}

export function checkVerifyCommand(cmd: string): CommandCheck {
  const parsed = parseCommand(cmd);
  if ("reason" in parsed) return { allowed: false, reason: parsed.reason };
  const argv = parsed.argv;
  const deny = (reason: string): CommandCheck => ({ allowed: false, reason });
  const ok: CommandCheck = { allowed: true, argv };
  const [p0, p1, p2] = argv;

  // vitest via npx / pnpm
  if ((p0 === "npx" || p0 === "pnpm") && p1 === "vitest") {
    const r = checkVitestArgs(argv.slice(2));
    return r ? deny(r) : ok;
  }
  // package scripts
  if ((p0 === "pnpm" || p0 === "npm") && p1 === "test") {
    const r = checkVitestArgs(argv.slice(2));
    return r ? deny(r) : ok;
  }
  if (p0 === "pnpm" && p1 === "typecheck") return argv.length === 2 ? ok : deny("pnpm typecheck takes no arguments");
  // node --test
  if (p0 === "node" && p1 === "--test") {
    for (const a of argv.slice(2)) {
      if (a.startsWith("-")) {
        if (!/^--test-reporter=(spec|dot|tap)$/.test(a)) return deny(`flag ${a} is not allowed`);
      } else if (!isSafePathArg(a)) return deny(`argument ${JSON.stringify(a)} is not a safe relative path`);
    }
    return ok;
  }
  // tsc
  if (p0 === "npx" && p1 === "tsc" && p2 === "--noEmit") {
    const rest = argv.slice(3);
    if (rest.length === 0) return ok;
    if (rest.length === 2 && (rest[0] === "-p" || rest[0] === "--project") && isSafePathArg(rest[1]!)) return ok;
    return deny("only `npx tsc --noEmit [-p <path>]` is allowed");
  }
  // wrangler d1 migrations apply|list <name> --local
  const w = p0 === "wrangler" ? argv.slice(1) : (p0 === "npx" || p0 === "pnpm") && p1 === "wrangler" ? argv.slice(2) : null;
  if (w) {
    if (w[0] === "d1" && w[1] === "migrations" && (w[2] === "apply" || w[2] === "list")) {
      if (w.length === 5 && NAME.test(w[3]!) && w[4] === "--local") return ok;
      return deny("wrangler is allowed only as `wrangler d1 migrations apply|list <name> --local`");
    }
    return deny("wrangler is allowed only for local D1 migrations");
  }
  return deny("not in the verify allowlist");
}

export function isAllowedCommand(cmd: string): boolean {
  return checkVerifyCommand(cmd).allowed;
}
