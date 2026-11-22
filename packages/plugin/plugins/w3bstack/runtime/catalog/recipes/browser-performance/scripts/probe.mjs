import { clsSessionMax } from './metrics.mjs';

// Install BEFORE navigation. Only explicitly named, same-origin paths become report keys.
export async function createProbe(page, { origin, assets = {}, requests = {} }) {
  const parsed = new URL(origin);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.origin !== origin) {
    throw Error('This recipe only probes a credential-free loopback origin');
  }
  for (const group of [assets, requests]) for (const [name, path] of Object.entries(group)) {
    if (!/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(name) || !/^\/(?!\/)[^?#]*$/.test(path)) throw Error('Use fixed paths and safe metric names');
  }
  await page.addInitScript(() => {
    window.__kitPerf = { shifts: [], clsSupported: false, lcpMs: null, readyMs: null };
    try { if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) { new PerformanceObserver(list => { for (const e of list.getEntries()) {
      window.__kitPerf.shifts.push({ startTime: e.startTime, value: e.value, hadRecentInput: e.hadRecentInput });
    } }).observe({ type: 'layout-shift', buffered: true }); window.__kitPerf.clsSupported = true; } } catch {}
    try { new PerformanceObserver(list => { for (const e of list.getEntries()) window.__kitPerf.lcpMs = e.startTime; })
      .observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  });
  let counts, exceptions, unknownRequests;
  const reset = () => { counts = Object.fromEntries(Object.keys(requests).map(key => [key, 0])); exceptions = 0; unknownRequests = 0; };
  reset();
  const onRequest = request => {
    const url = new URL(request.url());
    const name = url.origin === origin && Object.keys(requests).find(key => requests[key] === url.pathname);
    if (name) counts[name]++;
    else if (request.resourceType() === 'fetch' || request.resourceType() === 'xhr') unknownRequests++;
  };
  const onException = () => { exceptions++; };
  page.on('request', onRequest); page.on('pageerror', onException);
  return {
    reset,
    // The caller owns product-specific ready/error assertions. Mark when its readiness contract holds.
    async markReady() { await page.evaluate(() => { window.__kitPerf.readyMs = performance.now(); }); },
    async snapshot() {
      const result = await page.evaluate(({ origin, assets }) => {
        const resources = performance.getEntriesByType('resource');
        const chosen = Object.fromEntries(Object.entries(assets).map(([key, path]) => {
          const matches = resources.filter(entry => { const url = new URL(entry.name); return url.origin === origin && url.pathname === path; });
          return [key, { count: matches.length, transferBytes: matches.reduce((sum, entry) => sum + entry.transferSize, 0) }];
        }));
        return { ...window.__kitPerf, assets: chosen };
      }, { origin, assets });
      return { readyMs: result.readyMs, lcpMs: result.lcpMs, cls: result.clsSupported ? clsSessionMax(result.shifts) : null, assets: result.assets,
        requests: { ...counts }, exceptions, unknownRequests };
    },
    dispose() { page.off('request', onRequest); page.off('pageerror', onException); },
  };
}
