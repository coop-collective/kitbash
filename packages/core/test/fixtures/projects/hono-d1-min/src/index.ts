import { Hono } from "hono";

export const app = new Hono<{ Bindings: Env }>();
app.get("/health", (c) => c.json({ ok: true }));

export default app;
