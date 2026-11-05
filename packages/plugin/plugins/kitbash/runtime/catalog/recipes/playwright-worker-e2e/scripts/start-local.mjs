import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.E2E_PORT ?? "8797");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid E2E_PORT");
const state = await mkdtemp(path.join(tmpdir(), "kitbash-browser-d1-"));
const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
let child;
let stopping = false;
const stop = () => { stopping = true; child?.kill("SIGTERM"); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const run = (args) => new Promise((resolve, reject) => {
  child = spawn(process.execPath, [wrangler, ...args], { cwd: root, stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
try {
  const migrated = await run(["d1", "migrations", "apply", "DB", "--local", "--persist-to", state]);
  if (migrated !== 0) throw new Error(`Local migrations failed (${migrated})`);
  if (!stopping) process.exitCode = await run(["dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", state]);
} finally {
  await rm(state, { recursive: true, force: true });
  if (stopping) process.exitCode = 0;
}
