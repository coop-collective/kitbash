import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { validate } from "./run.mjs";
const project = process.argv[2];
if (!project)
  throw new Error(
    "Usage: node check-app.mjs APP_DIRECTORY (install its dependencies first)",
  );
const artifacts = await mkdtemp(path.join(os.tmpdir(), "kitchen-sink-check-"));
const checks = await validate(path.resolve(project), artifacts, 18879);
await writeFile(
  path.join(artifacts, "checks.json"),
  JSON.stringify(checks, null, 2),
);
console.log(JSON.stringify({ artifacts, checks }, null, 2));
if (
  !Object.values(checks).every((c) => c.passed === true || c.passed === c.total)
)
  process.exitCode = 1;
