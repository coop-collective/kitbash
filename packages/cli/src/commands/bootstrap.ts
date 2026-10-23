import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rmdir, rm, writeFile, copyFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { KitError, newProjectId, readLock, writeProfile, type ProjectProfile } from "@kitbash/core";
import { nodeFs } from "@kitbash/core/node";
import { bool, int, list, oneOf, params, str, type Parsed } from "../args.ts";
import { json, line, type Io } from "../io.ts";
import { install } from "./install.ts";
import { catalogRoot, copyAssets, loadPreset, PRESETS, type Preset } from "../bootstrap/catalog.ts";
import { command, httpsOrigin, setupRepository, validateRepository, type RepositoryOptions } from "../bootstrap/repository.ts";
import { configureWorker } from "../bootstrap/worker.ts";

export const bootstrapOptions = {
  preset: { type: "string" }, list: { type: "boolean" }, blocks: { type: "string", multiple: true },
  param: { type: "string", multiple: true }, yes: { type: "boolean" }, name: { type: "string" },
  host: { type: "string" }, port: { type: "string" }, hostname: { type: "string" },
  "git-host": { type: "string" }, repo: { type: "string" }, "create-repo": { type: "boolean" },
  visibility: { type: "string" }, "gitstalk-url": { type: "string" }, "no-git": { type: "boolean" },
  install: { type: "boolean" }, "infisical-project": { type: "string" }, "infisical-domain": { type: "string" },
} as const;

interface Selection { name: string; variant?: string }

function selections(values: string[], preset: Preset): Selection[] {
  const selected = new Set<string>();
  return values.map(value => {
    const match = /^([a-z][a-z0-9-]*)(?::([a-z][a-z0-9-]*))?$/.exec(value);
    if (!match || !preset.compatibleBlocks.includes(match[1]!)) {
      throw new KitError("invalid_params", `${value} is not a compatible block for ${preset.id}. Run kit bootstrap --list --preset ${preset.id}.`);
    }
    const name = match[1]!;
    if (selected.has(name)) throw new KitError("invalid_params", `Choose only one variant of ${name}`);
    selected.add(name);
    return { name, ...(match[2] ? { variant: match[2] } : {}) };
  });
}

async function destinationAvailable(destination: string): Promise<boolean> {
  const info = await lstat(destination).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (info === null) return false;
  if (!info.isDirectory() || info.isSymbolicLink() || (await readdir(destination)).length) {
    throw new KitError("conflicts", "Bootstrap requires a new or empty directory; existing files are never overwritten.");
  }
  return true;
}

function localHost(value: string): string {
  if (!/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?|::1|::)$/.test(value)) throw new KitError("invalid_params", "--host must be a hostname or IP address");
  return value;
}

function domainName(value: string | undefined): string | undefined {
  if (value && (value.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value))) {
    throw new KitError("invalid_params", "--hostname must be a DNS name, without a scheme or path");
  }
  return value;
}

async function blockCatalog(root: string, preset: Preset) {
  return Promise.all(preset.compatibleBlocks.map(async name => {
    const m = JSON.parse(await readFile(path.join(root, "blocks", name, "block.json"), "utf8"));
    return { name, title: m.title, variants: m.variants.map((v: { id: string }) => v.id) };
  }));
}

async function configureSecrets(stage: string, ids: string[], root: string, a: Parsed, preset: Preset, name: string) {
  const file = path.join(stage, ".kitbash/secrets.json");
  const config = JSON.parse(await readFile(file, "utf8"));
  if (str(a, "infisical-project")) config.projectId = str(a, "infisical-project");
  if (str(a, "infisical-domain")) config.domain = httpsOrigin(str(a, "infisical-domain")!, "--infisical-domain");
  if (preset.id === "rust-server") config.targets.local.localFile = ".env.local";
  if (preset.id === "vinext") {
    for (const target of ["staging", "production"]) Object.assign(config.targets[target], {
      flattenedConfig: true, wranglerConfig: "dist/server/wrangler.json", workerName: `${name}-${target}`,
    });
  }
  for (const id of ids) {
    const name = id.split("/")[1]!;
    const manifest = JSON.parse(await readFile(path.join(root, "blocks", name, "block.json"), "utf8"));
    for (const secret of manifest.secrets ?? []) {
      const migration = /PEPPER|JWT|SESSION|SIGNING|ENCRYPTION/.test(secret.name);
      config.secrets[secret.name] = { required: secret.required !== false, generate: /openssl rand|crypto\.random/i.test(secret.obtain ?? ""), rotation: migration ? "migration-required" : "manual" };
    }
  }
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
}

