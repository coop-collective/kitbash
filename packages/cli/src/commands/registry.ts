/** Registry commands: login, whoami, search, get, publish, heartbeat. Network only through `api.ts`. */
import {
  KitError,
  UNTRUSTED_NOTICE,
  base64Encode,
  buildSummary,
  fillFileHashes,
  parseBlockRef,
  publishAllowed,
  readLock,
  readProfile,
  signBundle,
  toBytes,
  tryDecodeUtf8,
  validateBlock,
  validateManifest,
  type CardT,
} from "@kitbash/core";
import { readBlockDir } from "@kitbash/core/node";
import path from "node:path";
import { createApi } from "../api.ts";
import { bool, int, list, need, oneOf, stack, str, type Parsed } from "../args.ts";
import { DEFAULT_API_URL, readCredentials, writeCredentials } from "../config.ts";
import { apiFor } from "../context.ts";
import { json, line, sanitizeLine, untrusted, untrustedEnvelope, type Io } from "../io.ts";
import { loadOrCreatePublisherKey } from "../keys.ts";
import { openProject } from "../project.ts";
import { isLocalSpec, loadLocalBlock } from "../source.ts";
import { printFindings } from "./local.ts";

// ---------- login / whoami ----------

export const loginOptions = { token: { type: "string" }, api: { type: "string" }, "registry-key": { type: "string" }, "no-verify": { type: "boolean" } } as const;

const KEY_RE = /^ed25519:[A-Za-z0-9_-]{43}$/;

export async function login(io: Io, a: Parsed): Promise<number> {
  const prev = await readCredentials(io);
  const apiUrl = (str(a, "api") ?? prev.api_url ?? DEFAULT_API_URL).replace(/\/+$/, "");
  let token = str(a, "token");
  if (!token) {
    io.err("Paste your kit token (from `pnpm kit:token` or the web UI), then press Enter:\n");
    token = (await io.readStdin()).trim();
  }
  if (!token || !/^[\x21-\x7e]{8,512}$/.test(token)) throw new KitError("invalid_params", "that does not look like a token (printable, no spaces, 8-512 characters)");
  const api = createApi({ apiUrl, token }, io.fetch);
  let me: Record<string, unknown> = {};
  if (!bool(a, "no-verify")) me = await api.me();
  let key = str(a, "registry-key");
  if (key && !KEY_RE.test(key)) throw new KitError("invalid_params", "--registry-key must be ed25519:<base64url>");
  if (!key && !bool(a, "no-verify")) {
    const fromMe = typeof me.registry_public_key === "string" ? me.registry_public_key : undefined;
    try {
      key = fromMe && KEY_RE.test(fromMe) ? fromMe : await api.registryKey();
    } catch {
      key = undefined;
    }
    // trust on first use: a different key from the same URL is refused unless given explicitly
    if (key && prev.registry_public_key && prev.api_url === apiUrl && key !== prev.registry_public_key) {
      throw new KitError("signature_invalid", `the registry at ${apiUrl} now presents a different signing key than the one pinned; if that is expected, pass --registry-key ${key}`);
    }
  }
  const scope = typeof me.scope_default === "string" ? me.scope_default.replace(/^@/, "") : prev.scope;
  const creds = {
    api_url: apiUrl,
    token,
    ...(key ?? prev.registry_public_key ? { registry_public_key: key ?? prev.registry_public_key } : {}),
    ...(scope ? { scope } : {}),
    ...(typeof me.member === "string" ? { member: me.member } : prev.member ? { member: prev.member } : {}),
  };
  const file = await writeCredentials(io, creds);
  if (bool(a, "json")) json(io, { api_url: apiUrl, member: creds.member ?? null, scope: scope ?? null, registry_key_pinned: !!creds.registry_public_key, credentials: file });
  else {
    line(io, `signed in${creds.member ? ` as ${sanitizeLine(creds.member)}` : ""} to ${apiUrl}; credentials saved to ${file} (0600)`);
    if (creds.registry_public_key) line(io, `registry signing key pinned: ${creds.registry_public_key}`);
    else line(io, "warning: no registry signing key pinned; installs from the registry are refused until one is (kit login --registry-key …)");
    if (io.env.KIT_TOKEN) line(io, "note: KIT_TOKEN is set and wins over the saved token");
  }
  return 0;
}

export async function whoami(io: Io, a: Parsed): Promise<number> {
  const { api } = await apiFor(io);
  const me = await api.me();
  if (bool(a, "json")) json(io, me);
  else line(io, `${sanitizeLine(me.member ?? "?")} · orgs ${sanitizeLine(Array.isArray(me.orgs) ? me.orgs.join(", ") : "?")} · default scope ${sanitizeLine(me.scope_default ?? "?")} · plan ${sanitizeLine(me.plan ?? "?")}`);
  return 0;
}

