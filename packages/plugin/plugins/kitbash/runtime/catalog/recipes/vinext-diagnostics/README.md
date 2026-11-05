# React and vinext diagnostics

Opt-in client diagnostics for a vinext app, with a compatibility check against Kitbash's pinned bootstrap. This recipe does not change bootstrap defaults, install a telemetry service, or deploy anything.

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm exec playwright install chromium
pnpm test:compat
```

`test:compat` creates a temporary copy of `bootstraps/vinext/files`, installs its dependencies plus this recipe's pinned `web-vitals`, runs the bootstrap checks and production build, starts the generated Worker in local workerd, and verifies server `instrumentation.register`, browser hydration and a real LCP callback. It removes the temporary app and stops its server. Allow ten minutes in CI; install Chromium with `pnpm exec playwright install --with-deps chromium` there. When copied outside this repository, supply `KITBASH_VINEXT_TEMPLATE=/absolute/path/to/bootstraps/vinext/files`. The same relative template location exists in the shipped plugin catalog.

## Adopt the collector

Copy `src/` into your app's client diagnostics directory and add `web-vitals` **6.2.3**. Keep the app's existing matched React versions. The `.ts` import paths require `allowImportingTsExtensions: true` with `noEmit: true` in TypeScript, or change the copied imports to your project's extension convention. Mount `Vitals` once from a **client component**, pass a stable `onMetric` callback, and optionally wrap the client subtree in `DevelopmentChecks`. Do not pass an ordinary function through a Server Component boundary.

`browser.ts` imports `web-vitals` directly: vinext currently documents `next/web-vitals` as a no-op. The shared registration runs once per module/document; effect cleanup removes subscribers so Strict Mode's setup/cleanup/setup does not duplicate observers. No network request is made by the recipe. The emitted record contains only metric name, numeric value, unit and document scope; it drops raw entries, DOM attribution, URLs and user identifiers. Add only reviewed static route-template/build labels in your own sink, and validate any ingestion endpoint separately.

With `reportAllChanges`, later values replace earlier values for that metric/document: **do not sum them**. The library owns CLS session windows and the INP algorithm. Measurements span a document's lifetime; assigning them to the currently visible SPA route would misattribute earlier work. Some metrics may remain absent without a qualifying paint/interaction or until the page becomes hidden. Absence is not a zero or a pass. A scripted click is not field INP; field p75 requires a representative population and aggregation outside this recipe.

## React checks and server tracing

`DevelopmentChecks` uses React's built-in Strict Mode. Its extra rendering and effect checks only run in development. Use it to find missing subscription cleanup and impure rendering, not to measure production speed.

React `<Profiler>` is useful around a small expensive subtree. Its `onRender` callback reports render durations; it does not measure network, D1, canvas work or total page latency. Normal production React disables profiling. Use a separately configured profiling build, confirm callbacks actually fire, and compare equivalent builds. This recipe **does not enable or claim to validate production profiling**. Avoid blindly aliasing `react-dom` to a profiling entry in vinext: its renderer and RSC dependency paths must be tested together.

vinext supports `instrumentation.ts` with `register` and `onRequestError`. Place it in the app's root or `src/` according to its structure. The compatibility fixture verifies `register` in the built Worker. Connect request-error reporting to your approved telemetry adapter; do not send raw request URLs, headers, cookies, stack traces or exception messages by default. The fixture does not validate an external exporter or the `onRequestError` delivery path. Use the [Cloudflare performance recipe](../cloudflare-performance/README.md) for read-only permissions and aggregate diagnostics, and the [browser performance recipe](../browser-performance/README.md) for transfer/request budgets and lifecycle checks.

## Compatibility and limits

The compatibility check reads the actual bootstrap pins (currently React **19.3.1**, vinext **1.2.1**, `@vinext/cloudflare` **1.1.1**) rather than installing latest framework versions. The fixture uses compatibility date **2026-08-22**, the maximum accepted by the pinned Vitest Workers pool; Wrangler itself supports a newer runtime. Updating pins or this date requires rerunning the check with the lockfile. Unit tests cover safe payloads and subscription cleanup; a successful LCP callback is not proof of INP/CLS field performance. The ordinary production build remains unprofiled.

Sources: [vinext support matrix](https://github.com/cloudflare/vinext#supported-features), [web-vitals usage and reporting](https://github.com/GoogleChrome/web-vitals), [React Strict Mode](https://react.dev/reference/react/StrictMode), [React Profiler](https://react.dev/reference/react/Profiler).

Provenance: original Kitbash recipe, derived from the Sticks November 2026 performance audit's need to distinguish browser measurements, React render work and Worker evidence. No app credentials, user data or production traces are included. This is a recipe rather than an installable block: dependency installation, browser setup and process startup exceed the block verifier's command allowlist.
