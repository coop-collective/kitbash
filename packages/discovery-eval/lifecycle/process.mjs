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
const active = new Map();
const stopping = new WeakMap();
let shuttingDown = false;

export function signalOwnedGroup(child, signal = "SIGTERM") {
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

// Idempotent even when exit, timeout and MCP shutdown race. Only groups created
// by this harness are accepted here; callers own any externally supplied child.
export function stopOwnedGroup(child) {
  if (!stopping.has(child)) {
    stopping.set(child, (async () => {
      signalOwnedGroup(child);
      await pause(150);
      signalOwnedGroup(child, "SIGKILL");
    })());
  }
  return stopping.get(child);
}

export async function stopAllOwnedGroups() {
  shuttingDown = true;
  const owned = [...active.entries()];
  await Promise.all(owned.map(([child]) => stopOwnedGroup(child)));
  // command() resolves its done marker only after close and log flushing.
  await Promise.all(owned.map(([, done]) => done));
}

/** Install only in a standalone runner/server, never as an import side effect. */
export function installLifecycleCleanup({ onShutdown, watchStdin = false } = {}) {
  const parentPid = process.ppid;
  let ending;
  const shutdown = (code = 0) => {
    if (!ending) ending = (async () => {
      try {
        await stopAllOwnedGroups();
        await onShutdown?.();
      } catch (error) {
        process.stderr.write(`Lifecycle cleanup failed: ${error.message}\n`);
        code = 1;
      }
      process.exit(code);
    })();
    return ending;
  };
  const handlers = {
    SIGTERM: () => void shutdown(143),
    SIGINT: () => void shutdown(130),
    SIGHUP: () => void shutdown(129),
    disconnect: () => void shutdown(),
  };
  for (const [event, handler] of Object.entries(handlers)) process.on(event, handler);
  const disconnected = () => void shutdown();
  if (watchStdin) process.stdin.on("end", disconnected);
  const timer = setInterval(() => {
    let parentGone = process.ppid !== parentPid;
    try { process.kill(parentPid, 0); } catch (error) {
      if (error.code === "ESRCH") parentGone = true;
    }
    if (parentGone) void shutdown();
  }, 250);
  timer.unref();
  return () => {
    clearInterval(timer);
    for (const [event, handler] of Object.entries(handlers)) process.off(event, handler);
    if (watchStdin) process.stdin.off("end", disconnected);
  };
}

const tail = (previous, chunk, limit) => {
  if (chunk.length >= limit) return Buffer.from(chunk.subarray(chunk.length - limit));
  const keep = Math.min(previous.length, limit - chunk.length);
  return Buffer.concat([previous.subarray(previous.length - keep), chunk]);
};

export async function command(file, args, {
  cwd, log, timeout = 180000, input,
  maxOutputBytes = 16 * 1024 * 1024,
  maxLogBytes = 64 * 1024 * 1024,
} = {}) {
  if (shuttingDown) throw new Error("Process owner is shutting down");
  for (const [name, value] of Object.entries({ timeout, maxOutputBytes, maxLogBytes })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
  }
  const start = Date.now();
  const child = spawn(file, args, {
    cwd, env: cleanEnv(), detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"], shell: false,
  });
  let markDone;
  active.set(child, new Promise((resolve) => { markDone = resolve; }));
  const output = log ? createWriteStream(log) : null;
  let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0);
  let stdoutBytes = 0, stderrBytes = 0, logBytes = 0, timedOut = false;
  let logError;
  const stop = () => { void stopOwnedGroup(child).catch((error) => {
    process.stderr.write(`Owned process cleanup failed: ${error.message}\n`);
  }); };
  output?.on("error", (error) => { logError = error; child.stdout.resume(); stop(); });
  child.stdout.on("data", (chunk) => {
    stdoutBytes += chunk.length;
    stdout = tail(stdout, chunk, maxOutputBytes);
    if (output && !logError && logBytes < maxLogBytes) {
      const bytes = chunk.subarray(0, maxLogBytes - logBytes);
      logBytes += bytes.length;
      if (!output.write(bytes)) {
        child.stdout.pause();
        output.once("drain", () => child.stdout.resume());
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
    stderr = tail(stderr, chunk, Math.min(maxOutputBytes, 1024 * 1024));
  });
  const completion = new Promise((resolve) => {
    let spawnError;
    child.once("error", (error) => { spawnError = error; });
    child.once("close", (code, signal) => resolve({
      code: spawnError ? 127 : code, signal,
      ...(spawnError ? { error: spawnError.message } : {}),
    }));
  });
  child.once("exit", stop); // Also closes inherited pipes held by descendants.
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
  try {
    const result = await completion;
    await stopOwnedGroup(child);
    if (output) {
      output.end();
      await finished(output);
      if (logError) throw logError;
    }
    return {
      ...result, timedOut, wallMs: Date.now() - start,
      stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"),
      stdoutBytes, stderrBytes,
      stdoutTruncated: stdoutBytes > stdout.length,
      stderrTruncated: stderrBytes > stderr.length,
      logTruncated: !!output && stdoutBytes > logBytes,
    };
  } finally {
    clearTimeout(timer);
    if (!output?.writableFinished) output?.destroy();
    active.delete(child);
    markDone();
  }
}
