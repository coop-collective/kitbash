import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";
it("persists a note through Worker fetch and migrated D1", async () => {
  const created = await exports.default.fetch("http://example.test/notes", { method: "POST", body: " coverage note " });
  expect(created.status).toBe(201);
  const note = await created.json();
  const list = await exports.default.fetch("http://example.test/notes");
  expect(await list.json()).toContainEqual(note);
});
it("rejects empty notes", async () => {
  const response = await exports.default.fetch("http://example.test/notes", { method: "POST", body: " " });
  expect(response.status).toBe(400);
});
it("returns 404 for unknown routes", async () => {
  const response = await exports.default.fetch("http://example.test/missing");
  expect(response.status).toBe(404);
});
