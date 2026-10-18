// Reading blocks: resolving `@scope/name` + version-or-tag for a caller, the registry_get details, single files,
// bundles, tags and yanking.
import {
  base64Encode,
  bundlePath,
  buildSummary,
  defaultVariant,
  filesForVariant,
  isText,
  ManifestSchema,
  tryDecodeUtf8,
  UNTRUSTED_NOTICE,
  VERSION_RE,
  TAG_RE,
  type Manifest,
  type SummaryT,
} from "@kitbash/core";
import type { TrustT } from "@kitbash/core/contract";
import semver from "semver";
import { registryKey } from "./keys";
import { membership, orgBySlug } from "./orgs";
import { ApiError, type Bindings, type Caller } from "./types";
import { now, scopeSlug, SLUG_RE } from "./util";

export interface BlockRow {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  visibility: "private" | "public";
  license: string;
  created_at: string;
  yanked_at: string | null;
}

export interface VersionRow {
  id: string;
  block_id: string;
  version: string;
  prerelease: number;
  manifest_json: string;
  manifest_sha256: string;
  publisher_sig: string;
  publisher_key_id: string | null;
  registry_sig: string;
  scan_tier: TrustT["tier"];
  scan_json: string;
  size_json: string;
  cards_json: string;
  changelog_md: string | null;
  status: "active" | "yanked";
  published_at: string;
  yanked_at: string | null;
}

export interface Resolved {
  block: BlockRow;
  version: VersionRow;
  /** The stored manifest, raw (what was signed, plus the two signatures). */
  raw: Record<string, unknown>;
  manifest: Manifest;
  id: string;
}

export const blobKey = (orgId: string, sha256: string) => `orgs/${orgId}/blobs/${sha256}`;

export function blockIdOf(b: { slug: string; name: string }): string {
  return `@${b.slug}/${b.name}`;
}

export function canRead(caller: Caller, b: { org_id: string; visibility: string }): boolean {
  return b.visibility === "public" || !!membership(caller, b.org_id);
}

/** The block, if it exists and the caller may see it; otherwise 404 (private blocks of other orgs included). */
export async function findBlock(env: Bindings, caller: Caller, scope: string, name: string): Promise<BlockRow> {
  if (!SLUG_RE.test(name)) throw new ApiError("invalid_params", `bad block name ${JSON.stringify(name)}`, { rule: "name" });
  const org = await orgBySlug(env, scope);
  const id = `@${scopeSlug(scope)}/${name}`;
  if (!org) throw new ApiError("not_found", `no block ${id}`);
  const b = await env.DB.prepare(
    "SELECT b.id, b.org_id, o.slug, b.name, b.visibility, b.license, b.created_at, b.yanked_at FROM blocks b JOIN orgs o ON o.id = b.org_id WHERE b.org_id = ? AND b.name = ?",
  )
    .bind(org.id, name)
    .first<BlockRow>();
  if (!b || !canRead(caller, b)) throw new ApiError("not_found", `no block ${id}`);
  return b;
}

/** The same block, for a write: the caller must be a member of its org. */
export async function findOwnBlock(env: Bindings, caller: Caller, scope: string, name: string): Promise<BlockRow> {
  const b = await findBlock(env, caller, scope, name);
  if (!membership(caller, b.org_id)) throw new ApiError("forbidden", `only members of @${b.slug} may change ${blockIdOf(b)}`);
  return b;
}

export function parseStored(row: VersionRow): { raw: Record<string, unknown>; manifest: Manifest } {
  const raw = JSON.parse(row.manifest_json) as Record<string, unknown>;
  return { raw, manifest: ManifestSchema.parse(raw) };
}

