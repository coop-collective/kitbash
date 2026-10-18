// Publishing a block version (PLAN WP-02, docs/API.md): validate with core, verify the publisher's signature,
// store content-addressed blobs per org, precompute cards and the search row, co-sign, move `latest`.
import {
  base64Decode,
  buildCard,
  buildSummary,
  coSignBundle,
  DEFAULT_PATHS,
  estimateJsonTokens,
  defaultParamValues,
  KitError,
  keyIdOf,
  manifestSha256,
  pathProblem,
  publishAllowed,
  renderTemplate,
  renderedTables,
  sha256Hex,
  tryDecodeUtf8,
  validateBlock,
  verifyBundleSignature,
  VERSION_RE,
  bundlePath,
  type CardT,
  type Finding,
  type Manifest,
} from "@kitbash/core";
import semver from "semver";
import { z } from "zod";
import { blobKey, event, latestOf, tagsOf } from "./blocks";
import { registryKey } from "./keys";
import { requireOrgMember } from "./orgs";
import { ApiError, type ApiFinding, type Bindings, type Caller } from "./types";
import { newId, now, SLUG_RE } from "./util";

export const MAX_BLOCK_BYTES = 2 * 1024 * 1024;

const FileIn = z.strictObject({
  path: z.string().min(1).max(512),
  variant: z.string().max(64).optional(),
  content_b64: z.string().optional(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});

export const PublishBody = z.strictObject({
  manifest: z.record(z.string(), z.unknown()),
  files: z.array(FileIn).max(400),
  publisher_signature: z.string().max(200).optional(),
  publisher_key: z.string().max(100).optional(),
  visibility: z.enum(["private", "public"]).default("private"),
  tag: z.union([z.string(), z.array(z.string()).max(5)]).optional(),
});
export type PublishBodyT = z.infer<typeof PublishBody>;

/** Search fills `score` with two decimals; cards are sized at publish with the widest score so they stay in budget. */
export const WIDEST_SCORE = 0.99;
export const CARD_TOKENS = 99;

/** core's buildCard keeps a card at <= 100 tokens; the registry keeps it under 100 with the score filled in. */
export function fitCard(card: CardT): CardT {
  const c = { ...card };
  const size = () => {
    const { summary: _s, ...rest } = c;
    return estimateJsonTokens(rest);
  };
  while (size() > CARD_TOKENS && c.title.length > 30) c.title = `${c.title.slice(0, Math.floor(c.title.length * 0.8)).trimEnd()}…`;
  return c;
}

const toApiFinding = (f: Finding): ApiFinding => ({ rule: f.rule, path: f.path, severity: f.severity, detail: f.detail });

function searchText(m: Manifest) {
  const defaults = defaultParamValues(m);
  const render = (s: string) => {
    try {
      return renderTemplate(s, { params: defaults, paths: { ...DEFAULT_PATHS } });
    } catch {
      return s.replace(/\{\{[^}]*\}\}/g, " ");
    }
  };
  let tables: string[];
  try {
    tables = renderedTables(m, defaults);
  } catch {
    tables = (m.tables ?? []).map(render);
  }
  const stack = new Set<string>();
  for (const v of [m.stack, ...m.variants.map((x) => x.stack ?? {})]) for (const val of Object.values(v)) if (typeof val === "string") stack.add(val);
  for (const v of m.variants) stack.add(v.id);
  return {
    title: m.title,
    description: m.description,
    categories: (m.categories ?? []).join(" "),
    tables_text: tables.join(" "),
    routes_text: (m.routes ?? []).map((r) => `${r.method} ${render(r.path)}`).join(" "),
    stack_text: [...stack].join(" "),
  };
}

