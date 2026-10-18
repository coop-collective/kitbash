#!/usr/bin/env node
// SessionStart: `kit heartbeat --quiet`, only when .kit/lock.json exists and the project turned telemetry on
// (.kit/project.json "telemetry": true). Silent, fast when it does not apply, and it never fails the session.
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
try {
  const hasLock = fs.existsSync(path.join(cwd, ".kit", "lock.json"));
  const telemetry = hasLock && JSON.parse(fs.readFileSync(path.join(cwd, ".kit", "project.json"), "utf8")).telemetry === true;
  if (telemetry) {
    const { loadKit } = await import(new URL("../scripts/load-kit.mjs", import.meta.url).href);
    const kit = await loadKit();
    await Promise.race([kit.heartbeat({ cwd }), new Promise((r) => setTimeout(r, 8000))]);
  }
} catch {
  /* a hook never disturbs the session */
}
process.exit(0);