/** Resolves `ref` (exact version or tag) to a version row. Tags never resolve to yanked versions. */
export async function resolveVersion(
  env: Bindings,
  caller: Caller,
  scope: string,
  name: string,
  ref: string,
  opts: { allowYanked?: boolean } = {},
): Promise<Resolved> {
  const block = await findBlock(env, caller, scope, name);
  const id = blockIdOf(block);
  let row: VersionRow | null;
  if (VERSION_RE.test(ref)) {
    row = await env.DB.prepare("SELECT * FROM block_versions WHERE block_id = ? AND version = ?").bind(block.id, ref).first<VersionRow>();
    if (!row) throw new ApiError("not_found", `no version ${id}@${ref}`);
    if (row.status === "yanked" && !opts.allowYanked) {
      throw new ApiError("version_yanked", `${id}@${ref} was yanked${row.yanked_at ? ` at ${row.yanked_at}` : ""}; pass allow_yanked=1 to read it anyway`);
    }
  } else if (TAG_RE.test(ref)) {
    row = await env.DB.prepare(
      "SELECT v.* FROM block_tags t JOIN block_versions v ON v.id = t.version_id WHERE t.block_id = ? AND t.tag = ? AND v.status = 'active'",
    )
      .bind(block.id, ref)
      .first<VersionRow>();
    if (!row) throw new ApiError("not_found", `no tag ${id}@${ref}`);
  } else {
    throw new ApiError("invalid_params", `bad version or tag ${JSON.stringify(ref)}`, { rule: "version" });
  }
  const { raw, manifest } = parseStored(row);
  return { block, version: row, raw, manifest, id };
}

export function trustOf(v: VersionRow): TrustT {
  return { tier: v.scan_tier, sandbox: "not_run" };
}

export function pickVariant(r: Resolved, variant: string | undefined | null): string {
  if (!variant) return defaultVariant(r.manifest).id;
  if (!r.manifest.variants.some((v) => v.id === variant)) throw new ApiError("not_found", `${r.id}@${r.version.version} has no variant ${variant}`);
  return variant;
}

export function summaryOf(r: Resolved, variant?: string | null): SummaryT {
  return buildSummary(r.manifest, { id: r.id, variant: pickVariant(r, variant), trust: trustOf(r.version), changelog: r.version.changelog_md ?? undefined });
}

export function manifestDetail(r: Resolved) {
  return { detail: "manifest" as const, id: r.id, version: r.version.version, manifest: r.raw };
}

export function filesDetail(r: Resolved, variant?: string | null) {
  const v = pickVariant(r, variant);
  const files = filesForVariant(r.manifest, v).map((f) => ({
    path: f.path,
    target: f.target ?? `.kit/blocks/${r.manifest.name}/${f.path}`,
    role: f.role,
    ...(f.variant ? { variant: f.variant } : {}),
    ...(f.merge ? { merge: f.merge } : {}),
    sha256: f.sha256!,
    bytes: f.bytes ?? 0,
  }));
  return { detail: "files" as const, id: r.id, version: r.version.version, variant: v, files };
}

async function fileRow(env: Bindings, versionId: string, path: string) {
  return env.DB.prepare("SELECT path, sha256, bytes FROM block_files WHERE version_id = ? AND path = ?").bind(versionId, path).first<{ path: string; sha256: string; bytes: number }>();
}

export async function readBlob(env: Bindings, orgId: string, sha256: string): Promise<Uint8Array> {
  const obj = await env.BLOBS.get(blobKey(orgId, sha256));
  if (!obj) throw new ApiError("internal", `blob ${sha256} is missing from storage`);
  return new Uint8Array(await obj.arrayBuffer());
}

export async function skillDetail(env: Bindings, r: Resolved) {
  const p = r.manifest.skill;
  const row = p ? await fileRow(env, r.version.id, p) : null;
  if (!row) throw new ApiError("not_found", `${r.id}@${r.version.version} has no SKILL.md`);
  const md = tryDecodeUtf8(await readBlob(env, r.block.org_id, row.sha256)) ?? "";
  return { detail: "skill" as const, id: r.id, version: r.version.version, untrusted_author_text: { notice: UNTRUSTED_NOTICE, skill_md: md } };
}

