export function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;
  if (!/^[0-9]+$/.test(value)) throw new Error("PORT must be an integer from 1 to 65535");
  const port = Number(value);
  if (port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535");
  return port;
}

// Pure request handling keeps tests independent of listeners and process state.
export function handleRequest(request: Request): Response {
  const path = new URL(request.url).pathname;
  if (path !== "/healthz") return Response.json({ error: "not_found" }, { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  return new Response(request.method === "HEAD" ? null : JSON.stringify({ ok: true }), { headers });
}
