// Deliberately isolated test fixture; never mount these failure modes in a product Worker.
const script = `
(() => {
  const mode = new URL(location.href).searchParams.get('mode');
  const flights = new Map(); let attempt = 0;
  function state() {
    if (flights.has('state')) return flights.get('state');
    const endpoint = mode === 'stall' && attempt++ === 0 ? '/api/stall' : '/api/state';
    const flight = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 500);
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        return await response.json(); // Include body parsing in the deadline.
      } catch {
        throw new Error(controller.signal.aborted ? 'deadline' : 'network');
      } finally { clearTimeout(timer); flights.delete('state'); }
    })();
    flights.set('state', flight); return flight;
  }
  async function run() {
    document.body.dataset.status = 'loading';
    try {
      await state();
      if (mode === 'burst') await Promise.all([fetch('/api/state'), fetch('/api/state')]);
      document.body.dataset.status = 'ready';
    } catch (error) { document.body.dataset.reason = error.message; document.body.dataset.status = 'error'; }
  }
  document.querySelector('button').onclick = run;
  run();
})();`;
export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ready');
    if (url.pathname === '/assets/app.js') return new Response(script, { headers: {
      'content-type': 'text/javascript',
      'cache-control': url.searchParams.has('uncached') ? 'no-store' : 'private, max-age=31536000, immutable',
    } });
    if (url.pathname === '/api/state') return Response.json({ available: true });
    if (url.pathname === '/api/stall') {
      let timer;
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
        // A live timer avoids workerd treating the intentionally slow stream as a deadlocked handler.
        timer = setTimeout(() => { controller.enqueue(new TextEncoder().encode('}')); controller.close(); }, 3000);
      }, cancel() { clearTimeout(timer); } }), { headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname !== '/') return new Response('not found', { status: 404 });
    return new Response(`<!doctype html><html><head><title>Local performance fixture</title></head>
      <body data-status="loading"><h1>Performance fixture</h1><button>Retry</button>
      <script src="/assets/app.js${url.searchParams.get('mode') === 'uncached' ? '?uncached=1' : ''}" defer></script></body></html>`,
      { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } });
  },
};
