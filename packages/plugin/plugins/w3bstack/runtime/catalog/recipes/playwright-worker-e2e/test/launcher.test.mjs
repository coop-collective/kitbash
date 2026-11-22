import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("invalid ports fail before starting Wrangler", () => {
  const result = spawnSync(process.execPath, ["scripts/start-local.mjs"], { env: { ...process.env, E2E_PORT: "8797;invalid" }, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid E2E_PORT/);
});
