import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const { port } = reservation.address();
await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
const child = spawn("pnpm", ["run", "start", "--ip", "127.0.0.1", "--port", String(port)], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), WRANGLER_SEND_METRICS: "false" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",
});
const exited = new Promise((resolve) => child.once("exit", resolve));
let output = "";
for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { output = (output + data).slice(-12000); });
let spawnError;
child.on("error", (error) => { spawnError = error; });
try {
  const base = `http://127.0.0.1:${port}`;
  let response;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try { response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) }); } catch {}
    if (response?.ok) break;
    await delay(200);
  }
  assert.ok(response?.ok, `Server did not become ready: ${output}`);
  assert.deepEqual(await response.json(), { ok: true });
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<h1>__PROJECT_NAME__<\/h1>/);
  console.log(`HTTP smoke passed: ${base}/api/health`);
} finally {
  if (child.pid && child.exitCode === null) {
    const stop = (signal) => { try { process.platform === "win32" ? child.kill(signal) : process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; } };
    stop("SIGTERM");
    await Promise.race([exited, delay(5000)]);
    if (child.exitCode === null) stop("SIGKILL");
  }
}
