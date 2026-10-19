# Local full-stack browser testing

Sources: `~/Workspace/qa-manager` at `9add1a20aad11fff264e4330ddd6a19a9c3f1455`, `playwright.config.ts` supplies managed web servers, health readiness, retained failure traces and CI retries. `~/Workspace/platform` at `8f8ed9c2a44507490912f8631806664c724be767`, `packages/website/playwright.config.mjs` explains serial stateful journeys, unique fixtures, and trace credential leakage. This extraction removes app-specific accounts, auth headers, AI routing and existing-server reuse.

Primary references checked 2026-10-19: [Playwright web servers](https://playwright.dev/docs/test-webserver), [Playwright CI](https://playwright.dev/docs/ci-intro), [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/). Local Wrangler 4.137.0 help confirms `--local`, `--persist-to`, `--ip` and `--port`.

Verification from `recipes/playwright-worker-e2e`: `npm ci`, `npx playwright install chromium`, `npm test`, `npm run typecheck`, `npm run test:launcher`. Browser assertions exercise UI -> Worker -> migrated D1 -> reload. The launcher test checks invalid port rejection. Readiness also depends on successful migration replay.

Limits: single Chromium project, local storage, serial tests, no production credentials. Remote binding settings must be removed when adapting an existing app. Hosted auth and destructive test fixtures need app-specific design. This independent recipe does not weaken installer policies or duplicate the registry-install e2e harness.

Runtime evidence: Wrangler 4.137.0 embeds workerd supporting dates through 2026-09-28. A run with 2026-10-19 failed before browser launch, so this tested fixture keeps the supported date.
