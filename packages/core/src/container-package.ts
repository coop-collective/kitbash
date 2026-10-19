import semver from "semver";
import { KitError } from "./errors.ts";
import { tryDecodeUtf8, type FileData } from "./hash.ts";

/** Native container payloads own a subproject; the host's package.json stays planner-owned. */
export function isContainerPackage(target: string): boolean {
  return /^containers\/[a-z][a-z0-9-]{0,63}\/package\.json$/.test(target);
}

const FIELDS = new Set(["name", "version", "private", "type", "packageManager", "engines", "devEngines", "scripts", "dependencies", "devDependencies"]);
const SCRIPTS = new Set(["deps", "dev", "start", "build", "test", "typecheck", "lint", "coverage", "check"]);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Explicit tasks may run code, like traveling tests. Installation lifecycle hooks may not. */
export function containerPackageProblem(target: string, content: FileData): string | null {
  if (!isContainerPackage(target)) return null;
  let value: unknown;
  try { value = JSON.parse(tryDecodeUtf8(content) ?? ""); } catch { return "container package must be valid UTF-8 JSON"; }
  if (!object(value) || value.private !== true) return "container package must be an object with private: true";
  for (const key of Object.keys(value)) if (!FIELDS.has(key)) return `container package field ${key} is not supported`;
  if (typeof value.name !== "string" || !/^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(value.name)) return "container package needs an npm package name";
  if (value.version !== undefined && (typeof value.version !== "string" || !semver.valid(value.version))) return "container package version must be a semantic version";
  if (value.type !== undefined && value.type !== "module" && value.type !== "commonjs") return "invalid container package type";
  if (value.packageManager !== undefined && (typeof value.packageManager !== "string" || !/^pnpm@\d+\.\d+\.\d+$/.test(value.packageManager))) return "container packageManager must pin a pnpm version";
  if (value.scripts !== undefined) {
    if (!object(value.scripts)) return "container scripts must be an object";
    for (const [name, command] of Object.entries(value.scripts)) {
      if (!SCRIPTS.has(name) || typeof command !== "string" || !command.trim()) return `container script ${name} is not an explicit supported task`;
    }
  }
  for (const field of ["dependencies", "devDependencies", "engines"]) {
    const entries = value[field];
    if (entries === undefined) continue;
    if (!object(entries)) return `container ${field} must be an object`;
    for (const [name, range] of Object.entries(entries)) {
      if (!/^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name) || typeof range !== "string" || !semver.validRange(range)) return `container ${field}.${name} must use a registry semantic-version range`;
    }
  }
  if (value.devEngines !== undefined) {
    const engines = value.devEngines;
    if (!object(engines) || Object.keys(engines).join() !== "runtime" || !object(engines.runtime)) return "container devEngines supports only one pinned runtime";
    const runtime = engines.runtime;
    if (Object.keys(runtime).some(key => !["name", "version", "onFail"].includes(key)) || !["bun", "node"].includes(String(runtime.name)) || typeof runtime.version !== "string" || !semver.valid(runtime.version) || !["download", "error"].includes(String(runtime.onFail))) return "container runtime must pin bun/node with download or error policy";
  }
  return null;
}

export function assertContainerPackage(target: string, content: FileData): void {
  const problem = containerPackageProblem(target, content);
  if (problem) throw new KitError("forbidden", `${target}: ${problem}`, { rule: "container_package" });
}
