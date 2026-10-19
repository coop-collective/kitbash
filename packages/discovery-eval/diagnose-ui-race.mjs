import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { cleanEnv, stopOwnedGroup } from "./process.mjs";
const project = process.argv[2];
if (!project)
  throw new Error("Usage: node diagnose-ui-race.mjs LIBRARY_APP_DIRECTORY");
const base = "http://127.0.0.1:18881";
const child = spawn(
  "pnpm",
  ["exec", "wrangler", "dev", "--ip", "127.0.0.1", "--port", "18881"],
  { cwd: project, env: cleanEnv(), detached: true, stdio: "ignore" },
);
const closed = new Promise((resolve) => child.once("close", resolve));
let browser;
try {
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(base + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error("Dev server not ready");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  let release, received;
  const held = new Promise((r) => {
      release = r;
    }),
    loaded = new Promise((r) => {
      received = r;
    });
  await page.route("**/api/profile", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    received();
    await held;
    await route.fulfill({ response });
  });
  await page.goto(base);
  await page.getByTestId("login-email").fill("alice@example.test");
  await page.getByTestId("login-password").fill("local-demo-password");
  await page.getByTestId("login-submit").click();
  await loaded;
  const field = page.getByTestId("profile-display-name"),
    typed = "Typed before initial profile response";
  await field.fill(typed);
  const before = await field.inputValue();
  release();
  await page.waitForFunction(
    (value) =>
      document.querySelector('[data-testid="profile-display-name"]').value !==
      value,
    typed,
  );
  const after = await field.inputValue();
  console.log(
    JSON.stringify({
      diagnostic:
        "Post-run delayed initial profile GET; measured acceptance score unchanged",
      editableBeforeInitialLoad: true,
      typedValue: before,
      valueAfterInitialLoad: after,
      typedInputOverwritten: before === typed && after !== typed,
      scope:
        "Reproduces the UI race under a controlled delay, not the exact event ordering of the original run.",
    }),
  );
} finally {
  await browser?.close();
  await stopOwnedGroup(child);
  await closed;
}
