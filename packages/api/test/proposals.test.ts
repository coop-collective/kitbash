import { describe, expect, it } from "vitest";
import { call, E, member, publishFixture } from "./helpers";

const PATCH = `--- a/src/auth/codes.ts
+++ b/src/auth/codes.ts
@@ -1,3 +1,4 @@
 import { hmacHex } from "./crypto";
+const RESEND_COOLDOWN_S = 30;
@@ -20,2 +21,2 @@
-  return x;
+  return y;
`;

describe("proposals", () => {
  it("stores the patch in R2 under the block's org and records a draft", async () => {
    const a = await member();
    await publishFixture(a);
    const r = await call("/api/proposals", {
      token: a.token,
      body: { block: `@${a.org.slug}/email-code-auth-fixture@1.3.0`, title: "Add resend cooldown", rationale: "Codes were re-sent on double click", patch: PATCH },
    });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ status: "draft", hunks: 2, redactions: [] });
    expect(r.json.proposal_id).toMatch(/^prop_/);
    const row = await E.DB.prepare("SELECT patch_key, status FROM proposals WHERE id = ?").bind(r.json.proposal_id).first<{ patch_key: string; status: string }>();
    expect(row!.patch_key).toBe(`orgs/${a.org.id}/proposals/${r.json.proposal_id}.patch`);
    expect(await (await E.BLOBS.get(row!.patch_key))!.text()).toBe(PATCH);
  });

  it("accepts block + version, refuses secrets in the patch and unknown blocks", async () => {
    const a = await member();
    await publishFixture(a);
    const ok = await call("/api/proposals", { token: a.token, body: { block: `@${a.org.slug}/email-code-auth-fixture`, version: "latest", title: "t", rationale: "r", patch: PATCH } });
    expect(ok.status).toBe(201);
    const leak = await call("/api/proposals", {
      token: a.token,
      body: { block: `@${a.org.slug}/email-code-auth-fixture@1.3.0`, title: "t", rationale: "r", patch: `${PATCH}+const k = "sk_live_51HxQe2KJ8Lz3VbN9aQp4TrW7mYc";\n` },
    });
    expect(leak.status).toBe(422);
    expect(leak.json.error.code).toBe("scan_refused");
    expect((await call("/api/proposals", { token: a.token, body: { block: `@${a.org.slug}/nope@1.0.0`, title: "t", rationale: "r", patch: PATCH } })).status).toBe(404);
    expect((await call("/api/proposals", { token: a.token, body: { block: `@${a.org.slug}/email-code-auth-fixture`, title: "t", rationale: "r", patch: PATCH } })).status).toBe(400);
  });
});
