// Renders every catalog component with react-dom/server, with no props, to prove it is safe to render on the server
// (no window/document/timers during render). Uses Vite's SSR loader so TSX and CSS imports resolve as in an app.
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const root = new URL("..", import.meta.url).pathname;
const { components } = JSON.parse(readFileSync(new URL("../src/catalog.json", import.meta.url), "utf8"));
const only = process.argv.slice(2);

const server = await createServer({
  root,
  configFile: false,
  logLevel: "error",
  plugins: [react()],
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});

const failures = [];
let rendered = 0;
for (const c of components) {
  if (only.length && !only.includes(c.slug)) continue;
  try {
    const mod = await server.ssrLoadModule(`/src/components/${c.slug}/${c.export}.tsx`);
    const Component = mod[c.export];
    if (typeof Component !== "function") throw new Error(`no export named ${c.export}`);
    const html = renderToString(createElement(Component));
    if (!html) throw new Error("rendered nothing");
    rendered++;
  } catch (error) {
    failures.push(`${c.slug}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}
// Imports resolve the way an app writes them: through package.json "exports" by package name
if (!only.length) {
  const probe = [
    ["@kitbash/ui", "ChatThread"],
    ["@kitbash/ui/chat-thread", "ChatThread"],
    ["@kitbash/ui/shared", "useCachedLoader"],
    ["@kitbash/ui/trace-waterfall", "TraceWaterfall"],
  ];
  for (const [spec, name] of probe) {
    try {
      const mod = await server.ssrLoadModule(spec);
      if (!(name in mod)) throw new Error(`missing export ${name}`);
    } catch (error) {
      failures.push(`import ${spec}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
  }
}
await server.close();

if (failures.length) {
  console.error(`server render failed for ${failures.length} component(s):\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`server render ok: ${rendered} components${only.length ? "" : "; package imports resolve"}`);