/** Resolves the request's file list into the block-relative tree core validates and signs. */
async function collectFiles(env: Bindings, orgId: string, manifest: Record<string, unknown>, files: z.infer<typeof FileIn>[]) {
  const variants = Array.isArray(manifest.variants) ? (manifest.variants as { id?: unknown; root?: unknown }[]) : [];
  const tree: Record<string, Uint8Array> = {};
  let total = 0;
  for (const f of files) {
    let path = f.path;
    if (f.variant !== undefined) {
      const v = variants.find((x) => x.id === f.variant);
      if (!v || typeof v.root !== "string") throw new ApiError("invalid_params", `file ${f.path}: the manifest has no variant ${f.variant}`, { rule: "unknown_variant" });
      path = `${v.root.replace(/\/+$/, "")}/${f.path}`;
    }
    const prob = pathProblem(path);
    if (prob) {
      const rule = prob === "traversal" ? "path_traversal" : prob === "absolute" ? "absolute_path" : "invalid_path";
      throw new ApiError("invalid_params", `file path ${JSON.stringify(path)}: ${prob.replace(/_/g, " ")}`, { rule });
    }
    if (path === "block.json") throw new ApiError("invalid_params", "block.json is the manifest field, not a file", { rule: "invalid_path" });
    if (Object.hasOwn(tree, path)) throw new ApiError("invalid_params", `file ${path} is listed twice`, { rule: "duplicate_path" });
    if ((f.content_b64 === undefined) === (f.sha256 === undefined)) {
      throw new ApiError("invalid_params", `file ${path}: give exactly one of content_b64 or sha256`, { rule: "file_source" });
    }
    let data: Uint8Array;
    if (f.content_b64 !== undefined) {
      try {
        data = base64Decode(f.content_b64);
      } catch {
        throw new ApiError("invalid_params", `file ${path}: content_b64 is not base64`, { rule: "base64" });
      }
    } else {
      const obj = await env.BLOBS.get(blobKey(orgId, f.sha256!));
      if (!obj) throw new ApiError("invalid_params", `file ${path}: blob ${f.sha256} was not uploaded to this scope (PUT /api/blobs/:sha256)`, { rule: "blob_missing" });
      data = new Uint8Array(await obj.arrayBuffer());
    }
    total += data.byteLength;
    if (total > MAX_BLOCK_BYTES) throw new ApiError("invalid_params", `the block is over ${MAX_BLOCK_BYTES} bytes`, { status: 413, rule: "too_large" });
    tree[path] = data;
  }
  return tree;
}

