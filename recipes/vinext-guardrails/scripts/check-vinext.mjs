import { readFileSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { resolve, join, relative, isAbsolute, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { parse } from "jsonc-parser";

const exactVersion = /^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/;

export function inspectConfiguration(pkg, config) {
  const errors = [];
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of ["vinext", "react", "react-dom", "@cloudflare/vite-plugin"]) {
    if (!exactVersion.test(deps[name] ?? "")) errors.push(`Pin ${name} to an exact tested version`);
  }
  if (deps.react !== deps["react-dom"]) errors.push("React and React DOM versions must match");
  if (deps["react-server-dom-webpack"] && deps["react-server-dom-webpack"] !== deps.react) {
    errors.push("React Server DOM Webpack must match React when directly installed");
  }
  if (deps["@opennextjs/cloudflare"]) errors.push("Remove the old OpenNext adapter after completing the migration");
  const build = pkg.scripts?.build ?? "";
  if (!/\b(?:vite|vinext)\s+build\b/.test(build) || /\bnext\s+build\b/.test(build)) errors.push("Production build must use Vite/vinext");
  if (!config.compatibility_flags?.includes("nodejs_compat")) errors.push("Enable nodejs_compat for this Workers App Router profile");
  if (config.assets?.not_found_handling !== "none") errors.push("Use assets.not_found_handling=none so missing assets reach framework routing");
  if (!config.observability?.enabled || !config.observability?.traces?.enabled) errors.push("Enable Worker logs and traces");
  if (typeof config.main !== "string" || !config.main) errors.push("Declare the source Worker entrypoint");
  return errors;
}

export function inspectClient(directory, maxGzipBytes) {
  if (!Number.isSafeInteger(maxGzipBytes) || maxGzipBytes < 1) throw new Error("Budget must be a positive integer number of bytes");
  let bytes = 0;
  let files = 0;
  function walk(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error("Client artifacts must not contain symlinks");
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) walk(join(path, name));
    } else if (/\.(?:m?js)$/.test(path)) {
      bytes += gzipSync(readFileSync(path)).byteLength;
      files++;
    }
  }
  walk(directory);
  if (files === 0) throw new Error("No client JavaScript found; build before checking the artifact");
  return { files, gzipBytes: bytes, budget: maxGzipBytes, passed: bytes <= maxGzipBytes };
}

export function checkProject(root, maxGzipBytes) {
  root = realpathSync(root);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const parseErrors = [];
  const config = parse(readFileSync(join(root, "wrangler.jsonc"), "utf8"), parseErrors, { allowTrailingComma: true });
  if (parseErrors.length || !config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid wrangler.jsonc");
  const errors = inspectConfiguration(pkg, config);
  const directory = config.assets?.directory;
  if (typeof directory !== "string" || !directory || isAbsolute(directory)) throw new Error("Declare a project-relative client assets directory");
  // Resolve the entire path to prevent intermediate symlinks escaping the project.
  const client = realpathSync(resolve(root, directory));
  const rel = relative(root, client);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Client directory escapes project");
  const size = inspectClient(client, maxGzipBytes);
  if (!size.passed) errors.push(`Client JavaScript gzip total ${size.gzipBytes} exceeds ${size.budget} bytes`);
  return { errors, size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: node check-vinext.mjs PROJECT_ROOT MAX_GZIP_BYTES");
    const result = checkProject(process.argv[2], Number(process.argv[3]));
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