async function addBlocks(stage: string, catalog: string, preset: Preset, chosen: Selection[], a: Parsed, io: Io) {
  const allParams = params(a);
  for (const block of chosen) {
    const current = await readLock(nodeFs(stage));
    const installed = Object.entries(current.blocks).find(([id]) => id.split("/")[1] === block.name)?.[1];
    if (installed) {
      if (block.variant && installed.variant !== block.variant) throw new KitError("conflicts", `${block.name} was installed as a dependency with variant ${installed.variant}; cannot also install ${block.variant}`);
      continue;
    }
    let output = "";
    const manifest = JSON.parse(await readFile(path.join(catalog, "blocks", block.name, "block.json"), "utf8"));
    const blockParams = Object.entries(allParams).map(([key, value]) => `${key.startsWith(`${block.name}.`) ? key.slice(block.name.length + 1) : key}=${value}`);
    const code = await install({ ...io, cwd: stage, out: s => { output += s; } }, {
      positionals: [path.join(catalog, "blocks", block.name)],
      values: {
        apply: true, json: true, param: blockParams,
        ...(block.variant ? { variant: block.variant } : preset.id === "vinext" ? { variant: manifest.variants[0].id } : {}),
      },
    });
    if (code !== 0) {
      const result = JSON.parse(output);
      throw new KitError("conflicts", `Cannot install ${block.name}: ${result.error?.message ?? JSON.stringify(result.conflicts ?? result)}. No project was created.`);
    }
  }
  const lock = await readLock(nodeFs(stage));
  const sources: Record<string, { kind: "local"; path: string }> = {};
  for (const id of Object.keys(lock.blocks)) {
    const name = id.split("/")[1]!;
    const relative = `.kit/catalog/blocks/${name}`;
    await copyAssets(path.join(catalog, "blocks", name), path.join(stage, relative));
    sources[id] = { kind: "local", path: relative };
  }
  await writeFile(path.join(stage, ".kit/sources.json"), `${JSON.stringify(sources, null, 2)}\n`);
  return lock;
}

