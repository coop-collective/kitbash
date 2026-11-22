# Private R2 attachments

Use this block for small tenant-owned binary attachments. It buffers a bounded upload so oversized or interrupted bodies cannot leave partial objects, then writes through the R2 binding. Downloads stream directly from R2; HEAD uses metadata only.

```ts
app.route("/uploads", uploadRoutes(async (request, bindings: Env) => {
  const viewer = await authenticateAndResolveOrganization(request, bindings);
  return viewer?.verifiedOrganizationId ?? null;
}));
```

The resolver is host code. It must verify organization membership, not merely return a URL/header/body tenant id. Cookie and bearer implementations are both possible; mutation routes always require a same-origin Origin header. Send raw bytes, for example `fetch('/uploads', { method: 'POST', body: file })`, and retain the returned id in the host's domain records.

Every key is derived from the verified tenant and a UUID. Downloads are fixed binary attachments, even when stored metadata claims HTML or a public cache policy. Upload names and MIME are intentionally discarded. This avoids turning a same-origin upload route into active content hosting; it is not malware scanning or image validation.

Use a private R2 bucket. Public bucket access, r2.dev, or a public custom domain would bypass these routes. The default request cap is 4 MiB and can be configured up to 8 MiB. A fixed allocation is retained during each upload; overall concurrency and account quotas still need host limits. This feature does not enforce total stored bytes or file count, does not list files and does not implement multipart, resumability, presigned URLs, ranges or expiry. Define bucket retention and remove the tenant prefix on account deletion.

Cross-tenant reads are 404. Deletion is deliberately idempotent and returns 204 for a well-formed foreign/missing id while deleting only in the caller namespace. Hosts should retain upload ids in their own records and coordinate record deletion/retries. No database/R2 distributed transaction is introduced.
