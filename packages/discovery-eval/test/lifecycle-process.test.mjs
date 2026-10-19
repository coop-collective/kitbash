import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { command, cleanEnv, stopOwnedGroup } from "../lifecycle/process.mjs";

const moduleUrl = new URL("../lifecycle/process.mjs", import.meta.url).href;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) {
  if (error.code === "ESRCH") return false;
  throw error;
} };
async function eventually(fn, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const result = await fn(); if (result) return result; } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out: ${label}`);
}
const readPid = (file) => eventually(async () => Number(await readFile(file, "utf8")), "child PID");

test("command bounds captured output, flushes its capped log, and preserves timeout status", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lifecycle-output-"));
  try {
    const log = path.join(directory, "output.log");
    const result = await command(process.execPath, ["-e", "process.stdout.write('é'.repeat(10000));process.stderr.write('e'.repeat(5000))"], {
      log, maxOutputBytes: 1024, maxLogBytes: 2048,
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdoutBytes, 20000);
    assert.equal(Buffer.byteLength(result.stdout), 1024);
    assert.equal(result.stdoutTruncated, true);
    assert.equal(result.stderrTruncated, true);
    assert.equal(result.logTruncated, true);
    assert.equal((await readFile(log)).length, 2048);
    const timeout = await command(process.execPath, ["-e", "process.on('SIGTERM',()=>{console.log('term received');process.exit(0)});setInterval(()=>{},1000)"], { timeout: 200 });
    assert.equal(timeout.timedOut, true);
    assert.equal(timeout.code, 0, "a graceful exit after deadline remains a timeout");
    assert.match(timeout.stdout, /term received/);
    const absent = await command(path.join(directory, "missing-program"), []);
    assert.equal(absent.code, 127);
    assert.equal(absent.timedOut, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a nested failing node test executes independently and inherited-stdio descendants are reaped", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lifecycle-child-"));
  try {
    await writeFile(path.join(directory, "fail.test.mjs"), "import {test} from 'node:test';test('nested sentinel',()=>{throw Error('expected failure')})");
    const failed = await command(process.execPath, ["--test", "fail.test.mjs"], { cwd: directory });
    assert.equal(failed.code, 1);
    assert.match(failed.stdout, /nested sentinel/);
    const result = await command(process.execPath, ["-e", "const{spawn}=require('node:child_process');spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});setTimeout(()=>process.exit(0),60)"], { timeout: 2500 });
    assert.equal(result.code, 0);
    assert.equal(result.timedOut, false);
    assert.ok(result.wallMs < 2000);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const mode of ["SIGTERM", "disconnect", "stdin-end"]) {
  test(`owner ${mode} terminates its separate command group and flushes logs`, { skip: process.platform === "win32", timeout: 10000 }, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "lifecycle-stop-"));
    const pidFile = path.join(directory, "pid"), log = path.join(directory, "command.log");
    const worker = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));console.log('ready');setInterval(()=>{},1000)`;
    const source = `import {command,installLifecycleCleanup} from ${JSON.stringify(moduleUrl)};installLifecycleCleanup({watchStdin:true});process.stdin.resume();await command(process.execPath,['-e',${JSON.stringify(worker)}],{log:${JSON.stringify(log)},timeout:30000});`;
    const owner = spawn(process.execPath, ["--input-type=module", "-e", source], {
      detached: true, env: cleanEnv(), stdio: ["pipe", "pipe", "pipe", "ipc"],
    });
    const closed = once(owner, "exit");
    let workerPid;
    try {
      workerPid = await readPid(pidFile);
      assert.equal(alive(workerPid), true);
      await eventually(async () => (await readFile(log, "utf8")).includes("ready"), "ready output");
      if (mode === "disconnect") owner.disconnect();
      else if (mode === "stdin-end") owner.stdin.end();
      else owner.kill("SIGTERM");
      const [code] = await closed;
      assert.equal(code, mode === "SIGTERM" ? 143 : 0);
      await eventually(() => !alive(workerPid), "detached command exit");
      assert.match(await readFile(log, "utf8"), /ready/);
    } finally {
      await stopOwnedGroup(owner);
      if (workerPid && alive(workerPid)) process.kill(workerPid, "SIGKILL");
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("parent death is detected even when it cannot deliver a shutdown signal", { skip: process.platform === "win32", timeout: 10000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lifecycle-orphan-"));
  const workerFile = path.join(directory, "worker"), ownerFile = path.join(directory, "owner");
  const worker = `require('node:fs').writeFileSync(${JSON.stringify(workerFile)},String(process.pid));setInterval(()=>{},1000)`;
  const ownerSource = `import{writeFileSync}from'node:fs';import{command,installLifecycleCleanup}from${JSON.stringify(moduleUrl)};installLifecycleCleanup();writeFileSync(${JSON.stringify(ownerFile)},String(process.pid));await command(process.execPath,['-e',${JSON.stringify(worker)}],{timeout:30000});`;
  const parentSource = `const{spawn}=require('node:child_process');spawn(process.execPath,['--input-type=module','-e',${JSON.stringify(ownerSource)}],{detached:true,stdio:'ignore'});setInterval(()=>{},1000)`;
  const parent = spawn(process.execPath, ["-e", parentSource], { detached: true, env: cleanEnv(), stdio: "ignore" });
  const closed = once(parent, "close");
  let workerPid, ownerPid;
  try {
    ownerPid = await readPid(ownerFile);
    workerPid = await readPid(workerFile);
    parent.kill("SIGKILL");
    await closed;
    await eventually(() => !alive(workerPid), "orphan owner's detached command exit");
    await eventually(() => !alive(ownerPid), "orphan owner exit");
  } finally {
    await stopOwnedGroup(parent);
    for (const pid of [workerPid, ownerPid]) if (pid && alive(pid)) process.kill(pid, "SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});