export async function bootstrap(io: Io, a: Parsed): Promise<number> {
  const catalog = await catalogRoot(io.env.KIT_CATALOG_ROOT);
  if (bool(a, "list")) {
    const presets = await Promise.all(PRESETS.map(id => loadPreset(catalog, id)));
    const selected = str(a, "preset") ? await loadPreset(catalog, str(a, "preset")!) : null;
    const result = { presets, ...(selected ? { blocks: await blockCatalog(catalog, selected) } : {}) };
    if (bool(a, "json")) json(io, result);
    else {
      for (const p of presets) line(io, `${p.id}: ${p.description}`);
      if (result.blocks) for (const b of result.blocks) line(io, `  ${b.name} (${b.variants.join(", ")}): ${b.title}`);
    }
    return 0;
  }
  if (a.positionals.length > 1) throw new KitError("invalid_params", "Expected one destination directory");
  const ask = !bool(a, "yes") && !bool(a, "json") ? io.prompt : undefined;
  const directory = a.positionals[0] ?? (ask ? (await ask("Project directory [my-app]: ")).trim() || "my-app" : undefined);
  if (!directory) throw new KitError("invalid_params", "Provide a destination directory (or use an interactive terminal)");
  const presetId = str(a, "preset") ?? (ask ? (await ask(`Preset (${PRESETS.join(", ")}) [worker]: `)).trim() || "worker" : undefined);
  if (!presetId) throw new KitError("invalid_params", "--preset is required in noninteractive mode");
  const preset = await loadPreset(catalog, presetId);
  let selected = list(a, "blocks");
  if (a.values.blocks === undefined && ask && preset.compatibleBlocks.length) {
    line(io, `Available blocks: ${preset.compatibleBlocks.join(", ")}`);
    selected = (await ask("Preinstall blocks (comma separated; name:variant; empty for none): ")).split(",").map(v => v.trim()).filter(Boolean);
  }
  const chosen = selections(selected, preset);
  const parent = path.resolve(io.cwd, str(a, "root") ?? ".");
  const destination = path.resolve(parent, directory);
  const name = str(a, "name") ?? path.basename(destination);
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(name)) throw new KitError("invalid_params", "--name must be a lowercase project slug (letters, digits, hyphens; starts with a letter)");
  const host = localHost(str(a, "host") ?? preset.defaultHost);
  const port = int(str(a, "port"), "--port", 1, 65535) ?? preset.defaultPort;
  const hostname = domainName(str(a, "hostname"));
  if (hostname && preset.id === "rust-server") throw new KitError("invalid_params", "The local Rust preset uses --host/--port; --hostname configures a Cloudflare custom domain");
  const git: RepositoryOptions = {
    host: oneOf(str(a, "git-host") ?? (ask ? (await ask("Git host (local, github, gitstalk) [local]: ")).trim() || "local" : undefined), ["local", "github", "gitstalk"] as const, "--git-host") ?? "local",
    repo: str(a, "repo"), create: bool(a, "create-repo"),
    visibility: oneOf(str(a, "visibility"), ["private", "public"] as const, "--visibility") ?? "private",
    gitstalkUrl: httpsOrigin(str(a, "gitstalk-url") ?? "https://gitstalk.io", "--gitstalk-url"), noGit: bool(a, "no-git"),
  };
  if (git.host !== "local" && !git.repo && ask) git.repo = (await ask("Repository (owner/name): ")).trim();
  validateRepository(git);
  if (str(a, "infisical-project") && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(str(a, "infisical-project")!)) {
    throw new KitError("invalid_params", "--infisical-project must be an Infisical project UUID, not its slug");
  }
  if (str(a, "infisical-domain")) httpsOrigin(str(a, "infisical-domain")!, "--infisical-domain");
  await destinationAvailable(destination);
  await mkdir(path.dirname(destination), { recursive: true });
  const stage = await mkdtemp(path.join(path.dirname(destination), ".kit-bootstrap-"));
  let blockIds: string[] = [];
  let pending: { block: string; items: string[] }[] = [];
  try {
    const replacements = { __PROJECT_NAME__: name, __HOST__: host, __PORT__: String(port), __COMPATIBILITY_DATE__: preset.compatibilityDate ?? io.now().slice(0, 10) };
    await copyAssets(path.join(catalog, "bootstraps/shared/files"), stage, replacements);
    await copyAssets(path.join(catalog, "bootstraps", preset.id, "files"), stage, replacements);
    const profile: ProjectProfile = { ...preset.profile, project_id: newProjectId() };
    await writeProfile(nodeFs(stage), profile);
    const lock = await addBlocks(stage, catalog, preset, chosen, a, io);
    blockIds = Object.keys(lock.blocks);
    pending = blockIds.map(id => ({ block: id, items: Object.entries(lock.blocks[id]!.adapt).filter(([, status]) => status === "pending").map(([item]) => item) })).filter(item => item.items.length);
    await configureSecrets(stage, blockIds, catalog, a, preset, name);
    const packagePath = path.join(stage, "package.json");
    const pkg = JSON.parse(await readFile(packagePath, "utf8"));
    for (const task of ["create", "import", "generate", "rotate", "doctor", "run"]) pkg.scripts[`secrets:${task}`] = `node scripts/secrets.mjs ${task}`;
    pkg.scripts["secrets:local"] = "node scripts/secrets.mjs local --env local";
    await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
    await appendFile(path.join(stage, ".gitignore"), "\n.kitbash-secrets-*/\n.kit/plans/\n");
    if (git.host !== "local") {
      await mkdir(path.join(stage, ".github/workflows"), { recursive: true });
      const checks = await readFile(path.join(catalog, "bootstraps/shared/workflows/github-ci.yml"), "utf8");
      // Gitstalk runs Actions on validated main pushes; it has no pull_request event.
      await writeFile(path.join(stage, ".github/workflows/check.yml"), git.host === "github" ? checks : checks.replace("  pull_request:\n", ""));
      if (git.host === "github" && preset.id !== "rust-server") await copyFile(path.join(catalog, "bootstraps/shared/workflows/github-deploy.yml"), path.join(stage, ".github/workflows/deploy.yml"));
    }
    if (git.host === "gitstalk" && preset.id !== "rust-server") {
      await mkdir(path.join(stage, ".gitstalk/automations"), { recursive: true });
      await copyFile(path.join(catalog, "bootstraps/shared/workflows/gitstalk-deploy.yml"), path.join(stage, ".gitstalk/automations/deploy-staging.yml"));
    }
    await copyAssets(path.join(catalog, "skills"), path.join(stage, ".kit/skills"));
    await configureWorker(stage, profile, name, lock, hostname);
    await writeFile(path.join(stage, ".kit/bootstrap.json"), `${JSON.stringify({ version: 1, preset: preset.id, created_at: io.now(), name, host, port, hostname, blocks: chosen, git_host: git.host }, null, 2)}\n`);
    await mkdir(path.join(stage, ".kit/verification"), { recursive: true });
    await writeFile(path.join(stage, ".kit/verification/README.md"), `# ${name} verification\n\nStart with the generated README and package scripts. Run pnpm check and the preset's health test.\n\nUse pstack's create-verification-skill to add real feature journeys after implementation: launch, readiness, drive, assertions, evidence, cleanup. Record the commit/environment with artifacts outside git.\n\nInstalled block adaptation is tracked in .kit/lock.json; pending items are not completed features. Maintenance skills under .kit/skills are explicit post-merge reviews and are not default implementation instructions.\n`);
    if (await destinationAvailable(destination)) await rmdir(destination);
    await rename(stage, destination);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  if (bool(a, "install")) await command(io, destination, "pnpm", ["install", "--no-frozen-lockfile"]);
  const repository = await setupRepository(io, destination, git);
  const next = ["pnpm install (if dependencies were not installed)", "pnpm check", "pnpm dev", "Configure .kitbash/secrets.json, then use pnpm secrets:local", ...(pending.length ? ["Complete installed blocks' adaptation checklists with kit status"] : [])];
  const result = { directory: destination, preset: preset.id, blocks: blockIds, pending_adapt: pending, git: repository, next_steps: next };
  if (bool(a, "json")) json(io, result);
  else {
    line(io, `Created ${destination} (${preset.id})${blockIds.length ? ` with ${blockIds.length} blocks` : ""}.`);
    for (const step of next) line(io, `  ${step}`);
    if (repository.remote) line(io, `origin: ${repository.remote}${repository.created ? " (repository created)" : " (remote configured; repository not created)"}`);
  }
  return 0;
}
