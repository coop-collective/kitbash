---
name: r2-private-uploads
description: Small private R2 attachments with bounded bodies and tenant-derived storage keys.
---

Adds uploadRoutes(resolveTenant), upload/download/delete services and an UPLOADS R2 binding. No D1 tables are required, although the hono-d1 host template is supported. The tenant resolver receives Request and typed host bindings; it must verify authentication and membership before returning a tenant id. A known upload UUID grants no access by itself.

POST routePrefix accepts a raw body and returns id and bytes. GET /:id streams it, HEAD /:id uses R2 head without opening a body stream, and DELETE /:id is idempotent within the caller's namespace. Unsafe methods require the exact same-origin Origin header, including for a bearer-authenticated resolver. Cross-tenant GET is 404; deleting a foreign id returns 204 but touches only the caller's namespace.

The body reader checks declared length and counts actual chunks, cancels on overflow and writes R2 only after a complete bounded read. Its fixed buffer is maxBytes (4 MiB default, 8 MiB maximum). This is for small attachments. Large uploads need a separate multipart/resumable workflow.

Keys are objectPrefix/SHA256(tenant)/serverUUID. Client filenames, keys and MIME headers never affect storage keys or served metadata. Downloads use application/octet-stream, attachment disposition, private/no-store, nosniff and a sandbox CSP. No file-content safety or malware claim is made; files remain arbitrary binary attachments.

Adapt: bind a private bucket with public access disabled; mount the resolver-backed routes; apply rate limits and product quotas; establish retention and account deletion cleanup. No total-quota enforcement, listing, public CDN, uploaded-avatar UI, inline image serving, MIME sniffing or scanning ships in this block. Workerd tests use the real local R2 binding, chunk cancellation, tenant isolation, response headers, HEAD and deletion.
