import { Hono } from "hono";
import { getProfile, getPublicProfile, saveProfile, type ProfileEnv } from "./profiles";
const MAX_JSON_BYTES = 8192;
class BodyTooLarge extends Error {}
async function boundedJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_JSON_BYTES) throw new BodyTooLarge();
  if (!request.body) throw new SyntaxError("Missing JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) { await reader.cancel(); throw new BodyTooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
}
/** The resolver verifies the host's session/token; it is the only authority for the owner id. */
export function profileRoutes<B extends ProfileEnv>(resolveOwner: (request: Request, env: B) => string | null | Promise<string | null>) {
  const app = new Hono<{ Bindings: B }>();
  app.use("*", async (c, next) => { c.header("Cache-Control", "private, no-store"); await next(); });
  app.get("/public/:handle", async c => {
    const profile = await getPublicProfile(c.env, c.req.param("handle"));
    return profile ? c.json({ profile }) : c.json({ error: "not_found" }, 404);
  });
  app.get("/me", async c => {
    const owner = await resolveOwner(c.req.raw, c.env);
    if (!owner) return c.json({ error: "unauthorized" }, 401);
    const profile = await getProfile(c.env, owner);
    return c.json({ profile, revision: profile?.revision ?? 0 });
  });
  app.put("/me", async c => {
    const owner = await resolveOwner(c.req.raw, c.env);
    if (!owner) return c.json({ error: "unauthorized" }, 401);
    if (c.req.header("origin") !== new URL(c.req.url).origin) return c.json({ error: "same-origin Origin required" }, 403);
    if (c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return c.json({ error: "JSON required" }, 415);
    let body: unknown;
    try { body = await boundedJson(c.req.raw); }
    catch (error) {
      if (error instanceof BodyTooLarge) return c.json({ error: "body_too_large" }, 413);
      if (error instanceof SyntaxError || error instanceof TypeError) return c.json({ error: "invalid_json" }, 400);
      throw error;
    }
    const result = await saveProfile(c.env, owner, body);
    return result.ok ? c.json(result) : c.json(result, result.error === "conflict" ? 409 : 400);
  });
  return app;
}
