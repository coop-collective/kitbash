import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("serves health through the Worker fetch handler", async () => {
  const response = await SELF.fetch("https://example.test/health");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