export function changelogDetail(r: Resolved) {
  if (r.version.changelog_md === null) throw new ApiError("not_found", `${r.id}@${r.version.version} has no CHANGELOG.md`);
  return { detail: "changelog" as const, id: r.id, version: r.version.version, untrusted_author_text: { notice: UNTRUSTED_NOTICE, changelog: r.version.changelog_md } };
}

/** registry_read_file: `path` is a files[].path of the variant, or a block-relative path. */
export async function readFile(env: Bindings, r: Resolved, path: string, variant?: string | null) {
  if (!path) throw new ApiError("invalid_params", "path is required", { rule: "path" });
  const v = pickVariant(r, variant);
  const entry = filesForVariant(r.manifest, v).find((f) => f.path === path);
  const bp = entry ? bundlePath(r.manifest, entry) : path;
  const row = await fileRow(env, r.version.id, bp);
  if (!row) throw new ApiError("not_found", `${r.id}@${r.version.version} has no file ${path}`);
  const data = await readBlob(env, r.block.org_id, row.sha256);
  const text = isText(data) ? tryDecodeUtf8(data) : null;
  return text !== null
    ? { content: text, encoding: "utf8" as const, sha256: row.sha256, bytes: row.bytes }
    : { content: base64Encode(data), encoding: "base64" as const, sha256: row.sha256, bytes: row.bytes };
}

export async function bundle(env: Bindings, r: Resolved, variant?: string | null) {
  const v = pickVariant(r, variant);
  const { results } = await env.DB.prepare("SELECT path, sha256, bytes FROM block_files WHERE version_id = ? ORDER BY path")
    .bind(r.version.id)
    .all<{ path: string; sha256: string; bytes: number }>();
  const files = await Promise.all(
    results.map(async (f) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes, content_b64: base64Encode(await readBlob(env, r.block.org_id, f.sha256)) })),
  );
  const key = r.version.publisher_key_id
    ? await env.DB.prepare("SELECT public_key FROM publisher_keys WHERE id = ?").bind(r.version.publisher_key_id).first<{ public_key: string }>()
    : null;
  return {
    id: r.id,
    version: r.version.version,
    variant: v,
    manifest: r.raw,
    manifest_sha256: r.version.manifest_sha256,
    publisher_signature: r.version.publisher_sig,
    publisher_key: key?.public_key ?? null,
    registry_signature: r.version.registry_sig,
    registry_key: (await registryKey(env)).publicKey,
    ...(r.version.changelog_md !== null ? { changelog: r.version.changelog_md } : {}),
    files,
  };
}

// ---------- versions, tags, yank ----------

export async function tagsOf(env: Bindings, blockId: string): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare("SELECT t.tag, v.version FROM block_tags t JOIN block_versions v ON v.id = t.version_id WHERE t.block_id = ? ORDER BY t.tag")
    .bind(blockId)
    .all<{ tag: string; version: string }>();
  return Object.fromEntries(results.map((x) => [x.tag, x.version]));
}

/** The version `latest` should point at: the highest active non-prerelease version. */
export function latestOf<T extends { version: string; status: string }>(versions: T[]): T | undefined {
  return versions.filter((v) => v.status === "active" && !semver.prerelease(v.version)).sort((a, b) => semver.rcompare(a.version, b.version))[0];
}

export async function blockInfo(env: Bindings, caller: Caller, scope: string, name: string) {
  const b = await findBlock(env, caller, scope, name);
  const { results } = await env.DB.prepare("SELECT version, status, published_at, yanked_at, manifest_sha256, scan_tier FROM block_versions WHERE block_id = ?")
    .bind(b.id)
    .all<{ version: string; status: string; published_at: string; yanked_at: string | null; manifest_sha256: string; scan_tier: string }>();
  const versions = results
    .sort((x, y) => semver.rcompare(x.version, y.version))
    .map(({ yanked_at, ...v }) => ({ ...v, ...(yanked_at ? { yanked_at } : {}) }));
  return { id: blockIdOf(b), visibility: b.visibility, license: b.license, created_at: b.created_at, tags: await tagsOf(env, b.id), versions };
}