// ---------- search ----------

export const searchOptions = { stack: { type: "string", multiple: true }, tags: { type: "string", multiple: true }, scope: { type: "string" }, limit: { type: "string" } } as const;

function cardLine(c: CardT): string[] {
  const bits = [
    `${sanitizeLine(c.id)}@${sanitizeLine(c.version)}`,
    sanitizeLine(c.variant),
    `${c.size.files} files/${c.size.lines} lines`,
    `${c.trust.tier}, sandbox ${c.trust.sandbox}`,
    sanitizeLine(c.license),
    ...(c.price ? [`$${(c.price.cents / 100).toFixed(2)} ${c.price.model}`] : []),
    ...(c.lineage ? [sanitizeLine(c.lineage)] : []),
    ...(c.est_hours_saved !== undefined ? [`~${c.est_hours_saved}h saved (author estimate)`] : []),
    `score ${c.score.toFixed(2)}`,
  ];
  const out = [bits.join(" · "), `    title (author): ${sanitizeLine(c.title, 120)}`];
  if (c.summary) out.push(`    summary (author): ${sanitizeLine(c.summary, 160)}`);
  return out;
}

export async function search(io: Io, a: Parsed): Promise<number> {
  const query = a.positionals.join(" ").trim();
  if (!query) throw new KitError("invalid_params", "kit search needs a query");
  let st = stack(a);
  if (!st) {
    // default to the project's stack when there is one
    try {
      const p = await openProject(io, str(a, "root"));
      const pr = await readProfile(p.fs);
      if (pr) st = Object.fromEntries(Object.entries({ runtime: pr.stack.runtime, framework: pr.stack.framework, db: pr.stack.db, ui: pr.stack.ui }).filter(([, v]) => v)) as Record<string, string>;
    } catch {
      st = undefined;
    }
  } else st = Object.fromEntries(Object.entries(st).filter(([k]) => ["runtime", "framework", "db", "ui"].includes(k)));
  const scope = oneOf(str(a, "scope"), ["private", "public", "all"] as const, "--scope");
  const limit = int(str(a, "limit"), "--limit", 1, 20);
  const { api } = await apiFor(io);
  const r = await api.search({ query, ...(st && Object.keys(st).length ? { stack: st } : {}), tags: list(a, "tags"), ...(scope ? { scope } : {}), ...(limit ? { limit } : {}) });
  const results = Array.isArray(r?.results) ? r.results : [];
  if (bool(a, "json")) json(io, { results });
  else if (!results.length) line(io, "no blocks match");
  else {
    line(io, `${results.length} result(s); titles and summaries are written by block authors (untrusted):`);
    for (const c of results) for (const l of cardLine(c)) line(io, l);
    line(io, "next: kit get <id> for the summary, kit install <id> for a dry-run plan");
  }
  return 0;
}

// ---------- get ----------

export const getOptions = { detail: { type: "string" }, version: { type: "string" }, variant: { type: "string" }, id: { type: "string" } } as const;

const DETAILS = ["summary", "manifest", "files", "skill", "changelog"] as const;

async function localDetail(io: Io, spec: string, detail: (typeof DETAILS)[number], variant: string | undefined, id: string | undefined): Promise<Record<string, unknown>> {
  const b = await loadLocalBlock(io, spec, id ? { id } : {});
  const v = validateManifest(b.bundle.manifest);
  if (!v.manifest) throw new KitError("invalid_params", `${spec}: block.json does not validate`);
  const m = v.manifest;
  const text = (p: string | undefined) => (p && b.bundle.files[p] !== undefined ? tryDecodeUtf8(b.bundle.files[p]!) ?? "" : "");
  switch (detail) {
    case "summary":
      return buildSummary(m, { id: b.blockId, ...(variant ? { variant } : {}), changelog: text("CHANGELOG.md") }) as unknown as Record<string, unknown>;
    case "manifest":
      return { detail, id: b.blockId, version: m.version, manifest: b.bundle.manifest as Record<string, unknown> };
    case "files": {
      const vid = variant ?? m.variants.find((x) => x.default)?.id ?? m.variants[0]!.id;
      return { detail, id: b.blockId, version: m.version, variant: vid, files: m.files.filter((f) => !f.variant || f.variant === vid).map((f) => ({ path: f.path, target: f.target ?? "", role: f.role, ...(f.variant ? { variant: f.variant } : {}), ...(f.merge ? { merge: f.merge } : {}) })) };
    }
    case "skill":
      return { detail, id: b.blockId, version: m.version, untrusted_author_text: { notice: UNTRUSTED_NOTICE, skill_md: text(m.skill ?? "SKILL.md") } };
    case "changelog":
      return { detail, id: b.blockId, version: m.version, untrusted_author_text: { notice: UNTRUSTED_NOTICE, changelog: text("CHANGELOG.md") } };
  }
}

