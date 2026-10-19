export type UploadEnv = { UPLOADS: R2Bucket };
export const MAX_UPLOAD_BYTES = 1048576;
export const OBJECT_PREFIX = "private-uploads";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class UploadError extends Error {
  constructor(readonly status: 400 | 413 | 409, message: string) { super(message); }
}
/** A fixed-size allocation avoids retaining an attacker-controlled count of tiny chunk objects. */
export async function readBoundedBody(request: Request, limit = MAX_UPLOAD_BYTES): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_UPLOAD_BYTES) throw new Error("Invalid upload byte limit");
  const length = request.headers.get("content-length");
  if (length !== null && !/^\d+$/.test(length)) throw new UploadError(400, "Invalid Content-Length");
  if (length !== null && Number(length) > limit) throw new UploadError(413, "Attachment too large");
  if (!request.body) throw new UploadError(400, "Empty attachment");
  const bytes = new Uint8Array(limit);
  const reader = request.body.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > limit) { await reader.cancel(); throw new UploadError(413, "Attachment too large"); }
      bytes.set(value, size);
      size += value.byteLength;
    }
  } finally { reader.releaseLock(); }
  if (size === 0) throw new UploadError(400, "Empty attachment");
  return bytes.subarray(0, size);
}
/** The tenant comes from verified authorization. It is hashed to avoid separators and PII in keys. */
export async function objectKey(tenantId: string, id: string): Promise<string | null> {
  if (!tenantId || tenantId.length > 256 || !ID.test(id)) return null;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tenantId)));
  const scope = Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${OBJECT_PREFIX}/${scope}/${id}`;
}
export async function uploadAttachment(env: UploadEnv, tenantId: string, request: Request): Promise<{ id: string; bytes: number }> {
  const id = crypto.randomUUID();
  const key = await objectKey(tenantId, id);
  if (!key) throw new Error("Invalid authenticated tenant");
  const bytes = await readBoundedBody(request);
  const object = await env.UPLOADS.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/octet-stream", cacheControl: "private, no-store", contentDisposition: `attachment; filename="upload-${id}.bin"` },
  });
  if (!object) throw new UploadError(409, "Upload id collision; retry with a new request");
  return { id, bytes: bytes.byteLength };
}
const missing = () => new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
export async function downloadAttachment(env: UploadEnv, tenantId: string, id: string, head = false): Promise<Response> {
  const key = await objectKey(tenantId, id);
  if (!key) return missing();
  // HEAD uses the metadata API, avoiding an unused R2 body stream.
  if (head) {
    const object = await env.UPLOADS.head(key);
    return object ? new Response(null, { headers: downloadHeaders(id, object) }) : missing();
  }
  const object = await env.UPLOADS.get(key);
  if (!object) return missing();
  return new Response(object.body, { headers: downloadHeaders(id, object) });
}
function downloadHeaders(id: string, object: R2Object): Headers {
  // Do not reflect uploader metadata, MIME, filenames or content encoding into a browser response.
  return new Headers({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="upload-${id}.bin"`,
    "Content-Length": String(object.size),
    "ETag": object.httpEtag,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
}
/** Idempotent within the caller's namespace; a known id alone grants no authority. */
export async function deleteAttachment(env: UploadEnv, tenantId: string, id: string): Promise<boolean> {
  const key = await objectKey(tenantId, id);
  if (!key) return false;
  await env.UPLOADS.delete(key);
  return true;
}
