/**
 * `kit` command dispatch. `run(argv, io)` returns the exit code (0 ok, 1 failure, 2 usage) and never calls
 * `process.exit`, so tests drive it in-process.
 */
import { KitError, errorEnvelope } from "@kitbash/core";
import { parse, UsageError, type Options, type Parsed } from "./args.ts";
import { json, line, sanitizeLine, type Io } from "./io.ts";
import { apply, install, installOptions } from "./commands/install.ts";
import { adapt, adaptOptions, diff, diffOptions, propose, proposeOptions, status, upgrade, upgradeOptions, verify, verifyOptions } from "./commands/installed.ts";
import { harvest, harvestOptions, init, initOptions, validate, validateOptions } from "./commands/local.ts";
import { get, getOptions, heartbeat, heartbeatOptions, login, loginOptions, publish, publishOptions, search, searchOptions, whoami } from "./commands/registry.ts";
import { bootstrap, bootstrapOptions } from "./commands/bootstrap.ts";

interface Command {
  options: Options;
  run(io: Io, a: Parsed): Promise<number>;
  usage: string;
}

const COMMANDS: Record<string, Command> = {
  bootstrap: { options: bootstrapOptions, run: bootstrap, usage: "kit bootstrap [directory] --preset worker|vinext|rust-server [--blocks name[:variant],…] [--git-host local|github|gitstalk --repo owner/name --create-repo] [--host address --port n] [--hostname domain] [--infisical-project id] [--install] [--yes] [--list]" },
  login: { options: loginOptions, run: login, usage: "kit login [--token <t> | paste on stdin] [--api <url>] [--registry-key ed25519:…] [--no-verify]" },
  whoami: { options: {}, run: whoami, usage: "kit whoami" },
  init: { options: initOptions, run: init, usage: "kit init [--telemetry] [--force]" },
  search: { options: searchOptions, run: search, usage: "kit search <query…> [--stack framework=hono,db=d1] [--tags a,b] [--scope private|public|all] [--limit n]" },
  get: { options: getOptions, run: get, usage: "kit get <@scope/name[@version] | ./block-dir> [--detail summary|manifest|files|skill|changelog] [--variant v]" },
  install: {
    options: installOptions,
    run: install,
    usage: "kit install <@scope/name[@version] | ./block-dir> [--param k=v]… [--param <dependency>.k=v]… [--blocks-dir <dir>] [--no-deps] [--variant v] [--on-conflict stop|skip|overwrite|rename] [--no-config] [--apply [--plan-id <id>]] [--id @scope/name]",
  },
  apply: { options: {}, run: apply, usage: "kit apply <plan_id>" },
  verify: { options: verifyOptions, run: verify, usage: "kit verify <@scope/name> [--command '<allowlisted command>']… [--timeout seconds] [--from <block dir>]" },
  adapt: { options: adaptOptions, run: adapt, usage: "kit adapt <@scope/name> <item id> [--status done|pending|skipped]" },
  diff: { options: diffOptions, run: diff, usage: "kit diff <@scope/name> [--from <block dir>]" },
  upgrade: { options: upgradeOptions, run: upgrade, usage: "kit upgrade <@scope/name> [--to <version> | --to-dir <block dir>] [--from <installed block dir>] [--apply]" },
  harvest: { options: harvestOptions, run: harvest, usage: "kit harvest --name <slug> --paths <p>[,<p>…] --desc '<description>' [--stack k=v,…] [--hint literal=param]… [--force]" },
  validate: { options: validateOptions, run: validate, usage: "kit validate <block dir> [--public]" },
  publish: { options: publishOptions, run: publish, usage: "kit publish <block dir> [--visibility private|public] [--license <spdx>] [--tag <tag>] [--scope <org>]" },
  propose: { options: proposeOptions, run: propose, usage: "kit propose <@scope/name> --title '<title>' --why '<rationale>' [--dry-run] [--from <block dir>]" },
  status: { options: {}, run: status, usage: "kit status" },
  heartbeat: { options: heartbeatOptions, run: heartbeat, usage: "kit heartbeat [--quiet]" },
};

export const COMMAND_NAMES = Object.keys(COMMANDS);

export function helpText(): string {
  return [
    "kit: install whole features (blocks) into a project, deterministically, with a dry-run diff first.",
    "",
    ...Object.values(COMMANDS).map((c) => `  ${c.usage}`),
    "",
    "Global flags: --json (machine output; errors as {error:{code,message}}), --root <project dir> (default: cwd).",
    "A block spec starting with @ is a registry reference; anything else is a local block directory (no server needed).",
    "Environment: KIT_TOKEN, KIT_API_URL, KIT_REGISTRY_PUBLIC_KEY, KIT_SCOPE, KIT_HOME (default ~/.kit).",
  ].join("\n");
}

export async function run(argv: string[], io: Io): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === "help" || name === "--help" || name === "-h") {
    line(io, helpText());
    return name ? 0 : 2;
  }
  if (name === "--version" || name === "version") {
    line(io, "kit 0.1.0");
    return 0;
  }
  const cmd = COMMANDS[name];
  if (!cmd) {
    io.err(`kit: unknown command ${JSON.stringify(sanitizeLine(name, 40))}\n\n${helpText()}\n`);
    return 2;
  }
  let a: Parsed | undefined;
  try {
    a = parse(rest, cmd.options);
    if (a.values.help) {
      line(io, `usage: ${cmd.usage}`);
      return 0;
    }
    return await cmd.run(io, a);
  } catch (e) {
    const asJson = a?.values.json === true || rest.includes("--json");
    if (e instanceof UsageError) {
      if (asJson) json(io, errorEnvelope("invalid_params", e.message));
      else io.err(`kit ${name}: ${sanitizeLine(e.message)}\nusage: ${cmd.usage}\n`);
      return 2;
    }
    if (e instanceof KitError) {
      const details = e.details;
      if (asJson) {
        const extra: Record<string, unknown> = {};
        if (e.code === "conflicts" && Array.isArray(details)) extra.conflicts = details;
        if (e.code === "scan_refused" && Array.isArray(details)) extra.findings = details;
        json(io, errorEnvelope(e.code, e.message, extra));
      } else {
        io.err(`kit ${name}: error [${e.code}]: ${sanitizeLine(e.message, 1000)}\n`);
        if (Array.isArray(details)) {
          for (const d of details.slice(0, 20)) {
            const o = d as Record<string, unknown>;
            io.err(`  - ${sanitizeLine([o.kind ?? o.rule ?? o.severity, o.name ?? o.path, o.detail].filter(Boolean).join(" "))}${o.resolve_with_param ? ` (resolve with --param ${sanitizeLine(o.resolve_with_param)}=…)` : ""}\n`);
          }
        }
      }
      return 1;
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (asJson) json(io, errorEnvelope("internal", msg));
    else io.err(`kit ${name}: ${sanitizeLine(msg, 1000)}\n`);
    return 1;
  }
}