function printSummary(io: Io, s: Record<string, any>): void {
  line(io, `${sanitizeLine(s.id)}@${sanitizeLine(s.version)} · variant ${sanitizeLine(s.variant)} · ${sanitizeLine(s.license)} · trust ${s.trust?.tier}/${s.trust?.sandbox} · ${s.size?.files} files/${s.size?.lines} lines`);
  line(io, `title (author): ${sanitizeLine(s.title)}`);
  if (s.stack) line(io, `stack: ${Object.entries(s.stack).map(([k, v]) => `${k}=${sanitizeLine(v)}`).join(", ")}`);
  if (s.params?.length) line(io, `params: ${s.params.map((p: any) => `${sanitizeLine(p.name)}:${p.type}${p.default !== undefined ? `=${sanitizeLine(JSON.stringify(p.default))}` : ""}${p.required ? " (required)" : ""}`).join(", ")}`);
  if (s.env?.length) line(io, `env: ${s.env.map((e: any) => sanitizeLine(e.name)).join(", ")}`);
  if (s.secrets?.length) line(io, `secrets (names only): ${s.secrets.map((e: any) => sanitizeLine(e.name)).join(", ")}`);
  if (s.bindings?.length) line(io, `bindings: ${s.bindings.map((b: any) => `${sanitizeLine(b.type)}:${sanitizeLine(b.name)}`).join(", ")}`);
  if (s.tables?.length) line(io, `tables: ${s.tables.map((t: string) => sanitizeLine(t)).join(", ")}`);
  if (s.routes?.length) line(io, `routes: ${s.routes.map((r: any) => `${sanitizeLine(r.method)} ${sanitizeLine(r.path)} (${sanitizeLine(r.auth)})`).join(", ")}`);
  if (s.migrations?.length) line(io, `migrations: ${s.migrations.map((m: any) => sanitizeLine(m.name)).join(", ")}`);
  if (s.dependencies?.length) line(io, `dependencies: ${s.dependencies.map((d: string) => sanitizeLine(d)).join(", ")}`);
  if (s.verify) line(io, `verify: ${(s.verify.commands ?? []).map((c: string) => sanitizeLine(c)).join(" ; ") || "(none)"}`);
  for (const x of s.verify?.skipped ?? []) line(io, `verify skipped (not allowlisted, never run): ${sanitizeLine(x.command)}`);
  if (s.est_hours_saved !== undefined) line(io, `est. hours saved (author): ${sanitizeLine(s.est_hours_saved)}`);
  const u = untrustedEnvelope(s.untrusted_author_text);
  if (u) line(io, u);
}

export async function get(io: Io, a: Parsed): Promise<number> {
  const spec = need(a, 0, "block reference or block directory");
  const detail = oneOf(str(a, "detail"), DETAILS, "--detail") ?? "summary";
  const variant = str(a, "variant");
  let out: Record<string, any>;
  if (isLocalSpec(spec)) out = await localDetail(io, spec, detail, variant, str(a, "id"));
  else {
    const { api } = await apiFor(io);
    const { id, version } = await api.resolveVersion(spec, str(a, "version"));
    out = await api.get(id, version, detail, variant);
  }
  if (bool(a, "json")) {
    json(io, out);
    return 0;
  }
  switch (detail) {
    case "summary":
      printSummary(io, out);
      break;
    case "files":
      line(io, `${sanitizeLine(out.id)}@${sanitizeLine(out.version)} files (variant ${sanitizeLine(out.variant)}):`);
      for (const f of out.files ?? []) line(io, `  ${String(f.role).padEnd(12)} ${sanitizeLine(f.path)} → ${sanitizeLine(f.target)}`);
      break;
    case "skill":
      line(io, untrusted([`SKILL.md of ${out.id}@${out.version}:`, String(out.untrusted_author_text?.skill_md ?? "")]));
      break;
    case "changelog":
      line(io, untrusted([`CHANGELOG.md of ${out.id}@${out.version}:`, String(out.untrusted_author_text?.changelog ?? "")]));
      break;
    case "manifest":
      line(io, untrusted([`block.json of ${out.id}@${out.version} (author-written fields inside):`, JSON.stringify(out.manifest, null, 2)]));
      break;
  }
  return 0;
}

