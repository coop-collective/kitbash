import assert from "node:assert/strict";
import { test } from "node:test";
import { installStandalone } from "./pnpm-install.mjs";

const ok = { code: 0, out: "installed", err: "" };
const failed = message => ({ code: 1, out: message, err: "" });
function runner(results) {
  const calls = [];
  return {
    calls,
    run: async (...args) => {
      calls.push(args);
      assert.ok(results.length, "unexpected extra pnpm invocation");
      return results.shift();
    },
  };
}

test("initial installs can create locks and immutable validation honors local build permissions", async () => {
  const mock = runner([ok, ok]);
  await installStandalone(mock.run, { cwd: "/standalone" });
  assert.deepEqual(mock.calls, [
    ["pnpm", ["install", "--no-frozen-lockfile", "--config.confirmModulesPurge=false", "--offline"], { cwd: "/standalone" }],
    ["pnpm", ["install", "--offline", "--frozen-lockfile", "--config.confirmModulesPurge=false"], { cwd: "/standalone" }],
  ]);
});

test("only a missing offline package allows the online fallback", async () => {
  for (const code of ["ERR_PNPM_NO_OFFLINE_META", "ERR_PNPM_NO_OFFLINE_TARBALL"]) {
    const mock = runner([failed(code), ok, ok]);
    await installStandalone(mock.run, { cwd: "/standalone" });
    assert.equal(mock.calls.length, 3);
    assert.equal(mock.calls[1][1].includes("--offline"), false);
    assert.equal(mock.calls[2][1].includes("--frozen-lockfile"), true);
  }
});

test("partial installs and ignored build scripts fail without accepting linked dependencies", async () => {
  const mock = runner([failed("ERR_PNPM_IGNORED_BUILDS: linked vitest but ignored workerd")]);
  await assert.rejects(installStandalone(mock.run, { cwd: "/standalone" }), /ERR_PNPM_IGNORED_BUILDS/);
  assert.equal(mock.calls.length, 1);
});

test("offline-only, online and frozen-install failures are propagated", async () => {
  const offline = runner([failed("ERR_PNPM_NO_OFFLINE_META")]);
  await assert.rejects(installStandalone(offline.run, { cwd: "/standalone", allowOnline: false }), /ERR_PNPM_NO_OFFLINE_META/);
  const online = runner([failed("ERR_PNPM_NO_OFFLINE_META"), failed("network unavailable")]);
  await assert.rejects(installStandalone(online.run, { cwd: "/standalone" }), /network unavailable/);
  const frozen = runner([ok, failed("ERR_PNPM_OUTDATED_LOCKFILE")]);
  await assert.rejects(installStandalone(frozen.run, { cwd: "/standalone" }), /ERR_PNPM_OUTDATED_LOCKFILE/);
});
