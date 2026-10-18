/**
 * Where a block comes from. A spec starting with `@` is a registry reference; anything else is a local block
 * directory (works fully offline). Registry bundles are verified before anything is planned: every path safe, every
 * file hashed to the signed manifest, nothing undeclared, the publisher key bound to `provenance.publisher.key_id`,
 * the publisher signature and the registry co-signature (against the key pinned at `kit login`).
 * Local blocks run through core's client scanner; a `block` finding refuses the install.
 */
import path from "node:path";
import {
  KitError,
  base64Decode,
  keyIdOf,
  manifestSha256,
  normalizeRelative,
  parseBlockRef,
  scanBlock,
  verifyBundle,
  BLOCK_ID_RE,
  type BlockBundle,
  type FileTree,
  type Finding,
} from "@kitbash/core";
import { readBlockDir } from "@kitbash/core/node";
import type { ApiClient, BundleResponse } from "./api.ts";
import type { Io } from "./io.ts";

export interface ResolvedBlock {
  bundle: BlockBundle;
  blockId: string;
  version: string;
  origin: { kind: "local"; dir: string } | { kind: "registry" };
  registrySignature: string;
  /** Non-blocking scanner findings (local blocks). */
  findings: Finding[];
}

export function isLocalSpec(spec: string): boolean {
  return !spec.startsWith("@");
}

function manifestField(m: unknown, k: string): unknown {
  return m && typeof m === "object" ? (m as Record<string, unknown>)[k] : undefined;
}

export async function loadLocalBlock(io: Io, dirSpec: string, opts: { id?: string } = {}): Promise<ResolvedBlock> {
  const dir = path.resolve(io.cwd, dirSpec.startsWith("~/") ? path.join(io.home, dirSpec.slice(2)) : dirSpec);
  let bundle: BlockBundle;
  try {
    bundle = await readBlockDir(dir);
  } catch (e) {
    if (e instanceof KitError) throw e;
    throw new KitError("not_found", `${dirSpec} is not a readable block directory (${(e as Error).message})`);
  }
  const report = await scanBlock(bundle);
  if (!report.ok) {
    throw new KitError("scan_refused", `${dirSpec} fails the client scan (${report.findings.filter((f) => f.severity === "block").length} blocking findings); run \`kit validate ${dirSpec}\``, {
      details: report.findings.filter((f) => f.severity === "block"),
    });
  }
  const name = String(manifestField(bundle.manifest, "name") ?? "");
  const blockId = opts.id ?? `@local/${name}`;
  if (!BLOCK_ID_RE.test(blockId)) throw new KitError("invalid_params", `bad block id ${JSON.stringify(blockId)}`);
  if (blockId.split("/")[1] !== name) throw new KitError("invalid_params", `--id ${blockId} does not match the block name ${name}`);
  return {
    bundle,
    blockId,
    version: String(manifestField(bundle.manifest, "version") ?? ""),
    origin: { kind: "local", dir },
    registrySignature: "",
    findings: report.findings.filter((f) => f.severity !== "info"),
  };
}

function bundleFiles(r: BundleResponse): FileTree {
  const out: FileTree = {};
  const entries: [string, string][] = Array.isArray(r.files) ? r.files.map((f) => [f.path, f.content_b64]) : Object.entries(r.files ?? {});
  for (const [p, b64] of entries) {
    const n = normalizeRelative(p);
    if (n === null || n !== p || p === "block.json") throw new KitError("signature_invalid", `bundle contains an unsafe path ${JSON.stringify(p)}`);
    if (Object.hasOwn(out, n)) throw new KitError("signature_invalid", `bundle lists ${n} twice`);
    if (typeof b64 !== "string") throw new KitError("signature_invalid", `bundle file ${n} has no content`);
    out[n] = base64Decode(b64);
  }
  return out;
}

/** Fetches a registry bundle and verifies it. Throws `signature_invalid` on any mismatch; nothing is planned. */
export async function fetchRegistryBlock(
  api: ApiClient,
  registryPublicKey: string | undefined,
  ref: string,
  opts: { version?: string; variant?: string; allowYanked?: boolean } = {},
): Promise<ResolvedBlock> {
  if (!registryPublicKey) throw new KitError("signature_invalid", "no registry key is pinned: run `kit login` (or set KIT_REGISTRY_PUBLIC_KEY) before installing from the registry");
  const { id, version } = await api.resolveVersion(ref, opts.version);
  const r = await api.bundle(id, version, { ...(opts.variant ? { variant: opts.variant } : {}), ...(opts.allowYanked ? { allowYanked: true } : {}) });
  const files = bundleFiles(r);
  const m = r.manifest as Record<string, unknown> | undefined;
  if (!m || typeof m !== "object") throw new KitError("signature_invalid", "bundle has no manifest");
  const { name } = parseBlockRef(id);
  if (m.name !== name) throw new KitError("signature_invalid", `bundle for ${id} carries block ${JSON.stringify(m.name)}`);
  if (m.version !== version) throw new KitError("signature_invalid", `asked for ${id}@${version}, the bundle is ${JSON.stringify(m.version)}`);
  const pubKey = r.publisher_key ?? r.publisher_public_key;
  const keyId = (m.provenance as { publisher?: { key_id?: string } } | undefined)?.publisher?.key_id;
  if (!pubKey) throw new KitError("signature_invalid", "bundle has no publisher key");
  if (!keyId || keyId !== (await keyIdOf(pubKey))) throw new KitError("signature_invalid", "the publisher key does not match provenance.publisher.key_id in the signed manifest");
  const v = await verifyBundle(r.manifest, files, registryPublicKey, {
    publisherPublicKey: pubKey,
    ...(r.publisher_signature ? { publisherSignature: r.publisher_signature } : {}),
    ...(r.registry_signature ? { registrySignature: r.registry_signature } : {}),
  });
  if (!v.ok) {
    throw new KitError("signature_invalid", `refusing ${id}@${version}: ${v.errors.map((e) => `${e.rule}${e.path ? ` ${e.path}` : ""}`).join(", ")}`, { details: v.errors });
  }
  const regSig = r.registry_signature ?? (m.provenance as { registry_signature?: string } | undefined)?.registry_signature ?? "";
  return { bundle: { manifest: r.manifest, files, registry_signature: regSig }, blockId: id, version, origin: { kind: "registry" }, registrySignature: regSig, findings: [] };
}

/** Loads the installed version of a block again (for verify/diff/upgrade/propose) and checks it against the lock. */
export async function checkAgainstLock(b: ResolvedBlock, manifestShaInLock: string): Promise<void> {
  const sha = await manifestSha256(b.bundle.manifest);
  if (sha !== manifestShaInLock) {
    throw new KitError("plan_stale", `${b.blockId}: the block source no longer matches what was installed (manifest hash differs); point --from at the installed version`);
  }
}
