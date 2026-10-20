import { Hono } from "hono";

export const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));
// Mount selected block routes here after completing their adaptation checklists.
app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "internal" }, 500);
});

export default app;
