import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("runs the health route in workerd", async () => {
  const response = await SELF.fetch("https://example.test/api/health");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
