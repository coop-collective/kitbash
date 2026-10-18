import { base64Decode, contract, estimateJsonTokens, sha256Hex, UNTRUSTED_NOTICE, verifyBundle } from "@kitbash/core";
import { describe, expect, it } from "vitest";
import { call, member, publishFixture, type TestMember } from "./helpers";

async function published(opts: Parameters<typeof publishFixture>[1] = {}): Promise<{ a: TestMember; base: string }> {
  const a = await member();
  const r = await publishFixture(a, opts);
  expect(r.status).toBe(201);
  return { a, base: `/api/blocks/${a.org.slug}/${opts.name ?? "email-code-auth-fixture"}` };
}

describe("reading blocks", () => {
  it("lists versions and tags", async () => {
    const { a, base } = await published();
    await publishFixture(a, { version: "1.4.0" });
    const r = await call(base, { token: a.token });
    expect(r.status).toBe(200);
    expect(r.json.id).toBe(`@${a.org.slug}/email-code-auth-fixture`);
    expect(r.json.visibility).toBe("private");
    expect(r.json.license).toBe("MIT");
    expect(r.json.tags).toEqual({ latest: "1.4.0" });
    expect(r.json.versions.map((v: { version: string }) => v.version)).toEqual(["1.4.0", "1.3.0"]);
  });

  it("serves the summary (contract Summary, at most 1,500 tokens, author text enveloped) by version and by tag", async () => {
    const { a, base } = await published();
    const r = await call(`${base}/1.3.0/summary`, { token: a.token });
    expect(r.status).toBe(200);
    expect(contract.Summary.safeParse(r.json).success).toBe(true);
    expect(estimateJsonTokens(r.json)).toBeLessThanOrEqual(1500);
    expect(r.json.untrusted_author_text.notice).toBe(UNTRUSTED_NOTICE);
    expect(r.json.untrusted_author_text.adapt).toHaveLength(4);
    expect(r.json.untrusted_author_text.changelog_top).toContain("1.3.0");
    expect(r.json.params.map((p: { name: string }) => p.name)).toContain("tokenPrefix");
    expect((await call(`${base}/latest/summary`, { token: a.token })).json.version).toBe("1.3.0");
    expect((await call(`${base}/9.9.9/summary`, { token: a.token })).status).toBe(404);
    expect((await call(`${base}/1.3.0/summary?variant=nope`, { token: a.token })).status).toBe(404);
    expect((await call(`${base}/1.3.0/nonsense`, { token: a.token })).status).toBe(404);
  });

  it("serves the manifest (with both signatures), the file list, SKILL.md and the changelog", async () => {
    const { a, base } = await published();
    const m = await call(`${base}/1.3.0/manifest`, { token: a.token });
    expect(m.json.detail).toBe("manifest");
    expect(m.json.manifest.provenance.signature).toMatch(/^ed25519:/);
    expect(m.json.manifest.provenance.registry_signature).toMatch(/^ed25519:/);
    const f = await call(`${base}/1.3.0/files`, { token: a.token });
    expect(contract.registry_get_output.safeParse(f.json).success).toBe(true);
    expect(f.json.files).toHaveLength(12);
    expect(f.json.files.find((x: { path: string }) => x.path === "SKILL.md").target).toBe(".kit/blocks/email-code-auth-fixture/SKILL.md");
    expect(f.json.files.every((x: { sha256: string }) => /^[0-9a-f]{64}$/.test(x.sha256))).toBe(true);
    const s = await call(`${base}/1.3.0/skill`, { token: a.token });
    expect(s.json.untrusted_author_text.skill_md).toMatch(/^---\nname: email-code-auth-fixture/);
    const c = await call(`${base}/1.3.0/changelog`, { token: a.token });
    expect(c.json.untrusted_author_text.changelog).toContain("## 1.3.0");
  });

  it("reads one file by its files[].path or a block-relative path", async () => {
    const { a, base } = await published();
    const r = await call(`${base}/1.3.0/file?path=src/auth/codes.ts`, { token: a.token });
    expect(r.status).toBe(200);
    expect(contract.registry_read_file_output.safeParse(r.json).success).toBe(true);
    expect(r.json.encoding).toBe("utf8");
    expect(await sha256Hex(r.json.content)).toBe(r.json.sha256);
    expect((await call(`${base}/1.3.0/file?path=CHANGELOG.md`, { token: a.token })).status).toBe(200);
    expect((await call(`${base}/1.3.0/file?path=variants/hono-d1/src/auth/codes.ts`, { token: a.token })).json.sha256).toBe(r.json.sha256);
    expect((await call(`${base}/1.3.0/file?path=nope.ts`, { token: a.token })).status).toBe(404);
  });

  it("serves a bundle whose hashes match and whose signatures verify with the pinned registry key", async () => {
    const { a, base } = await published();
    const key = (await call("/api/registry/key", { token: a.token })).json.public_key;
    const r = await call(`${base}/1.3.0/bundle`, { token: a.token });
    expect(r.status).toBe(200);
    expect(r.json.variant).toBe("hono-d1");
    expect(r.json.registry_key).toBe(key);
    const files: Record<string, Uint8Array> = {};
    for (const f of r.json.files) {
      const bytes = base64Decode(f.content_b64);
      expect(await sha256Hex(bytes)).toBe(f.sha256);
      expect(bytes.byteLength).toBe(f.bytes);
      files[f.path] = bytes;
    }
    for (const entry of r.json.manifest.files) {
      const p = entry.variant ? `variants/${entry.variant}/${entry.path}` : entry.path;
      expect(await sha256Hex(files[p]!)).toBe(entry.sha256);
    }
    const ok = await verifyBundle(r.json.manifest, files, key, { publisherPublicKey: r.json.publisher_key });
    expect(ok).toEqual({ ok: true, errors: [] });
    files["variants/hono-d1/src/auth/codes.ts"] = new TextEncoder().encode("// tampered");
    expect((await verifyBundle(r.json.manifest, files, key, { publisherPublicKey: r.json.publisher_key })).ok).toBe(false);
  });

  it("sets and removes tags; refuses non-members and bad tags", async () => {
    const { a, base } = await published();
    await publishFixture(a, { version: "1.4.0" });
    const r = await call(`${base}/tags`, { token: a.token, body: { tag: "stable", version: "1.3.0" } });
    expect(r.json.tags).toEqual({ latest: "1.4.0", stable: "1.3.0" });
    expect((await call(`${base}/stable/summary`, { token: a.token })).json.version).toBe("1.3.0");
    expect((await call(`${base}/tags`, { token: a.token, body: { tag: "stable", version: null } })).json.tags).toEqual({ latest: "1.4.0" });
    expect((await call(`${base}/tags`, { token: a.token, body: { tag: "Bad Tag", version: "1.3.0" } })).status).toBe(400);
    expect((await call(`${base}/tags`, { token: a.token, body: { tag: "x", version: "7.0.0" } })).status).toBe(404);
    const b = await member();
    expect((await call(`${base}/tags`, { token: b.token, body: { tag: "x", version: "1.3.0" } })).status).toBe(404);
  });

  it("yanks: 410 for the exact version unless allow_yanked, tags move, idempotent", async () => {
    const { a, base } = await published();
    await publishFixture(a, { version: "1.4.0", tag: "stable" });
    const y = await call(`${base}/1.4.0/yank`, { token: a.token, body: { reason: "bad migration" } });
    expect(y.status).toBe(200);
    expect(y.json.status).toBe("yanked");
    expect(y.json.tags).toEqual({ latest: "1.3.0" });
    const gone = await call(`${base}/1.4.0/summary`, { token: a.token });
    expect(gone.status).toBe(410);
    expect(gone.json.error.code).toBe("version_yanked");
    expect((await call(`${base}/1.4.0/bundle?allow_yanked=1`, { token: a.token })).status).toBe(200);
    expect((await call(`${base}/latest/summary`, { token: a.token })).json.version).toBe("1.3.0");
    expect((await call(`${base}/stable/summary`, { token: a.token })).status).toBe(404);
    expect((await call(`${base}/tags`, { token: a.token, body: { tag: "stable", version: "1.4.0" } })).status).toBe(410);
    expect((await call(`${base}/1.4.0/yank`, { token: a.token, body: {} })).json.yanked_at).toBe(y.json.yanked_at);
    const info = await call(base, { token: a.token });
    expect(info.json.versions[0]).toMatchObject({ version: "1.4.0", status: "yanked" });
  });

  it("only members may yank", async () => {
    const { a, base } = await published();
    const b = await member();
    expect((await call(`${base}/1.3.0/yank`, { token: b.token, body: {} })).status).toBe(404);
    const c = await member(a.org.slug, "member");
    expect((await call(`${base}/1.3.0/yank`, { token: c.token, body: {} })).status).toBe(200);
  });
});
