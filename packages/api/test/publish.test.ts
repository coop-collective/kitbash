import { base64Encode, estimateJsonTokens, generateSigningKeyPair, sha256Hex, toBytes } from "@kitbash/core";
import { describe, expect, it } from "vitest";
import { call, E, member, publishBody, publishFixture } from "./helpers";

describe("publish", () => {
  it("publishes the WP-01 fixture: 201, co-signed, card under 100 tokens, latest tag, blobs per org", async () => {
    const a = await member();
    const r = await publishFixture(a);
    expect(r.status).toBe(201);
    expect(r.json.id).toBe(`@${a.org.slug}/email-code-auth-fixture`);
    expect(r.json.version).toBe("1.3.0");
    expect(r.json.registry_signature).toMatch(/^ed25519:/);
    expect(r.json.manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.json.tags).toEqual({ latest: "1.3.0" });
    expect(["scanned", "unreviewed"]).toContain(r.json.scan.tier);
    expect(r.json.scan.findings.every((f: { severity: string }) => f.severity !== "block")).toBe(true);
    const { summary: _s, ...card } = r.json.card;
    expect(estimateJsonTokens(card)).toBeLessThanOrEqual(100);
    expect(r.json.size.files).toBe(12);
    expect(r.json.size.summary_tokens).toBeLessThanOrEqual(1500);
    const listed = await E.BLOBS.list({ prefix: `orgs/${a.org.id}/blobs/` });
    expect(listed.objects.length).toBeGreaterThanOrEqual(12);
    const ev = await E.DB.prepare("SELECT kind FROM events WHERE org_id = ? AND kind = 'block.publish'").bind(a.org.id).first();
    expect(ev).not.toBeNull();
  });

  it("refuses a second publish of the same version with 409", async () => {
    const a = await member();
    expect((await publishFixture(a)).status).toBe(201);
    const again = await publishFixture(a);
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("conflicts");
    expect((await publishFixture(a, { version: "1.3.1" })).status).toBe(201);
  });

  it("refuses a file path with .. (400, path_traversal)", async () => {
    const a = await member();
    const body = await publishBody();
    body.files.push({ path: "variants/../../etc/passwd", content_b64: base64Encode(toBytes("x")) });
    const r = await call(`/api/blocks/${a.org.slug}/email-code-auth-fixture/versions`, { token: a.token, body });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("invalid_params");
    expect(r.json.error.findings[0].rule).toBe("path_traversal");
  });

  it("refuses absolute paths and a variant-relative path that escapes", async () => {
    const a = await member();
    const body = await publishBody();
    body.files.push({ path: "/etc/passwd", content_b64: "eA" });
    const r = await call(`/api/blocks/${a.org.slug}/email-code-auth-fixture/versions`, { token: a.token, body });
    expect(r.status).toBe(400);
    const body2 = await publishBody();
    (body2.files as { path: string; variant?: string; content_b64: string }[]).push({ path: "../../../x", variant: "hono-d1", content_b64: "eA" });
    const r2 = await call(`/api/blocks/${a.org.slug}/email-code-auth-fixture/versions`, { token: a.token, body: body2 });
    expect(r2.status).toBe(400);
    expect(r2.json.error.findings[0].rule).toBe("path_traversal");
  });

  it("refuses a manifest with a secret value: 422 scan_refused naming the finding", async () => {
    const a = await member();
    const body = await publishBody({
      edit: (m) => {
        m.envVars = { MAIL_FROM: "login@example.com", STRIPE_KEY: "sk_live_51HxQe2KJ8Lz3VbN9aQp4TrW7mYc" };
      },
    });
    const r = await call(`/api/blocks/${a.org.slug}/email-code-auth-fixture/versions`, { token: a.token, body });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("scan_refused");
    expect(r.json.error.findings.some((f: { rule: string; severity: string }) => f.rule === "secret" && f.severity === "block")).toBe(true);
  });

  it("refuses a secret value in a shipped file", async () => {
    const a = await member();
    const body = await publishBody({
      edit: (_m, files) => {
        files["variants/hono-d1/src/auth/mail.ts"] = `${files["variants/hono-d1/src/auth/mail.ts"]}\nconst AWS = "AKIAIOSFODNN7EXAMPLE";\n`;
      },
    });
    const r = await call(`/api/blocks/${a.org.slug}/email-code-auth-fixture/versions`, { token: a.token, body });
    expect(r.status).toBe(422);
    expect(r.json.error.findings.find((f: { rule: string }) => f.rule === "secret").path).toBe("variants/hono-d1/src/auth/mail.ts");
  });

  it("refuses a file that does not match its signed hash", async () => {
    const a = await member();
    const body = await publishBody();
    const i = body.files.findIndex((f) => f.path === "variants/hono-d1/src/auth/codes.ts");
    body.files[i] = { path: body.files[i]!.path, content_b64: base64Encode(toBytes("// tampered\n")) };
    const r = await call(`/api/blocks/${a.org.slug}/email-code-auth-fixture/versions`, { token: a.token, body });
    expect(r.status).toBe(422);
    expect(r.json.error.findings.some((f: { rule: string }) => f.rule === "hash_mismatch")).toBe(true);
  });

  it("refuses a publisher signature that does not verify (422 signature_invalid), and a missing one (400)", async () => {
    const a = await member();
    const body = await publishBody();
    const other = await generateSigningKeyPair();
    const r = await call(`/api/blocks/${a.org.slug}/email-code-auth-fixture/versions`, { token: a.token, body: { ...body, publisher_key: other.publicKey } });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("signature_invalid");
    const { publisher_signature: _p, ...unsigned } = body;
    const r2 = await call(`/api/blocks/${a.org.slug}/email-code-auth-fixture/versions`, { token: a.token, body: unsigned });
    expect(r2.status).toBe(400);
    expect(r2.json.error.findings[0].rule).toBe("signature_missing");
  });

  it("binds a publisher key to the first member who uses it", async () => {
    const a = await member();
    const b = await member(a.org.slug, "member");
    const key = await generateSigningKeyPair();
    expect((await publishFixture(a, { key })).status).toBe(201);
    const r = await publishFixture(b, { key, version: "1.4.0" });
    expect(r.status).toBe(403);
    const row = await E.DB.prepare("SELECT member_id FROM publisher_keys WHERE public_key = ?").bind(key.publicKey).first<{ member_id: string }>();
    expect(row!.member_id).toBe(a.id);
  });

  it("refuses a name that differs from the URL, an unknown scope and a scope the caller is not in", async () => {
    const a = await member();
    const body = await publishBody();
    expect((await call(`/api/blocks/${a.org.slug}/other-name/versions`, { token: a.token, body })).json.error.findings[0].rule).toBe("name_mismatch");
    expect((await call(`/api/blocks/no-such-scope/email-code-auth-fixture/versions`, { token: a.token, body })).status).toBe(404);
    const b = await member();
    const r = await call(`/api/blocks/${b.org.slug}/email-code-auth-fixture/versions`, { token: a.token, body });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("forbidden");
  });

  it("accepts the scope with an @ and variant-relative file paths", async () => {
    const a = await member();
    const body = await publishBody();
    const files = body.files.map((f) =>
      f.path.startsWith("variants/hono-d1/") ? { path: f.path.slice("variants/hono-d1/".length), variant: "hono-d1", content_b64: f.content_b64 } : f,
    );
    const r = await call(`/api/blocks/@${a.org.slug}/email-code-auth-fixture/versions`, { token: a.token, body: { ...body, files } });
    expect(r.status).toBe(201);
  });

  it("publishes from blobs uploaded first with PUT /api/blobs/:sha256", async () => {
    const a = await member();
    const body = await publishBody();
    const files = [];
    for (const f of body.files) {
      const bytes = Uint8Array.from(atob(f.content_b64), (ch) => ch.charCodeAt(0));
      const sha = await sha256Hex(bytes);
      const up = await call(`/api/blobs/${sha}?scope=${a.org.slug}`, { method: "PUT", token: a.token, raw: bytes });
      expect([200, 201]).toContain(up.status);
      files.push({ path: f.path, sha256: sha });
    }
    const r = await call(`/api/blocks/${a.org.slug}/email-code-auth-fixture/versions`, { token: a.token, body: { ...body, files } });
    expect(r.status).toBe(201);
  });

  it("refuses a blob whose body does not hash to its path, and a publish naming a blob never uploaded", async () => {
    const a = await member();
    const bad = await call(`/api/blobs/${"0".repeat(64)}`, { method: "PUT", token: a.token, raw: "hello" });
    expect(bad.status).toBe(400);
    expect(bad.json.error.findings[0].rule).toBe("hash_mismatch");
    expect((await call(`/api/blobs/not-a-hash`, { method: "PUT", token: a.token, raw: "hello" })).status).toBe(400);
    const body = await publishBody();
    body.files[0] = { path: body.files[0]!.path, sha256: "a".repeat(64) } as never;
    const r = await call(`/api/blocks/${a.org.slug}/email-code-auth-fixture/versions`, { token: a.token, body });
    expect(r.status).toBe(400);
    expect(r.json.error.findings[0].rule).toBe("blob_missing");
  });

  it("keeps blobs per org: another org's blob is not usable", async () => {
    const a = await member();
    const b = await member();
    const sha = await sha256Hex("shared bytes");
    expect((await call(`/api/blobs/${sha}`, { method: "PUT", token: a.token, raw: "shared bytes" })).status).toBe(201);
    expect((await call(`/api/blobs/${sha}`, { method: "HEAD", token: a.token })).status).toBe(200);
    expect((await call(`/api/blobs/${sha}`, { method: "HEAD", token: b.token })).status).toBe(404);
  });

  it("refuses a summary over 1,500 tokens (422, rule budget)", async () => {
    const a = await member();
    const filler = "Wire the module into the application and confirm the behaviour with the included tests. ".repeat(14);
    const body = await publishBody({
      edit: (m) => {
        m.agent.adapt = Array.from({ length: 8 }, (_, i) => ({ id: `step-${i}`, required: false, title: `Step ${i}`, do: filler }));
      },
    });
    const r = await call(`/api/blocks/${a.org.slug}/email-code-auth-fixture/versions`, { token: a.token, body });
    expect(r.status).toBe(422);
    expect(r.json.error.findings[0].rule).toBe("budget");
  });

  it("refuses an invalid body with 400", async () => {
    const a = await member();
    const r = await call(`/api/blocks/${a.org.slug}/email-code-auth-fixture/versions`, { token: a.token, raw: "{not json", headers: { "content-type": "application/json" } });
    expect(r.status).toBe(400);
    const r2 = await call(`/api/blocks/${a.org.slug}/email-code-auth-fixture/versions`, { token: a.token, body: { manifest: {}, files: "no" } });
    expect(r2.status).toBe(400);
  });

  it("tags an extra tag at publish; latest follows the highest non-prerelease", async () => {
    const a = await member();
    expect((await publishFixture(a, { version: "1.3.0", tag: "stable" })).json.tags).toEqual({ latest: "1.3.0", stable: "1.3.0" });
    expect((await publishFixture(a, { version: "2.0.0-beta.1" })).json.tags.latest).toBe("1.3.0");
    expect((await publishFixture(a, { version: "1.2.0" })).json.tags.latest).toBe("1.3.0");
    expect((await publishFixture(a, { version: "1.4.0" })).json.tags).toEqual({ latest: "1.4.0", stable: "1.3.0" });
  });
});