export async function publish(env: Bindings, caller: Caller, scope: string, name: string, body: PublishBodyT) {
  const org = await requireOrgMember(env, caller, scope);
  if (!SLUG_RE.test(name)) throw new ApiError("invalid_params", `bad block name ${JSON.stringify(name)}`, { rule: "name" });
  const manifest = body.manifest;
  if (manifest.name !== name) throw new ApiError("invalid_params", `manifest name ${JSON.stringify(manifest.name)} does not match the URL (${name})`, { rule: "name_mismatch" });
  const version = manifest.version;
  if (typeof version !== "string" || !VERSION_RE.test(version)) throw new ApiError("invalid_params", "manifest version must be semver", { rule: "version" });
  const id = `@${org.slug}/${name}`;

  const existing = await env.DB.prepare("SELECT id, visibility FROM blocks WHERE org_id = ? AND name = ?").bind(org.id, name).first<{ id: string; visibility: string }>();
  if (existing) {
    const dup = await env.DB.prepare("SELECT 1 FROM block_versions WHERE block_id = ? AND version = ?").bind(existing.id, version).first();
    if (dup) throw new ApiError("conflicts", `${id}@${version} already exists; versions are immutable (bump the version)`);
  }

  const files = await collectFiles(env, org.id, manifest, body.files);

  // schema + client scanner (core); public publishes also refuse warnings
  const report = await validateBlock({ manifest, files });
  if (!report.manifest || !publishAllowed(report.findings, body.visibility)) {
    const refused = report.findings.filter((f) => f.severity === "block" || (body.visibility === "public" && f.severity === "warn"));
    throw new ApiError("scan_refused", `the scanner refused ${id}@${version} (${refused.length} finding${refused.length === 1 ? "" : "s"})`, { findings: refused.map(toApiFinding) });
  }
  const m = report.manifest;
  const unhashed = m.files.filter((f) => !f.sha256).map((f) => bundlePath(m, f));
  if (unhashed.length) {
    throw new ApiError("invalid_params", `files[].sha256 missing for ${unhashed.join(", ")}: fill them (core fillFileHashes) and sign that manifest`, { rule: "hash_missing" });
  }

  // the publisher's signature, then the key's registration (MVP: trust on first use, bound to the member)
  const pubSig = body.publisher_signature ?? (m.provenance?.signature as string | undefined);
  if (!pubSig || !body.publisher_key) throw new ApiError("invalid_params", "publisher_signature and publisher_key are required (core signBundle)", { rule: "signature_missing" });
  let keyId: string;
  try {
    keyId = await keyIdOf(body.publisher_key);
  } catch (e) {
    throw new ApiError("signature_invalid", (e as Error).message);
  }
  if (!(await verifyBundleSignature(manifest, files, pubSig, body.publisher_key, "publisher"))) {
    throw new ApiError("signature_invalid", "the publisher signature does not verify against publisher_key for this manifest and these files");
  }
  const key = await env.DB.prepare("SELECT member_id, revoked_at FROM publisher_keys WHERE public_key = ?").bind(body.publisher_key).first<{ member_id: string; revoked_at: string | null }>();
  if (key && key.member_id !== caller.member.id) throw new ApiError("forbidden", "publisher_key is registered to another member");
  if (key?.revoked_at) throw new ApiError("signature_invalid", "publisher_key was revoked");

  // tier, summaries (budget) and cards per variant
  const findings = report.findings.map(toApiFinding);
  const tier = report.findings.some((f) => f.severity !== "info") ? ("unreviewed" as const) : ("scanned" as const);
  const trust = { tier, sandbox: "not_run" as const };
  const changelogBytes = files["CHANGELOG.md"];
  const changelog = changelogBytes ? (tryDecodeUtf8(changelogBytes) ?? undefined) : undefined;
  const cards: Record<string, CardT> = {};
  let summaryTokens = 0;
  for (const v of m.variants) {
    try {
      const s = buildSummary(m, { id, variant: v.id, trust, changelog });
      summaryTokens = Math.max(summaryTokens, s.size.summary_tokens ?? 0);
    } catch (e) {
      if (e instanceof KitError && e.rule === "budget") {
        throw new ApiError("scan_refused", e.message, { findings: [{ rule: "budget", path: "block.json", severity: "block", detail: `variant ${v.id}: ${e.message}` }] });
      }
      throw e;
    }
    cards[v.id] = fitCard(buildCard(m, { id, variant: v.id, trust, score: WIDEST_SCORE }));
  }

  // co-sign, then store
  const rk = await registryKey(env);
  const regSig = await coSignBundle(manifest, files, pubSig, rk.jwk);
  const stored = structuredClone(manifest) as Record<string, unknown> & { provenance?: Record<string, unknown> };
  stored.provenance = { ...(stored.provenance ?? {}), signature: pubSig, registry_signature: regSig, scan: { tier, at: now(), findings: findings.length } };
  const msha = await manifestSha256(manifest);

  const hashes: Record<string, string> = {};
  for (const [p, data] of Object.entries(files)) hashes[p] = await sha256Hex(data);
  for (const [p, data] of Object.entries(files)) {
    const k = blobKey(org.id, hashes[p]!);
    if (!(await env.BLOBS.head(k))) await env.BLOBS.put(k, data);
  }

  const ts = now();
  const versionId = newId("ver");
  const blockId = existing?.id ?? newId("blk");
  const declared = new Map(m.files.map((f) => [bundlePath(m, f), f]));
  const stmts: D1PreparedStatement[] = [];
  if (!existing) {
    stmts.push(
      env.DB.prepare("INSERT INTO blocks (id, org_id, name, visibility, license, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
        blockId, org.id, name, body.visibility, m.license, m.provenance?.origin ?? null, ts,
      ),
    );
  } else {
    stmts.push(env.DB.prepare("UPDATE blocks SET visibility = ?, license = ? WHERE id = ?").bind(body.visibility, m.license, blockId));
  }
  if (!key) {
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO publisher_keys (id, member_id, public_key, created_at) VALUES (?, ?, ?, ?)").bind(keyId, caller.member.id, body.publisher_key, ts));
  }
  const st = searchText(m);
  stmts.push(
    env.DB.prepare(
      `INSERT INTO block_versions (id, block_id, version, prerelease, manifest_json, manifest_sha256, publisher_sig, publisher_key_id, registry_sig,
         scan_tier, scan_json, size_json, cards_json, changelog_md, status, published_by, published_at,
         title, description, categories, tables_text, routes_text, stack_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      versionId, blockId, version, semver.prerelease(version) ? 1 : 0, JSON.stringify(stored), msha, pubSig, keyId, regSig,
      tier, JSON.stringify(findings), JSON.stringify({ ...(report.size ?? { files: m.files.length, lines: 0 }), summary_tokens: summaryTokens }),
      JSON.stringify(cards), changelog ?? null, caller.member.id, ts,
      st.title, st.description, st.categories, st.tables_text, st.routes_text, st.stack_text,
    ),
  );
  for (const [p, data] of Object.entries(files)) {
    const f = declared.get(p);
    stmts.push(
      env.DB.prepare("INSERT INTO block_files (version_id, path, file_path, variant, target, role, merge, sha256, bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
        versionId, p, f?.path ?? p, f?.variant ?? null, f?.target ?? null, f?.role ?? "meta", f?.merge ?? null, hashes[p]!, data.byteLength,
      ),
    );
  }
  // latest: computed over the existing versions plus this one
  const { results: prior } = existing
    ? await env.DB.prepare("SELECT id, version, status FROM block_versions WHERE block_id = ?").bind(blockId).all<{ id: string; version: string; status: string }>()
    : { results: [] as { id: string; version: string; status: string }[] };
  const latest = latestOf([...prior, { id: versionId, version, status: "active" }]);
  const tagUpsert = (tag: string, vid: string) =>
    env.DB.prepare(
      "INSERT INTO block_tags (block_id, tag, version_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (block_id, tag) DO UPDATE SET version_id = excluded.version_id, updated_at = excluded.updated_at",
    ).bind(blockId, tag, vid, ts);
  if (latest) stmts.push(tagUpsert("latest", latest.id));
  for (const t of body.tag === undefined ? [] : Array.isArray(body.tag) ? body.tag : [body.tag]) {
    if (!/^[a-z][a-z0-9-]*$/.test(t) || t === "latest") throw new ApiError("invalid_params", `bad tag ${JSON.stringify(t)} (latest is managed by the registry)`, { rule: "tag" });
    stmts.push(tagUpsert(t, versionId));
  }
  stmts.push(
    env.DB.prepare("INSERT INTO events (org_id, member_id, kind, ref, payload, created_at) VALUES (?, ?, 'block.publish', ?, ?, ?)").bind(
      org.id, caller.member.id, `${id}@${version}`, JSON.stringify({ tier, findings: findings.length, visibility: body.visibility }), ts,
    ),
  );
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    if (/UNIQUE constraint failed: block_versions/.test(String((e as Error)?.message ?? e))) {
      throw new ApiError("conflicts", `${id}@${version} already exists; versions are immutable (bump the version)`);
    }
    throw e;
  }
  try {
    await env.SCAN.send({ version_id: versionId });
  } catch (e) {
    // the queue is a stub until WP-12; publishing never depends on it
    await event(env, org.id, caller.member.id, "scan.enqueue_failed", `${id}@${version}`, { error: String(e) });
  }

  return {
    id,
    version,
    manifest_sha256: msha,
    registry_signature: regSig,
    registry_key: rk.publicKey,
    publisher_key_id: keyId,
    scan: { tier, findings },
    card: cards[m.variants.find((v) => v.default)?.id ?? m.variants[0]!.id]!,
    size: { ...(report.size ?? { files: m.files.length, lines: 0 }), summary_tokens: summaryTokens },
    tags: await tagsOf(env, blockId),
    url: `/api/blocks/${org.slug}/${name}/${version}/summary`,
  };
}

// ---------- blobs ----------

export async function putBlob(env: Bindings, caller: Caller, sha256: string, scope: string | undefined, data: Uint8Array) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new ApiError("invalid_params", "the blob path is /api/blobs/<sha256, 64 lower-case hex>", { rule: "sha256" });
  const org = await requireOrgMember(env, caller, scope);
  if (data.byteLength > MAX_BLOCK_BYTES) throw new ApiError("invalid_params", `a blob is at most ${MAX_BLOCK_BYTES} bytes`, { status: 413, rule: "too_large" });
  if ((await sha256Hex(data)) !== sha256) throw new ApiError("invalid_params", "the body does not hash to the sha256 in the path", { rule: "hash_mismatch" });
  const k = blobKey(org.id, sha256);
  const existed = !!(await env.BLOBS.head(k));
  if (!existed) await env.BLOBS.put(k, data);
  return { sha256, bytes: data.byteLength, existed };
}

export async function getBlob(env: Bindings, caller: Caller, sha256: string, scope: string | undefined): Promise<Uint8Array | null> {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new ApiError("invalid_params", "the blob path is /api/blobs/<sha256, 64 lower-case hex>", { rule: "sha256" });
  const org = await requireOrgMember(env, caller, scope);
  const obj = await env.BLOBS.get(blobKey(org.id, sha256));
  return obj ? new Uint8Array(await obj.arrayBuffer()) : null; // a fresh buffer: .buffer is exactly the blob
}