export async function setTag(env: Bindings, caller: Caller, scope: string, name: string, tag: string, version: string | null) {
  const b = await findOwnBlock(env, caller, scope, name);
  if (!TAG_RE.test(tag)) throw new ApiError("invalid_params", `bad tag ${JSON.stringify(tag)}: [a-z][a-z0-9-]*`, { rule: "tag" });
  if (version === null) {
    await env.DB.prepare("DELETE FROM block_tags WHERE block_id = ? AND tag = ?").bind(b.id, tag).run();
  } else {
    if (!VERSION_RE.test(version)) throw new ApiError("invalid_params", `bad version ${JSON.stringify(version)}`, { rule: "version" });
    const v = await env.DB.prepare("SELECT id, status FROM block_versions WHERE block_id = ? AND version = ?").bind(b.id, version).first<{ id: string; status: string }>();
    if (!v) throw new ApiError("not_found", `no version ${blockIdOf(b)}@${version}`);
    if (v.status === "yanked") throw new ApiError("version_yanked", `${blockIdOf(b)}@${version} is yanked; it cannot be tagged`);
    await env.DB.prepare(
      "INSERT INTO block_tags (block_id, tag, version_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (block_id, tag) DO UPDATE SET version_id = excluded.version_id, updated_at = excluded.updated_at",
    )
      .bind(b.id, tag, v.id, now())
      .run();
  }
  await event(env, b.org_id, caller.member.id, "block.tag", blockIdOf(b), { tag, version });
  return { id: blockIdOf(b), tags: await tagsOf(env, b.id) };
}

export async function yank(env: Bindings, caller: Caller, scope: string, name: string, version: string, reason: string | undefined) {
  const b = await findOwnBlock(env, caller, scope, name);
  if (!VERSION_RE.test(version)) throw new ApiError("invalid_params", `bad version ${JSON.stringify(version)}`, { rule: "version" });
  const v = await env.DB.prepare("SELECT id, status, yanked_at FROM block_versions WHERE block_id = ? AND version = ?").bind(b.id, version).first<{ id: string; status: string; yanked_at: string | null }>();
  if (!v) throw new ApiError("not_found", `no version ${blockIdOf(b)}@${version}`);
  let yankedAt = v.yanked_at;
  if (v.status !== "yanked") {
    yankedAt = now();
    await env.DB.prepare("UPDATE block_versions SET status = 'yanked', yanked_at = ?, yank_reason = ? WHERE id = ?").bind(yankedAt, reason ?? null, v.id).run();
    await env.DB.prepare("DELETE FROM block_tags WHERE version_id = ?").bind(v.id).run();
    await moveLatest(env, b.id);
    await event(env, b.org_id, caller.member.id, "block.yank", `${blockIdOf(b)}@${version}`, { reason: reason ?? null });
  }
  return { id: blockIdOf(b), version, status: "yanked" as const, yanked_at: yankedAt, tags: await tagsOf(env, b.id) };
}

/** Points `latest` at latestOf(all versions), or removes it when no candidate remains. */
export async function moveLatest(env: Bindings, blockId: string): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id, version, status FROM block_versions WHERE block_id = ?").bind(blockId).all<{ id: string; version: string; status: string }>();
  const best = latestOf(results);
  if (!best) {
    await env.DB.prepare("DELETE FROM block_tags WHERE block_id = ? AND tag = 'latest'").bind(blockId).run();
    return;
  }
  await env.DB.prepare(
    "INSERT INTO block_tags (block_id, tag, version_id, updated_at) VALUES (?, 'latest', ?, ?) ON CONFLICT (block_id, tag) DO UPDATE SET version_id = excluded.version_id, updated_at = excluded.updated_at",
  )
    .bind(blockId, best.id, now())
    .run();
}

export async function event(env: Bindings, orgId: string | null, memberId: string | null, kind: string, ref: string | null, payload?: unknown): Promise<void> {
  await env.DB.prepare("INSERT INTO events (org_id, member_id, kind, ref, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(orgId, memberId, kind, ref, payload === undefined ? null : JSON.stringify(payload), now())
    .run();
}
