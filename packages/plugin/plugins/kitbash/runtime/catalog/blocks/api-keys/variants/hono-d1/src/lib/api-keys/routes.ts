import { Hono, type Context } from "hono";
import { createKey, listKeys, renameKey, revokeKey, type ApiKeysEnv } from "./keys";

type Ctx = Context<{ Bindings: ApiKeysEnv; Variables: { owner: string } }>;

async function bodyOf(c: Ctx): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Dashboard routes for the signed-in owner. `ownerOf` is the one line you wire to your own sign-in (a session, a
 * bearer middleware; `c` is your own app's context, so `c.get("member")` works): return the owner id, or null for an
 * anonymous caller (401). A caller can only touch the rows of the owner id returned.
 */
// biome-ignore lint/suspicious/noExplicitAny: ownerOf receives the caller's own context type
export function apiKeyRoutes(ownerOf: (c: Context<any>) => string | null | Promise<string | null>) {
  const app = new Hono<{ Bindings: ApiKeysEnv; Variables: { owner: string } }>();
  app.use("*", async (c, next) => {
    const owner = await ownerOf(c);
    if (!owner) return c.json({ error: "unauthorized" }, 401);
    c.set("owner", owner);
    await next();
  });
  const owner = (c: Ctx) => c.get("owner");

  app.get("/", async (c) => c.json({ keys: await listKeys(c.env, owner(c)) }));

  app.post("/", async (c) => {
    const b = await bodyOf(c);
    const r = await createKey(c.env, owner(c), { name: b.name, scopes: b.scopes });
    if (!r.ok) return c.json({ error: r.error }, r.error === "invalid scopes" ? 400 : 409);
    return c.json({ id: r.id, key: r.key, note: "Store this key now; it cannot be shown again." }, 201);
  });

  app.patch("/:id", async (c) => {
    const b = await bodyOf(c);
    if (!(await renameKey(c.env, owner(c), c.req.param("id"), b.name))) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  app.delete("/:id", async (c) => {
    await revokeKey(c.env, owner(c), c.req.param("id"));
    return c.json({ ok: true });
  });

  return app;
}
