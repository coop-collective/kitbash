import assert from "node:assert/strict";
import { test } from "node:test";
import { SECRETS_TOOL, runSecrets } from "../plugins/kitbash/scripts/secrets-tool.mjs";
import { call, connect } from "./helpers.mjs";

const sentinel = "do-not-return-provider-content";
const env = { KIT_SECRETS_BROKER_URL: "https://broker.example.com", KIT_SECRETS_BROKER_TOKEN: "operator_scoped_test_token_for_broker" };
const input = { operation: "generate", project: "scoreboard", target: "staging", name: "SESSION_SECRET" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const created = { ...input, status: "created" };

test("secrets schema rejects values, commands, endpoints, and non-generation names", () => {
  assert.equal(SECRETS_TOOL.input.safeParse(input).success, true);
  for (const value of [
    { ...input, value: sentinel }, { ...input, token: sentinel }, { ...input, url: "https://other.example.com" },
    { ...input, command: "printenv" }, { ...input, operation: "read" }, { ...input, operation: "rotate" },
    { ...input, project: "../scoreboard" }, { ...input, target: "prod" }, { ...input, name: "bad\nname" },
    { operation: "generate", project: "scoreboard", target: "staging" }, { ...input, operation: "status" },
  ]) assert.equal(SECRETS_TOOL.input.safeParse(value).success, false);
});

test("broker client sends only validated metadata to its configured origin and strips successful extra fields", async () => {
  let calls = 0;
  const result = await runSecrets(input, {
    env: { ...env, INFISICAL_TOKEN: sentinel, CLOUDFLARE_API_TOKEN: sentinel },
    fetch: async (url, init) => {
      calls++;
      assert.equal(url.href, "https://broker.example.com/v1/operations");
      assert.deepEqual(JSON.parse(init.body), input);
      assert.equal(init.headers.authorization, `Bearer ${env.KIT_SECRETS_BROKER_TOKEN}`);
      assert.equal(init.redirect, "error");
      assert.equal(JSON.stringify(init).includes(sentinel), false);
      return json({ ...created, secretValue: sentinel, provider: { accessToken: sentinel }, logs: [sentinel] });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, created);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
});

test("status and connection results reconstruct only typed metadata", async () => {
  const cases = [
    [{ operation: "presence", project: "scoreboard", target: "staging", name: "SESSION_SECRET" }, {
      name: "SESSION_SECRET", status: "present", value: sentinel,
    }, { name: "SESSION_SECRET", status: "present" }],
    [{ operation: "setup", project: "scoreboard", target: "staging" }, {
      status: "pending", secrets: [{ name: "SESSION_SECRET", status: "present", value: sentinel }, { name: "PAYMENT_API_KEY", status: "missing" }],
      github: { configured: true, token: sentinel }, workerSync: { configured: false },
    }, {
      status: "pending", secrets: [{ name: "SESSION_SECRET", status: "present" }, { name: "PAYMENT_API_KEY", status: "missing" }],
      github: { configured: true }, workerSync: { configured: false },
    }],
    [{ operation: "status", project: "scoreboard", target: "staging" }, {
      status: "ready", secrets: [{ name: "SESSION_SECRET", status: "present", value: sentinel }],
      github: { configured: true, token: sentinel }, workerSync: { configured: false, error: sentinel },
    }, {
      status: "ready", secrets: [{ name: "SESSION_SECRET", status: "present" }],
      github: { configured: true }, workerSync: { configured: false },
    }],
    [{ operation: "provision-github", project: "scoreboard", target: "production" }, {
      status: "configured", github: { configured: true, credentials: sentinel },
    }, { status: "configured", github: { configured: true } }],
    [{ operation: "provision-worker-sync", project: "scoreboard", target: "staging" }, {
      status: "pending", workerSync: { configured: false, logs: sentinel },
    }, { status: "pending", workerSync: { configured: false } }],
  ];
  for (const [request, body, expected] of cases) {
    assert.deepEqual(await runSecrets(request, { env, fetch: async () => json({ ...request, ...body }) }), { ...request, ...expected });
  }
});

test("broker responses with mismatched identity, status, names or shape fail without echoing content", async () => {
  for (const body of [
    { ...created, name: sentinel }, { ...created, project: sentinel }, { ...created, target: sentinel },
    { ...created, status: sentinel }, { ...created, operation: sentinel }, sentinel, null,
  ]) {
    await assert.rejects(runSecrets(input, { env, fetch: async () => json(body) }), (error) => {
      assert.equal(error.code, "unavailable");
      assert.equal(String(error).includes(sentinel), false);
      return true;
    });
  }
  const status = { operation: "status", project: "scoreboard", target: "staging" };
  for (const secrets of [[{ name: sentinel, status: "present" }], [{ name: "X", status: sentinel }], [{ name: "X", status: "missing" }, { name: "X", status: "present" }]]) {
    await assert.rejects(runSecrets(status, { env, fetch: async () => json({ ...status, status: "ready", secrets }) }));
  }
});

test("GitHub App handoff accepts only approval links on the configured broker and filters provider data", async () => {
  const request = { operation: "provision-github-app", project: "scoreboard", target: "staging" };
  const body = { ...request, status: "pending", secrets: [{ name: "APP_PRIVATE_KEY", status: "missing", value: sentinel }],
    approvalUrl: `https://broker.example.com/github-app/start/${"a".repeat(43)}`, secretValue: sentinel };
  const result = await runSecrets(request, { env, fetch: async () => json(body) });
  assert.equal(result.approvalUrl, body.approvalUrl);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  const scoped = `https://broker.example.com/github-app/scoreboard/staging/start/${"a".repeat(43)}`;
  assert.equal((await runSecrets(request, { env, fetch: async () => json({ ...body, approvalUrl: scoped }) })).approvalUrl, scoped);
  for (const approvalUrl of ["https://other.example.com/github-app/start/" + "a".repeat(43), body.approvalUrl + "?token=" + sentinel, "https://broker.example.com/other", scoped.replace('/staging/', '/production/'), scoped.replace('/scoreboard/', '/other-project/')]) {
    await assert.rejects(runSecrets(request, { env, fetch: async () => json({ ...body, approvalUrl }) }), { code: "unavailable" });
  }
});

test("HTTP errors, invalid JSON, network errors, oversized responses, and redirects cannot disclose provider text", async () => {
  const transports = [
    async () => json({ error: { code: "provider_failed", message: sentinel }, response: sentinel }, 500),
    async () => json({ error: { code: sentinel }, response: sentinel }, 403),
    async () => new Response(sentinel, { status: 500 }),
    async () => new Response(sentinel, { headers: { "content-type": "application/json" } }),
    async () => { throw new Error(sentinel); },
    async () => json({ ...created, logs: sentinel.repeat(3000) }),
    async () => ({ redirected: true, status: 200, ok: true, body: sentinel }),
  ];
  for (const fetch of transports) {
    await assert.rejects(runSecrets(input, { env, fetch }), (error) => {
      assert.ok(["provider_failed", "unavailable"].includes(error.code));
      assert.equal(JSON.stringify(error).includes(sentinel), false);
      assert.equal(String(error).includes(sentinel), false);
      return true;
    });
  }
});

test("broker origin is operator-controlled and plaintext is limited to explicit loopback development", async () => {
  let calls = 0;
  const fetch = async () => { calls++; return json(created); };
  for (const url of ["http://broker.example.com", "http://127.0.0.1:8080", "https://user:password@broker.example.com", "https://broker.example.com/private", "https://broker.example.com?token=example", "file:///tmp/broker"]) {
    await assert.rejects(runSecrets(input, { env: { ...env, KIT_SECRETS_BROKER_URL: url }, fetch }));
  }
  assert.equal(calls, 0);
  for (const url of ["http://127.0.0.1:8080", "http://[::1]:8080", "http://localhost:8080"]) {
    await runSecrets(input, { env: { ...env, KIT_SECRETS_BROKER_URL: url, KIT_SECRETS_BROKER_ALLOW_LOOPBACK_HTTP: "1" }, fetch });
  }
  await assert.rejects(runSecrets(input, { env: { ...env, KIT_SECRETS_BROKER_URL: "http://broker.example.com", KIT_SECRETS_BROKER_ALLOW_LOOPBACK_HTTP: "1" }, fetch }));
  assert.equal(calls, 3);
});

test("MCP secrets never runs project commands and filters successes, failures, and input-validation messages", async () => {
  let response = () => json({ ...created, token: sentinel });
  let calls = 0;
  const client = await connect({ env, fetch: async () => { calls++; return response(); }, runner: async () => { throw new Error("Must not execute project commands"); } });
  const success = await call(client, "kitbash_secrets", input);
  assert.equal(success.isError, false);
  assert.deepEqual(success.raw.structuredContent, created);
  assert.equal(JSON.stringify(success).includes(sentinel), false);
  response = () => json({ error: { code: "forbidden", message: sentinel } }, 403);
  const failed = await call(client, "kitbash_secrets", input);
  assert.equal(failed.isError, true);
  assert.equal(failed.data.error.code, "forbidden");
  assert.equal(JSON.stringify(failed).includes(sentinel), false);
  const invalid = await call(client, "kitbash_secrets", { ...input, [sentinel]: sentinel });
  assert.equal(invalid.isError, true);
  assert.equal(JSON.stringify(invalid).includes(sentinel), false);
  assert.equal(calls, 2);
});
