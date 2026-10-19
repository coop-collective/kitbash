# Playwright against a local Worker and migrated D1

```sh
cd recipes/playwright-worker-e2e
npm ci
npx playwright install chromium
npm test
npm run typecheck
npm run test:launcher
```

The browser drives a real page, Worker request and D1 write, then reloads to prove persistence. Each invocation gets a fresh temporary storage directory; migrations and Wrangler dev use the same `--persist-to` path. The server readiness URL queries a migrated table, so a listening port alone is insufficient. Playwright owns startup/shutdown and refuses a preexisting server. There is no seed/reset endpoint in the shipped application.

To adopt, copy the config and launcher; retain your own Wrangler config, migrations and product journey. Change the health URL to one that validates your app's readiness. Set a free `E2E_PORT` for simultaneous runs; defaults to 8797. Cases within a run share D1: generate unique identifiers, or implement isolated fixtures before raising the worker count. Test output and HTML reports are ignored. Traces only contain local fixture data; hosted runs carrying credentials need a separate trace policy.

In Linux CI use `npx playwright install --with-deps chromium`, then `npm test`, and upload `playwright-report/` and `test-results/` with `if: always()`. This fixture only configures local bindings. Adapting a project with `remote: true` bindings requires reviewing and removing those settings for this test environment. No remote deployment is performed.

This is a recipe, since browser setup/startup and Playwright commands cannot be expressed by Kitbash's current verify allowlist. It complements `test-e2e/install.test.mjs`, which validates block installation rather than browser behavior.

The sample compatibility date is 2026-09-28, the maximum supported by the pinned Wrangler 4.137.0 runtime. Today's date was tested and rejected at startup; upgrade the toolchain and reverify before advancing it.
