// Project heartbeats (DESIGN §4.5, MVP: counting only). A heartbeat carries the lock's block list and nothing else;
// it upserts the project and one installs row per block, and marks blocks no longer listed as removed.
import { parseBlockRef, VERSION_RE } from "@kitbash/core";
import { z } from "zod";
import { canRead } from "./blocks";
import { requireOrgMember } from "./orgs";
import { ApiError, type Bindings, type Caller } from "./types";
import { now } from "./util";

export const PROJECT_ID_RE = /^prj_[A-Za-z0-9_-]{4,64}$/;

const Ts = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
export const HeartbeatBody = z.strictObject({
  scope: z.string().max(64).optional(),
  stack: z.record(z.string(), z.string().max(64)).optional(),
  blocks: z
    .array(
      z.strictObject({
        block: z.string().max(200),
        version: z.string().regex(VERSION_RE),
        variant: z.string().max(64).optional(),
        verified_at: Ts.optional(),
        passed: z.boolean().optional(),
      }),
    )
    .max(200)
    .default([]),
});
export type HeartbeatBodyT = z.infer<typeof HeartbeatBody>;

export async function heartbeat(env: Bindings, caller: Caller, projectId: string, body: HeartbeatBodyT) {
  if (!PROJECT_ID_RE.test(projectId)) throw new ApiError("invalid_params", "project id must be prj_ plus 4-64 of [A-Za-z0-9_-] (.kit/project.json project_id)", { rule: "project_id" });
  const org = await requireOrgMember(env, caller, body.scope);
  const ts = now();
  const existing = await env.DB.prepare("SELECT org_id FROM projects WHERE id = ?").bind(projectId).first<{ org_id: string }>();
  if (existing && existing.org_id !== org.id) throw new ApiError("conflicts", `project ${projectId} belongs to another scope`);
  const stmts: D1PreparedStatement[] = [
    existing
      ? env.DB.prepare("UPDATE projects SET last_seen = ?, last_member_id = ?, stack_json = COALESCE(?, stack_json) WHERE id = ?").bind(
          ts, caller.member.id, body.stack ? JSON.stringify(body.stack) : null, projectId,
        )
      : env.DB.prepare("INSERT INTO projects (id, org_id, stack_json, first_seen, last_seen, last_member_id) VALUES (?, ?, ?, ?, ?, ?)").bind(
          projectId, org.id, body.stack ? JSON.stringify(body.stack) : null, ts, ts, caller.member.id,
        ),
  ];
  const skipped: { block: string; reason: string }[] = [];
  const kept: string[] = [];
  for (const b of body.blocks) {
    let ref;
    try {
      ref = parseBlockRef(b.block);
    } catch {
      skipped.push({ block: b.block, reason: "bad block id" });
      continue;
    }
    const row = await env.DB.prepare(
      `SELECT bl.id AS block_id, bl.org_id, bl.visibility, v.id AS version_id
         FROM blocks bl JOIN orgs o ON o.id = bl.org_id JOIN block_versions v ON v.block_id = bl.id
        WHERE o.slug = ? AND bl.name = ? AND v.version = ?`,
    )
      .bind(ref.scope, ref.name, b.version)
      .first<{ block_id: string; org_id: string; visibility: string; version_id: string }>();
    if (!row || !canRead(caller, row)) {
      skipped.push({ block: `${ref.id}@${b.version}`, reason: "not found" });
      continue;
    }
    kept.push(row.block_id);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO installs (project_id, block_id, version_id, variant, installed_at, verified_at, passed, removed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT (project_id, block_id) DO UPDATE SET version_id = excluded.version_id, variant = excluded.variant,
           verified_at = COALESCE(excluded.verified_at, installs.verified_at), passed = COALESCE(excluded.passed, installs.passed), removed_at = NULL`,
      ).bind(projectId, row.block_id, row.version_id, b.variant ?? null, ts, b.verified_at ?? null, b.passed === undefined ? null : b.passed ? 1 : 0),
    );
  }
  const placeholders = kept.map(() => "?").join(", ");
  stmts.push(
    env.DB.prepare(`UPDATE installs SET removed_at = ? WHERE project_id = ? AND removed_at IS NULL${kept.length ? ` AND block_id NOT IN (${placeholders})` : ""}`).bind(
      ts, projectId, ...kept,
    ),
  );
  const res = await env.DB.batch(stmts);
  const removed = res[res.length - 1]?.meta.changes ?? 0;
  return { project_id: projectId, installs: kept.length, removed, skipped };
}
