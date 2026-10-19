import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { command, summarize } from "../run.mjs";

test("missing final billing event remains unknown, not zero spend or successful completion", () => {
  const missing = summarize(
    '{"type":"system","subtype":"init","model":"same-model"}\n',
  );
  assert.equal(missing.resultPresent, false);
  assert.equal(missing.costUsd, undefined);
  assert.equal(missing.isError, undefined);
  const complete = summarize(
    '{"type":"system","subtype":"init","model":"same-model"}\n{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__catalog__catalog_search"}]}}\n{"type":"result","subtype":"error_max_budget_usd","is_error":true,"total_cost_usd":4.9,"usage":{"input_tokens":20,"cache_read_input_tokens":200,"output_tokens":30},"num_turns":3}\n',
  );
  assert.equal(complete.costUsd, 4.9);
  assert.equal(complete.isError, true);
  assert.equal(complete.usage.cache_read_input_tokens, 200);
  assert.equal(complete.toolCalls.mcp__catalog__catalog_search, 1);
});
test("standalone failing node test really executes under the outer Node test runner", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "eval-child-"));
  try {
    await writeFile(
      path.join(directory, "fail.test.mjs"),
      "import {test} from 'node:test'; test('sentinel actually ran',()=>{throw new Error('expected-sentinel-failure')});\n",
    );
    const result = await command(
      process.execPath,
      ["--test", "fail.test.mjs"],
      { cwd: directory },
    );
    assert.equal(result.code, 1);
    assert.match(result.stdout, /sentinel actually ran/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
