import assert from "node:assert/strict";

const fmt = result => `exit ${result.code}\n${result.out}\n${result.err}`.slice(-4000);
const offlineMiss = result => /ERR_PNPM_NO_OFFLINE_(?:META|TARBALL)\b/.test(`${result.out}\n${result.err}`);

/** Install a standalone copy, then prove its newly created/updated lockfile is reproducible. */
export async function installStandalone(run, { cwd, allowOnline = true }) {
  // The copy is outside the repository. Keep its local workspace config active so
  // pnpm honors allowBuilds; --ignore-workspace would also ignore that config.
  const flags = ["install", "--no-frozen-lockfile", "--config.confirmModulesPurge=false"];
  let result = await run("pnpm", [...flags, "--offline"], { cwd });
  if (result.code !== 0 && allowOnline && offlineMiss(result)) result = await run("pnpm", flags, { cwd });
  assert.equal(result.code, 0, `standalone pnpm install failed: ${fmt(result)}`);
  const locked = await run("pnpm", ["install", "--offline", "--frozen-lockfile", "--config.confirmModulesPurge=false"], { cwd });
  assert.equal(locked.code, 0, `standalone frozen pnpm install failed: ${fmt(locked)}`);
}
