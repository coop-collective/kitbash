import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("browser submission survives a reload through local Worker and D1", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const note = `browser-${randomUUID()}`;
  await page.goto("/");
  await page.getByRole("textbox", { name: "Note" }).fill(note);
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByRole("list", { name: "Notes" })).toContainText(note);
  await page.reload();
  await expect(page.getByRole("list", { name: "Notes" })).toContainText(note);
  expect(errors).toEqual([]);
});
test("invalid notes are rejected by the Worker", async ({ request }) => {
  const response = await request.post("/api/notes", { data: " " });
  expect(response.status()).toBe(400);
});
