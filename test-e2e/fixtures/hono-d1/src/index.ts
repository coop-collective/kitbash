import { Hono } from "hono";
import { health } from "./routes/health";

export const app = new Hono<{ Bindings: Env }>();

app.route("/", health);
// Blocks mount their routes here (the planner adds the import and the app.route line).

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal" }, 500);
});

export default app;
