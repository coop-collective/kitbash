import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.E2E_PORT ?? "8797");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("E2E_PORT must be an integer from 1024 to 65535");
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "test", testMatch: "**/*.spec.ts", fullyParallel: false, workers: 1,
  forbidOnly: !!process.env.CI, retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/start-local.mjs", url: `${baseURL}/health`,
    reuseExistingServer: false, timeout: 120_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    env: { E2E_PORT: String(port), WRANGLER_SEND_METRICS: "false" },
  },
});
