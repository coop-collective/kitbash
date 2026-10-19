import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { scrubbedEnv } from "@kitbash/cli";
export const cleanEnv = () => ({
  ...scrubbedEnv(process.env),
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function signalOwnedGroup(child, signal = "SIGTERM") {
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
export async function stopOwnedGroup(child) {
  signalOwnedGroup(child);
  await pause(100);
  signalOwnedGroup(child, "SIGKILL");
}
export async function command(
  file,
  args,
  { cwd, log, timeout = 180000, input } = {},
) {
  const start = Date.now(),
    child = spawn(file, args, {
      cwd,
      env: cleanEnv(),
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    }),
    output = log ? createWriteStream(log) : null;
  let stdout = "",
    stderr = "",
    timedOut = false;
  const timer = setTimeout(() => {
      timedOut = true;
      signalOwnedGroup(child);
    }, timeout),
    escalation = setTimeout(
      () => signalOwnedGroup(child, "SIGKILL"),
      timeout + 2000,
    );
  child.stdout.on("data", (chunk) => {
    stdout = (stdout + chunk).slice(-16 * 1024 * 1024);
    output?.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-1024 * 1024);
  });
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  child.once("exit", () => {
    void stopOwnedGroup(child);
  });
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  try {
    const result = await completion;
    await stopOwnedGroup(child);
    if (output) {
      output.end();
      await finished(output);
    }
    return { ...result, timedOut, wallMs: Date.now() - start, stdout, stderr };
  } finally {
    clearTimeout(timer);
    clearTimeout(escalation);
    if (!output?.writableFinished) output?.destroy();
  }
}
