// Proposals (DESIGN §3.5, MVP): a patch against a block version, stored in R2 with status `draft`. Review and
// accept/decline are WP-21.
import { findSecrets, parseBlockRef } from "@kitbash/core";
import { z } from "zod";
import { resolveVersion, event } from "./blocks";
import { ApiError, type Bindings, type Caller } from "./types";
import { newId, now } from "./util";

export const MAX_PATCH_BYTES = 1024 * 1024;

export const ProposalBody = z.strictObject({
  block: z.string().max(200),
  version: z.string().max(64).optional(),
  title: z.string().min(1).max(200),
  rationale: z.string().min(1).max(4000),
  patch: z.string().min(1),
  stack: z.record(z.string(), z.string().max(64)).optional(),
  redactions: z.array(z.string().max(200)).max(100).optional(),
});
export type ProposalBodyT = z.infer<typeof ProposalBody>;

export async function propose(env: Bindings, caller: Caller, body: ProposalBodyT) {
  const ref = parseBlockRef(body.block);
  const version = body.version ?? ref.version ?? ref.tag;
  if (!version) throw new ApiError("invalid_params", "name the base version: block @scope/name@x.y.z or a version field", { rule: "version" });
  const r = await resolveVersion(env, caller, ref.scope, ref.name, version, { allowYanked: true });
  if (new TextEncoder().encode(body.patch).byteLength > MAX_PATCH_BYTES) throw new ApiError("invalid_params", "the patch is over 1 MB", { status: 413, rule: "too_large" });
  const secrets = findSecrets(body.patch).filter((h) => h.confidence === "known");
  if (secrets.length) {
    throw new ApiError("scan_refused", "the patch contains secret values; redact them and resubmit", {
      findings: secrets.map((h) => ({ rule: "secret", path: "patch", severity: "block" as const, detail: `${h.kind} (line ${h.line})` })),
    });
  }
  const id = newId("prop");
  const key = `orgs/${r.block.org_id}/proposals/${id}.patch`;
  const hunks = body.patch.split("\n").filter((l) => l.startsWith("@@")).length;
  await env.BLOBS.put(key, body.patch);
  await env.DB.prepare(
    `INSERT INTO proposals (id, block_id, base_version_id, proposer_id, title, rationale, patch_key, hunks, stack_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
  )
    .bind(id, r.block.id, r.version.id, caller.member.id, body.title, body.rationale, key, hunks, body.stack ? JSON.stringify(body.stack) : null, now())
    .run();
  await event(env, r.block.org_id, caller.member.id, "proposal.create", `${r.id}@${r.version.version}`, { proposal: id, hunks });
  return { proposal_id: id, status: "draft" as const, hunks, redactions: body.redactions ?? [] };
}
