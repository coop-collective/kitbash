import { defineConfig } from '@playwright/test';
const port = Number(process.env.E2E_PORT ?? 8798);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid E2E_PORT');
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './test', testMatch: '*.spec.mjs', workers: 1, fullyParallel: false,
  forbidOnly: !!process.env.CI, retries: 0, reporter: 'list',
  // Even failures retain only the explicit numeric summary: no auth state, screenshots or traces.
  use: { baseURL, trace: 'off', screenshot: 'off', video: 'off' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true } },
  ],
  webServer: {
    command: 'node scripts/start-local.mjs', url: `${baseURL}/health`,
    reuseExistingServer: false, timeout: 120_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    env: { E2E_PORT: String(port), WRANGLER_SEND_METRICS: 'false' },
  },
});
