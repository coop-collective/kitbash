#!/usr/bin/env node
// SessionStart, in this order:
// 1. Always: print the core rules in ../rules/*.md as session context. Claude Code and Codex both read
//    `hookSpecificOutput.additionalContext` from a SessionStart hook's stdout and add it to the session. These are
//    the rules every coding agent follows in every project, so they do not depend on .kit/ or on telemetry.
// 2. `kit heartbeat --quiet`, only when .kit/lock.json exists and the project turned telemetry on
//    (.kit/project.json "telemetry": true). Silent, and fast when it does not apply.
// The hook never fails the session: a missing rule file or an unreachable registry prints nothing and exits 0.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

try {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rules");
  const rules = fs.readdirSync(dir).filter((name) => name.endsWith(".md")).sort().map((name) => fs.readFileSync(path.join(dir, name), "utf8").trim()).filter(Boolean);
  if (rules.length) {
    const additionalContext = `Kitbash core rules. Follow them in every task in this session.\n\n${rules.join("\n\n")}\n`;
    // writeSync: process.exit below must not drop a pending asynchronous write to a pipe.
    fs.writeSync(1, `${JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } })}\n`);
  }
} catch {
  /* a missing or unreadable rule never disturbs the session */
}

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