// ---------- publish ----------

export const publishOptions = { visibility: { type: "string" }, license: { type: "string" }, tag: { type: "string" }, scope: { type: "string" } } as const;

export async function publish(io: Io, a: Parsed): Promise<number> {
  const dir = path.resolve(io.cwd, need(a, 0, "block directory"));
  const visibility = oneOf(str(a, "visibility") ?? "private", ["private", "public"] as const, "--visibility")!;
  const { api, settings } = await apiFor(io);
  const scope = (str(a, "scope") ?? settings.scope)?.replace(/^@/, "");
  if (!scope || !/^[a-z0-9][a-z0-9-]*$/.test(scope)) throw new KitError("invalid_params", "no scope: pass --scope <org> (or kit login to get your default)");
  const bundle = await readBlockDir(dir);
  const manifest = structuredClone(bundle.manifest) as Record<string, any>;
  if (!manifest || typeof manifest !== "object") throw new KitError("invalid_params", "block.json is not an object");
  const license = str(a, "license");
  if (license) manifest.license = license;
  const blockId = `@${scope}/${manifest.name}`;
  parseBlockRef(blockId);

  // client scan first: a block finding refuses any publish, a warning refuses a public one
  const pre = await validateBlock({ ...bundle, manifest });
  if (!publishAllowed(pre.findings, visibility)) {
    if (bool(a, "json")) json(io, { error: { code: "scan_refused", message: `the client scan refuses a ${visibility} publish`, findings: pre.findings.filter((f) => f.severity !== "info") } });
    else {
      line(io, `refused: the client scan does not allow a ${visibility} publish:`);
      printFindings(io, pre.findings);
    }
    return 1;
  }

  const key = await loadOrCreatePublisherKey(io);
  const prov = { ...(manifest.provenance ?? {}) };
  delete prov.signature;
  delete prov.registry_signature;
  delete prov.scan;
  delete prov.sandbox;
  manifest.provenance = { ...prov, publisher: { ...(prov.publisher ?? {}), org: `@${scope}`, key_id: key.keyId } };
  const filled = await fillFileHashes(manifest, bundle.files);
  const signature = await signBundle(filled, bundle.files, key.privateKeyJwk);
  (filled.provenance as Record<string, unknown>).signature = signature;
  const files = Object.keys(bundle.files)
    .sort()
    .map((p) => ({ path: p, content_b64: base64Encode(toBytes(bundle.files[p]!)) }));
  const res = await api.publish(blockId, {
    manifest: filled,
    files,
    publisher_signature: signature,
    publisher_key: key.publicKey,
    visibility,
    ...(license ? { license } : {}),
    ...(str(a, "tag") ? { tag: str(a, "tag")! } : {}),
  });
  if (bool(a, "json")) json(io, res);
  else {
    if (key.created) line(io, `generated a publisher key ${key.keyId} (stored in the ${key.store})`);
    line(io, `published ${sanitizeLine(res.id)}@${sanitizeLine(res.version)} (${visibility}) · scan ${sanitizeLine(res.scan?.tier)} · ${sanitizeLine(res.url)}`);
    for (const f of res.scan?.findings ?? []) line(io, `  ${sanitizeLine(f.severity)} ${sanitizeLine(f.rule)} ${sanitizeLine(f.path)}${f.detail ? `: ${sanitizeLine(f.detail)}` : ""}`);
  }
  return 0;
}

// ---------- heartbeat ----------

export const heartbeatOptions = { quiet: { type: "boolean" } } as const;

export async function heartbeat(io: Io, a: Parsed): Promise<number> {
  const quiet = bool(a, "quiet");
  try {
    const p = await openProject(io, str(a, "root"));
    const profile = await readProfile(p.fs);
    if (!profile?.telemetry) {
      if (!quiet) line(io, "telemetry is off for this project (kit init --telemetry to opt in); nothing sent");
      return 0;
    }
    const lock = await readLock(p.fs);
    const blocks = Object.entries(lock.blocks)
      .filter(([id]) => !id.startsWith("@local/"))
      .map(([id, e]) => ({ block: id, version: e.version, variant: e.variant, passed: e.verify?.passed === true, ...(e.verify?.last_run ? { verified_at: e.verify.last_run } : {}) }));
    const { api } = await apiFor(io);
    await api.heartbeat(profile.project_id, { stack: profile.stack, blocks });
    if (!quiet) line(io, `heartbeat sent for ${profile.project_id}: ${blocks.length} block(s), the lock's block list only`);
    return 0;
  } catch (e) {
    if (quiet) return 0;
    throw e;
  }
}

