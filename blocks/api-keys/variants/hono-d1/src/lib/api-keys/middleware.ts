import { createMiddleware } from "hono/factory";
import { authenticateKey, type ApiKeyAuth, type ApiKeysEnv } from "./keys";

/** Resolves `Authorization: Bearer <key>` and sets `c.get("apiKey")`; 401 otherwise. */
export const requireApiKey = createMiddleware<{ Bindings: ApiKeysEnv; Variables: { apiKey: ApiKeyAuth } }>(async (c, next) => {
  const auth = await authenticateKey(c.env, c.req.header("authorization"));
  if (!auth) return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="api"' });
  c.set("apiKey", auth);
  await next();
});
