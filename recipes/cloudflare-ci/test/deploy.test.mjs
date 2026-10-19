import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, preflight, execute } from "../scripts/deploy.mjs";
const credentials = { CLOUDFLARE_API_TOKEN: "fixture", CLOUDFLARE_ACCOUNT_ID: "a".repeat(32) };
const config = (first = "1", second = "2") => ({ env: Object.fromEntries([["staging", first], ["production", second]].map(([target, digit]) => [target, { d1_databases: [{ binding: "DB", database_id: `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}` }] }])) });
test("migration and deploy select the same explicit environment", () => {
  for (const target of ["staging", "production"]) {
    const commands = [];
    execute(target, (args) => { commands.push(args); return 0; });
    assert.deepEqual(commands, plan(target));
    assert.equal(commands.length, 2);
    for (const args of commands) assert.deepEqual(args.slice(-2), ["--env", target]);
    assert.ok(commands[0].includes("--remote"));
  }
});
test("migration failure prevents Worker deploy", () => {
  let calls = 0;
  assert.throws(() => execute("staging", () => { calls++; return 1; }), /remaining steps skipped/);
  assert.equal(calls, 1);
});
test("unknown target is rejected before executing any command", () => {
  assert.throws(() => execute("production;anything", () => assert.fail()), /Target/);
});
test("credentials and distinct provisioned D1 IDs are mandatory", () => {
  preflight(config(), credentials);
  assert.throws(() => preflight(config(), {}), /required/);
  assert.throws(() => preflight(config("0", "2"), credentials), /Provision/);
  assert.throws(() => preflight(config("1", "1"), credentials), /different/);
});
