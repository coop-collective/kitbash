import { spawn, spawnSync } from "node:child_process";
import { readFileSync, realpathSync, existsSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { selectProjects, validateProjects, runBounded } from "./plan.mjs";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("unavailable git history");
  return result.stdout;
}

function changedSince(ref) {
  if (!ref) return null;
  try {
    // --end-of-options prevents a ref supplied by a caller from becoming a git flag.
    const commit = git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).trim();
    const base = git(["merge-base", commit, "HEAD"]).trim();
    const prefix = git(["rev-parse", "--show-prefix"]).trim();
    const files = [
      ...git(["diff", "--name-only", "--no-renames", "-z", base, "--"]).split("\0"),
      ...git(["ls-files", "--others", "--exclude-standard", "--full-name", "-z"]).split("\0"),
    ].filter(Boolean);
    // Changes outside a nested recipe/project also cause a full check.
    return files.map(file => file.startsWith(prefix) ? file.slice(prefix.length) : file);
  } catch {
    console.error("Git baseline unavailable; checking all projects.");
    return null;
  }
}

async function main() {
  let since;
  let concurrency = 2;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--since" && args[i + 1]) since = args[++i];
    else if (args[i] === "--concurrency" && args[i + 1]) concurrency = Number(args[++i]);
    else throw new Error("Usage: node scripts/typecheck.mjs [--since REF] [--concurrency 1..32]");
  }
  const root = realpathSync(process.cwd());
  const { projects } = JSON.parse(readFileSync("typecheck.projects.json", "utf8"));
  validateProjects(projects);
  for (const project of projects) {
    const config = realpathSync(resolve(root, project.path, "tsconfig.json"));
    const rel = relative(root, config);
    if (rel.startsWith(`..${sep}`) || rel === "..") throw new Error("project escapes root");
  }
  const compiler = resolve(root, "node_modules/.bin/tsc");
  if (!existsSync(compiler)) throw new Error("Missing local compiler; install locked dependencies first");
  const selected = selectProjects(projects, changedSince(since));
  const results = await runBounded(selected, concurrency, project => new Promise(resolveResult => {
    console.log(`Checking ${project.name}`);
    const child = spawn(compiler, ["-p", "tsconfig.json", "--noEmit"], { cwd: resolve(root, project.path), stdio: "inherit" });
    child.once("error", () => resolveResult(1));
    child.once("close", code => resolveResult(code ?? 1));
  }));
  if (results.some(code => code !== 0)) process.exitCode = 1;
  console.log(`Checked ${selected.length}/${projects.length} projects`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
