// kit-api: the Kitbash registry Worker. The HTTP contract is docs/API.md (kept in step with this file).
//
//   GET  /health                                        no auth
//   *    /api/*                                         kit_ bearer (src/auth.ts)
//   *    /mcp                                           kit_ bearer; remote MCP (src/mcp.ts)
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";
import { requireBearer } from "./auth";
import {
  blockInfo,
  bundle,
  changelogDetail,
  filesDetail,
  manifestDetail,
  readFile,
  resolveVersion,
  setTag,
  skillDetail,
  summaryOf,
  yank,
} from "./blocks";
import { registryKey } from "./keys";
import { handleMcp } from "./mcp";
import { whoami } from "./orgs";
import { ProposalBody, propose } from "./proposals";
import { getBlob, PublishBody, publish, putBlob } from "./publish";
import { SearchQuery, search } from "./search";
import { ApiError, toEnvelope, type AppEnv } from "./types";
import { HeartbeatBody, heartbeat } from "./usage";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

const app = new Hono<AppEnv>();

app.onError((e, c) => {
  const { status, body } = toEnvelope(e);
  return c.json(body, status as 400);
});
app.notFound((c) => c.json({ error: { code: "not_found", message: `no route ${c.req.method} ${new URL(c.req.url).pathname}` } }, 404));

app.get("/health", (c) => c.json({ ok: true, service: "kit-api" }));

app.use("/api/*", requireBearer);
app.use(
  "/api/*",
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: { code: "invalid_params", message: `request body over ${MAX_BODY_BYTES} bytes`, findings: [{ rule: "too_large", path: "", severity: "block" }] } }, 413),
  }),
);

async function jsonBody<T extends z.ZodType>(c: Context<AppEnv>, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError("invalid_params", "the body must be JSON", { rule: "json" });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 10);
    throw new ApiError("invalid_params", `invalid body: ${issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`, {
      findings: issues.map((i) => ({ rule: "body", path: i.path.join("."), severity: "block" as const, detail: i.message })),
    });
  }
  return parsed.data;
}

const allowYanked = (c: Context<AppEnv>) => ["1", "true"].includes(c.req.query("allow_yanked") ?? "");

app.get("/api/me", (c) => c.json(whoami(c.var.caller)));

app.get("/api/registry/key", async (c) => {
  const k = await registryKey(c.env);
  return c.json({ public_key: k.publicKey, key_id: k.keyId });
});

app.put("/api/blobs/:sha256", async (c) => {
  const data = new Uint8Array(await c.req.arrayBuffer());
  const r = await putBlob(c.env, c.var.caller, c.req.param("sha256"), c.req.query("scope"), data);
  return c.json(r, r.existed ? 200 : 201);
});
// GET returns the bytes; HEAD (which Hono serves from the GET route without a body) answers whether the blob exists.
app.get("/api/blobs/:sha256", async (c) => {
  const data = await getBlob(c.env, c.var.caller, c.req.param("sha256"), c.req.query("scope"));
  if (!data) throw new ApiError("not_found", "no such blob in this scope");
  return c.body(data.buffer as ArrayBuffer, 200, { "content-type": "application/octet-stream", "content-length": String(data.byteLength) });
});

app.get("/api/search", async (c) => {
  const num = c.req.query("limit");
  const tags = c.req.query("tags");
  const parsed = SearchQuery.safeParse({
    q: c.req.query("q") ?? "",
    runtime: c.req.query("runtime") || undefined,
    framework: c.req.query("framework") || undefined,
    db: c.req.query("db") || undefined,
    ui: c.req.query("ui") || undefined,
    tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    scope: c.req.query("scope") || undefined,
    limit: num === undefined ? undefined : Number(num),
  });
  if (!parsed.success) {
    throw new ApiError("invalid_params", `invalid query: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, { rule: "query" });
  }
  return c.json(await search(c.env, c.var.caller, parsed.data));
});

app.post("/api/blocks/:scope/:name/versions", async (c) => {
  const body = await jsonBody(c, PublishBody);
  return c.json(await publish(c.env, c.var.caller, c.req.param("scope"), c.req.param("name"), body), 201);
});

app.get("/api/blocks/:scope/:name", async (c) => c.json(await blockInfo(c.env, c.var.caller, c.req.param("scope"), c.req.param("name"))));

app.post("/api/blocks/:scope/:name/tags", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { tag?: unknown; version?: unknown } | null;
  if (!body || typeof body.tag !== "string" || !(typeof body.version === "string" || body.version === null)) {
    throw new ApiError("invalid_params", 'body is {"tag": "...", "version": "x.y.z" | null}', { rule: "body" });
  }
  return c.json(await setTag(c.env, c.var.caller, c.req.param("scope"), c.req.param("name"), body.tag, body.version));
});

app.post("/api/blocks/:scope/:name/:version/yank", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : undefined;
  return c.json(await yank(c.env, c.var.caller, c.req.param("scope"), c.req.param("name"), c.req.param("version"), reason));
});

const DETAILS = ["summary", "manifest", "files", "skill", "changelog", "file", "bundle"] as const;
app.get("/api/blocks/:scope/:name/:version/:detail", async (c) => {
  const detail = c.req.param("detail") as (typeof DETAILS)[number];
  if (!DETAILS.includes(detail)) throw new ApiError("not_found", `no detail ${detail}; one of ${DETAILS.join(", ")}`);
  const r = await resolveVersion(c.env, c.var.caller, c.req.param("scope"), c.req.param("name"), c.req.param("version"), { allowYanked: allowYanked(c) });
  const variant = c.req.query("variant") || undefined;
  switch (detail) {
    case "summary":
      return c.json(summaryOf(r, variant));
    case "manifest":
      return c.json(manifestDetail(r));
    case "files":
      return c.json(filesDetail(r, variant));
    case "skill":
      return c.json(await skillDetail(c.env, r));
    case "changelog":
      return c.json(changelogDetail(r));
    case "file":
      return c.json(await readFile(c.env, r, c.req.query("path") ?? "", variant));
    case "bundle":
      return c.json(await bundle(c.env, r, variant));
  }
});

app.post("/api/projects/:id/heartbeat", async (c) => {
  const body = await jsonBody(c, HeartbeatBody);
  return c.json(await heartbeat(c.env, c.var.caller, c.req.param("id"), body));
});

app.post("/api/proposals", async (c) => {
  const body = await jsonBody(c, ProposalBody);
  return c.json(await propose(c.env, c.var.caller, body), 201);
});

app.use("/mcp", requireBearer);
app.all("/mcp", (c) => handleMcp(c.req.raw, c.var.caller, c.env));

export default app;
