import { test } from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";
const eslint = new ESLint();
test("TypeScript files reject any and unused values", async () => {
  const [result] = await eslint.lintText("const unused: any = 1; export {};", { filePath: "src/failure.ts" });
  assert.ok(result.messages.some((m) => m.ruleId === "@typescript-eslint/no-explicit-any"));
  assert.ok(result.messages.some((m) => m.ruleId === "@typescript-eslint/no-unused-vars"));
});
test("explicitly unused arguments and Worker globals do not create false positives", async () => {
  const [result] = await eslint.lintText("export const handler = (_request: Request) => Response.json({ id: crypto.randomUUID() });", { filePath: "src/worker.ts" });
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
});
test("generated outputs are ignored recursively", async () => {
  for (const file of ["packages/api/.wrangler/types/runtime.d.ts", "packages/api/worker-configuration.d.ts", "packages/web/.next/types/routes.ts", "packages/core/coverage/report.js", "dist/index.js"]) {
    assert.equal(await eslint.isPathIgnored(file), true, file);
  }
  assert.equal(await eslint.isPathIgnored("src/example.ts"), false);
});
test("JavaScript config and scripts still receive recommended rules", async () => {
  const [result] = await eslint.lintText("unknownGlobal();", { filePath: "scripts/failure.mjs" });
  assert.ok(result.messages.some((m) => m.ruleId === "no-undef"));
});
