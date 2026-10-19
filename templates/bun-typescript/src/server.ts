import { handleRequest, parsePort } from "./app.ts";

const server = Bun.serve({
  hostname: process.env.HOST ?? "127.0.0.1",
  port: parsePort(process.env.PORT),
  maxRequestBodySize: 4096,
  fetch: handleRequest,
});
console.info(JSON.stringify({ event: "listening", host: server.hostname, port: server.port }));

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => { void server.stop(true); }, 5000);
  deadline.unref();
  try { await server.stop(); } finally { clearTimeout(deadline); }
}
process.once("SIGTERM", () => { void stop(); });
process.once("SIGINT", () => { void stop(); });
