import { Hono } from "hono";
import { deleteAttachment, downloadAttachment, uploadAttachment, UploadError, type UploadEnv } from "./uploads";
/** Resolve a trusted tenant after checking sign-in AND membership in the selected organization. */
export function uploadRoutes<B extends UploadEnv>(resolveTenant: (request: Request, env: B) => string | null | Promise<string | null>) {
  const app = new Hono<{ Bindings: B; Variables: { uploadTenant: string } }>();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    const tenant = await resolveTenant(c.req.raw, c.env);
    if (!tenant) return c.json({ error: "unauthorized" }, 401);
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("origin") !== new URL(c.req.url).origin) return c.json({ error: "same-origin Origin required" }, 403);
    c.set("uploadTenant", tenant);
    await next();
  });
  app.post("/", async c => {
    try { return c.json(await uploadAttachment(c.env, c.get("uploadTenant"), c.req.raw), 201); }
    catch (error) {
      if (error instanceof UploadError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });
  // Hono routes HEAD through GET; pass the method through so no object body is opened.
  app.get("/:id", c => downloadAttachment(c.env, c.get("uploadTenant"), c.req.param("id"), c.req.method === "HEAD"));
  app.delete("/:id", async c => (await deleteAttachment(c.env, c.get("uploadTenant"), c.req.param("id"))) ? c.body(null, 204) : c.json({ error: "not_found" }, 404));
  return app;
}
