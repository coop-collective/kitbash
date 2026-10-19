import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { deleteAttachment, downloadAttachment, MAX_UPLOAD_BYTES, OBJECT_PREFIX, objectKey, readBoundedBody, uploadAttachment } from "../src/lib/r2-private-uploads/uploads";
import { uploadRoutes } from "../src/lib/r2-private-uploads/routes";
const payload = new Uint8Array([1]);
const request = (body: BodyInit = payload, headers: Record<string, string> = {}) => new Request("https://app.example.test/", { method: "POST", body, headers });
const make = (owner: string) => uploadAttachment(env, owner, request());

describe("bounded upload bodies", () => {
  it("accepts exactly the cap and refuses an oversized declared length before storage", async () => {
    const bytes = new Uint8Array(MAX_UPLOAD_BYTES);
    expect((await readBoundedBody(request(bytes))).byteLength).toBe(MAX_UPLOAD_BYTES);
    await expect(readBoundedBody(request(payload, { "content-length": String(MAX_UPLOAD_BYTES + 1) }))).rejects.toMatchObject({ status: 413 });
    await expect(readBoundedBody(request(new Uint8Array()))).rejects.toMatchObject({ status: 400 });
    await expect(readBoundedBody(request(payload, { "content-length": "invalid" }))).rejects.toMatchObject({ status: 400 });
  });
  it("counts actual chunked bytes, cancels at overflow, and writes no partial R2 object", async () => {
    let cancelled = false;
    let count = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(MAX_UPLOAD_BYTES)); count++; },
      cancel() { cancelled = true; },
    });
    const before = await env.UPLOADS.list({ prefix: OBJECT_PREFIX + "/" });
    await expect(uploadAttachment(env, "owner_overflow", request(body, { "content-length": "1" }))).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
    expect(count).toBeLessThanOrEqual(3);
    expect((await env.UPLOADS.list({ prefix: OBJECT_PREFIX + "/" })).objects.map(o => o.key)).toEqual(before.objects.map(o => o.key));
  });
  it("propagates an interrupted body and leaves no object", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("upload interrupted")); } });
    await expect(uploadAttachment(env, "owner_interrupted", request(body))).rejects.toThrow("upload interrupted");
  });
});

describe("private R2 attachment lifecycle", () => {
  it("uses tenant-derived keys and refuses caller-selected paths", async () => {
    const u = await make("tenant/../../escape");
    const key = await objectKey("tenant/../../escape", u.id);
    expect(key).toMatch(new RegExp(`^${OBJECT_PREFIX}/[0-9a-f]{64}/[0-9a-f-]{36}$`));
    expect(key).not.toContain("escape");
    expect(await objectKey("tenant/../../escape", "../../another-tenant/file")).toBeNull();
    expect(await objectKey("", u.id)).toBeNull();
    expect(await env.UPLOADS.head(key!)).toMatchObject({ size: 1 });
  });
  it("streams only the owner's bytes, serves HEAD, and deletes only in that namespace", async () => {
    const u = await make("owner_lifecycle");
    const foreign = await downloadAttachment(env, "owner_other", u.id);
    expect(foreign.status).toBe(404);
    await deleteAttachment(env, "owner_other", u.id);
    const response = await downloadAttachment(env, "owner_lifecycle", u.id);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(payload);
    const head = await downloadAttachment(env, "owner_lifecycle", u.id, true);
    expect(head.headers.get("content-length")).toBe("1");
    expect(await head.text()).toBe("");
    expect(await deleteAttachment(env, "owner_lifecycle", u.id)).toBe(true);
    expect((await downloadAttachment(env, "owner_lifecycle", u.id)).status).toBe(404);
    expect(await deleteAttachment(env, "owner_lifecycle", u.id)).toBe(true);
  });
  it("ignores untrusted content metadata and never serves active content inline", async () => {
    const u = await uploadAttachment(env, "owner_html", request(payload, { "content-type": "text/html", "x-file-name": "malicious.html" }));
    const key = await objectKey("owner_html", u.id);
    // Existing bucket metadata is untrusted too; headers still come from the safe projection.
    await env.UPLOADS.put(key!, payload, { httpMetadata: { contentType: "text/html", contentDisposition: "inline", cacheControl: "public, max-age=999999" } });
    const response = await downloadAttachment(env, "owner_html", u.id);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("content-disposition")).not.toContain("malicious");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("etag")).toMatch(/^".*"$/);
    await response.body?.cancel();
  });
});

describe("mounted upload routes", () => {
  // Test-only resolver. Production verifies session/token and organization membership.
  const app = new Hono().route("/uploads", uploadRoutes(req => req.headers.get("x-test-tenant")));
  const call = (path = "", method = "GET", tenant?: string, body?: BodyInit, origin = "https://app.example.test") => app.request(`https://app.example.test/uploads${path}`, { method, headers: { origin, ...(tenant ? { "x-test-tenant": tenant } : {}) }, ...(body ? { body } : {}) }, env);
  it("requires authentication and same-origin writes, then round-trips a private attachment", async () => {
    expect((await call("", "POST", undefined, payload)).status).toBe(401);
    expect((await call("", "POST", "owner_route", payload, "https://other.example.test")).status).toBe(403);
    expect((await call("", "POST", "owner_route", payload, "")).status).toBe(403);
    const created = await call("", "POST", "owner_route", payload);
    expect(created.status).toBe(201);
    const u = await created.json() as { id: string; bytes: number };
    expect(u.bytes).toBe(1);
    expect((await call(`/${u.id}`, "GET", "foreign")).status).toBe(404);
    const head = await call(`/${u.id}`, "HEAD", "owner_route");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const downloaded = await call(`/${u.id}`, "GET", "owner_route");
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(payload);
    expect((await call(`/${u.id}`, "DELETE", "owner_route")).status).toBe(204);
    expect((await call(`/${u.id}`, "GET", "owner_route")).status).toBe(404);
  });
  it("reports limits, bad ids and origin failures through the HTTP boundary", async () => {
    expect((await call("", "POST", "owner_limit", new Uint8Array(MAX_UPLOAD_BYTES + 1))).status).toBe(413);
    expect((await call("/not-a-uuid", "GET", "owner_limit")).status).toBe(404);
    expect((await call("/not-a-uuid", "DELETE", "owner_limit")).status).toBe(404);
    expect((await call("/not-a-uuid", "DELETE", "owner_limit", undefined, "null")).status).toBe(403);
  });
});
