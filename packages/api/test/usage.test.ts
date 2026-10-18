import { describe, expect, it } from "vitest";
import { call, E, member, publishFixture } from "./helpers";

describe("project heartbeats", () => {
  it("upserts the project and its installs, then marks dropped blocks removed", async () => {
    const a = await member();
    await publishFixture(a);
    await publishFixture(a, { name: "second-block" });
    const pid = `prj_${crypto.randomUUID().slice(0, 12)}`;
    const id1 = `@${a.org.slug}/email-code-auth-fixture`;
    const id2 = `@${a.org.slug}/second-block`;
    const r = await call(`/api/projects/${pid}/heartbeat`, {
      token: a.token,
      body: {
        stack: { framework: "hono", db: "d1" },
        blocks: [
          { block: id1, version: "1.3.0", variant: "hono-d1", verified_at: "2026-10-20T10:40:00Z", passed: true },
          { block: id2, version: "1.3.0" },
        ],
      },
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ project_id: pid, installs: 2, removed: 0, skipped: [] });
    const p = await E.DB.prepare("SELECT org_id, stack_json FROM projects WHERE id = ?").bind(pid).first<{ org_id: string; stack_json: string }>();
    expect(p!.org_id).toBe(a.org.id);
    expect(JSON.parse(p!.stack_json)).toEqual({ framework: "hono", db: "d1" });
    const again = await call(`/api/projects/${pid}/heartbeat`, { token: a.token, body: { blocks: [{ block: id1, version: "1.3.0" }] } });
    expect(again.json.removed).toBe(1);
    const rows = await E.DB.prepare("SELECT passed, verified_at, removed_at FROM installs WHERE project_id = ? ORDER BY removed_at IS NULL DESC").bind(pid).all<any>();
    expect(rows.results[0]).toMatchObject({ passed: 1, verified_at: "2026-10-20T10:40:00Z", removed_at: null });
    expect(rows.results[1].removed_at).not.toBeNull();
  });

  it("skips unknown or invisible blocks and reports them", async () => {
    const a = await member();
    const b = await member();
    await publishFixture(b, { name: "theirs" });
    const r = await call(`/api/projects/prj_skiptest1/heartbeat`, {
      token: a.token,
      body: { blocks: [{ block: `@${b.org.slug}/theirs`, version: "1.3.0" }, { block: "not-a-ref", version: "1.0.0" }] },
    });
    expect(r.status).toBe(200);
    expect(r.json.installs).toBe(0);
    expect(r.json.skipped).toHaveLength(2);
  });

  it("refuses a bad project id and a project of another org", async () => {
    const a = await member();
    const b = await member();
    expect((await call(`/api/projects/nope/heartbeat`, { token: a.token, body: {} })).status).toBe(400);
    expect((await call(`/api/projects/prj_owned_by_a/heartbeat`, { token: a.token, body: {} })).status).toBe(200);
    const r = await call(`/api/projects/prj_owned_by_a/heartbeat`, { token: b.token, body: {} });
    expect(r.status).toBe(409);
    expect((await call(`/api/projects/prj_other_scope/heartbeat`, { token: a.token, body: { scope: b.org.slug } })).status).toBe(403);
  });
});
