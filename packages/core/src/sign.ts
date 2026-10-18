/**
 * Ed25519 signing over the canonical manifest (BLOCK-SPEC §8), WebCrypto only.
 *
 * Messages are domain-separated so a signature for one purpose can never be replayed as another:
 *   publisher: "kitbash/block-v1/publisher\n" + canonicalManifest(m) + "\n" + canonicalJson(metaFileHashes)
 *   registry:  "kitbash/block-v1/registry\n"  + <same body> + "\n" + publisherSignature
 * `metaFileHashes` covers shipped files outside `files[]` (CHANGELOG.md, LICENSE, an unlisted SKILL.md/docs).
 * The registry's co-signature therefore also binds the publisher's signature.
 *
 * Formats: public keys `ed25519:<base64url of the 32 raw bytes>`; signatures `ed25519:<base64url of 64 bytes>`;
 * private keys as a JWK (`{kty:"OKP", crv:"Ed25519", x, d}`), which the CLI keeps in the keychain (or a 0600 file).
 */
import { KitError } from "./errors.ts";
import type { BlockBundle } from "./fs.ts";
import { base64UrlDecode, base64UrlEncode, canonicalJson, canonicalManifest, sha256Hex, toBytes } from "./hash.ts";
import { bundlePath, ManifestSchema } from "./schema.ts";
import { metaFiles } from "./scan.ts";

const PREFIX = "ed25519:";
const PUBLISHER_DOMAIN = "kitbash/block-v1/publisher\n";
const REGISTRY_DOMAIN = "kitbash/block-v1/registry\n";

export interface SigningKeyPair {
  publicKey: string;
  privateKeyJwk: JsonWebKey;
  keyId: string;
}

export type SignerRole = "publisher" | "registry";

function bytes(s: string): Uint8Array<ArrayBuffer> {
  return toBytes(s) as Uint8Array<ArrayBuffer>;
}

export async function keyIdOf(publicKey: string): Promise<string> {
  return `k_${(await sha256Hex(decodeKey(publicKey))).slice(0, 16)}`;
}

function decodeKey(publicKey: string): Uint8Array<ArrayBuffer> {
  if (typeof publicKey !== "string" || !publicKey.startsWith(PREFIX)) throw new KitError("signature_invalid", "public key must be ed25519:<base64url>");
  const raw = base64UrlDecode(publicKey.slice(PREFIX.length));
  if (raw.length !== 32) throw new KitError("signature_invalid", "an Ed25519 public key is 32 bytes");
  return raw as Uint8Array<ArrayBuffer>;
}

export async function generateSigningKeyPair(): Promise<SigningKeyPair> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const privateKeyJwk = (await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey;
  const publicKey = PREFIX + base64UrlEncode(raw);
  return { publicKey, privateKeyJwk, keyId: await keyIdOf(publicKey) };
}

/** Derives the public key string from a private JWK (its `x`). */
export function publicKeyFromJwk(jwk: JsonWebKey): string {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) throw new KitError("signature_invalid", "not an Ed25519 JWK");
  return PREFIX + jwk.x;
}

async function importPrivate(jwk: JsonWebKey): Promise<CryptoKey> {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.d) throw new KitError("signature_invalid", "not an Ed25519 private JWK");
  return crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
}

async function importPublic(publicKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", decodeKey(publicKey), { name: "Ed25519" }, false, ["verify"]);
}

/**
 * Hashes of the shipped files that are not in `files[]` (CHANGELOG.md, an undeclared SKILL.md or docs, LICENSE):
 * signed alongside the manifest so that no author text reaches an agent unsigned.
 */
export async function metaFileHashes(manifest: unknown, files: BlockBundle["files"]): Promise<Record<string, string>> {
  const parsed = ManifestSchema.safeParse(manifest);
  if (!parsed.success) throw new KitError("invalid_params", "manifest does not validate");
  const declared = new Set(parsed.data.files.map((f) => bundlePath(parsed.data, f)));
  const meta = metaFiles(parsed.data);
  const out: Record<string, string> = {};
  for (const p of Object.keys(files).sort()) {
    if (p === "block.json" || declared.has(p) || !meta.has(p)) continue;
    out[p] = await sha256Hex(files[p]!);
  }
  return out;
}

export function signingMessage(manifest: unknown, metaHashes: Record<string, string>, role: SignerRole, publisherSignature?: string): string {
  const body = `${canonicalManifest(manifest)}\n${canonicalJson(metaHashes)}`;
  if (role === "publisher") return PUBLISHER_DOMAIN + body;
  if (!publisherSignature) throw new KitError("signature_invalid", "the registry co-signs over the publisher's signature");
  return `${REGISTRY_DOMAIN}${body}\n${publisherSignature}`;
}

export async function signMessage(message: string, privateKeyJwk: JsonWebKey): Promise<string> {
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, await importPrivate(privateKeyJwk), bytes(message));
  return PREFIX + base64UrlEncode(new Uint8Array(sig));
}

export async function verifyMessage(message: string, signature: string, publicKey: string): Promise<boolean> {
  if (typeof signature !== "string" || !signature.startsWith(PREFIX)) return false;
  let sig: Uint8Array;
  try {
    sig = base64UrlDecode(signature.slice(PREFIX.length));
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  try {
    return await crypto.subtle.verify({ name: "Ed25519" }, await importPublic(publicKey), sig as Uint8Array<ArrayBuffer>, bytes(message));
  } catch {
    return false;
  }
}

/**
 * Publisher signature over the canonical manifest plus the hashes of the unlisted meta files. Every `files[]` entry
 * must carry its `sha256` (see `fillFileHashes`).
 */
export async function signBundle(manifest: unknown, files: BlockBundle["files"], privateKeyJwk: JsonWebKey): Promise<string> {
  assertHashesFilled(manifest);
  return signMessage(signingMessage(manifest, await metaFileHashes(manifest, files), "publisher"), privateKeyJwk);
}

/** Registry co-signature: same body plus the publisher's signature. */
export async function coSignBundle(manifest: unknown, files: BlockBundle["files"], publisherSignature: string, registryPrivateKeyJwk: JsonWebKey): Promise<string> {
  assertHashesFilled(manifest);
  return signMessage(signingMessage(manifest, await metaFileHashes(manifest, files), "registry", publisherSignature), registryPrivateKeyJwk);
}

export async function verifyBundleSignature(
  manifest: unknown,
  files: BlockBundle["files"],
  signature: string,
  publicKey: string,
  role: SignerRole,
  publisherSignature?: string,
): Promise<boolean> {
  let msg: string;
  try {
    msg = signingMessage(manifest, await metaFileHashes(manifest, files), role, publisherSignature);
  } catch {
    return false;
  }
  return verifyMessage(msg, signature, publicKey);
}

function assertHashesFilled(manifest: unknown): void {
  const files = (manifest as { files?: { sha256?: string; path?: string }[] })?.files;
  if (!Array.isArray(files)) throw new KitError("invalid_params", "manifest has no files[]");
  for (const f of files) if (!f.sha256) throw new KitError("invalid_params", `files[] entry ${f.path} has no sha256; call fillFileHashes first`);
}

/**
 * Returns a copy of the manifest with `files[].sha256`, `files[].bytes` and `size.files|lines` filled from the
 * bundle (what the publisher signs). Files with inline `content` are hashed from it.
 */
export async function fillFileHashes(manifest: unknown, files: Record<string, string | Uint8Array>): Promise<Record<string, unknown>> {
  const parsed = ManifestSchema.safeParse(manifest);
  if (!parsed.success) throw new KitError("invalid_params", "manifest does not validate", { details: parsed.error.issues });
  const m = structuredClone(manifest) as Record<string, unknown> & { files: Record<string, unknown>[]; size?: Record<string, unknown> };
  let lines = 0;
  for (let i = 0; i < parsed.data.files.length; i++) {
    const f = parsed.data.files[i]!;
    const bp = bundlePath(parsed.data, f);
    const data = Object.hasOwn(files, bp) ? files[bp]! : f.content;
    if (data === undefined) throw new KitError("invalid_params", `missing file ${bp}`);
    m.files[i]!.sha256 = await sha256Hex(data);
    m.files[i]!.bytes = toBytes(data).byteLength;
    const s = typeof data === "string" ? data : new TextDecoder().decode(data);
    lines += s.length ? s.split("\n").length - (s.endsWith("\n") ? 1 : 0) : 0;
  }
  m.size = { ...(m.size ?? {}), files: parsed.data.files.length, lines };
  return m;
}

export interface BundleVerification {
  ok: boolean;
  errors: { rule: string; path?: string; detail: string }[];
}

export interface VerifyBundleOptions {
  /** The publisher's registered key. Required unless `requirePublisher` is false. */
  publisherPublicKey?: string;
  requirePublisher?: boolean;
  /** Signatures, when not inside `manifest.provenance`. */
  publisherSignature?: string;
  registrySignature?: string;
}

/**
 * What `kit install` checks before writing anything: every declared file hashes to `files[].sha256`, nothing
 * undeclared is in the bundle, the publisher signature verifies (with the member's registered key), and the
 * registry's co-signature verifies. Any failure → `ok: false`.
 */
export async function verifyBundle(
  manifest: unknown,
  files: BlockBundle["files"],
  registryPublicKey: string,
  opts: VerifyBundleOptions = {},
): Promise<BundleVerification> {
  const errors: BundleVerification["errors"] = [];
  const parsed = ManifestSchema.safeParse(manifest);
  if (!parsed.success) return { ok: false, errors: [{ rule: "schema", detail: "manifest does not validate" }] };
  const m = parsed.data;
  const declared = new Set<string>();
  for (const f of m.files) {
    const bp = bundlePath(m, f);
    declared.add(bp);
    if (!f.sha256) {
      errors.push({ rule: "hash_missing", path: bp, detail: "files[].sha256 missing" });
      continue;
    }
    const data = Object.hasOwn(files, bp) ? files[bp]! : f.content;
    if (data === undefined) {
      errors.push({ rule: "missing_file", path: bp, detail: "declared file not in the bundle" });
      continue;
    }
    if ((await sha256Hex(data)) !== f.sha256) errors.push({ rule: "hash_mismatch", path: bp, detail: "content does not match the signed hash" });
  }
  const meta = metaFiles(m);
  for (const p of Object.keys(files)) {
    if (!declared.has(p) && !meta.has(p)) errors.push({ rule: "undeclared_file", path: p, detail: "file in the bundle is not in the signed manifest" });
  }
  const pubSig = opts.publisherSignature ?? m.provenance?.signature;
  const regSig = opts.registrySignature ?? m.provenance?.registry_signature;
  if (!pubSig) errors.push({ rule: "signature_missing", detail: "no publisher signature" });
  if (!regSig) errors.push({ rule: "signature_missing", detail: "no registry signature" });
  if (pubSig) {
    if (opts.publisherPublicKey) {
      if (!(await verifyBundleSignature(manifest, files, pubSig, opts.publisherPublicKey, "publisher"))) {
        errors.push({ rule: "signature_invalid", detail: "publisher signature does not verify" });
      }
    } else if (opts.requirePublisher !== false) {
      errors.push({ rule: "publisher_key_missing", detail: "no publisher key to verify against" });
    }
  }
  if (regSig && pubSig) {
    if (!(await verifyBundleSignature(manifest, files, regSig, registryPublicKey, "registry", pubSig))) {
      errors.push({ rule: "signature_invalid", detail: "registry signature does not verify" });
    }
  }
  return { ok: errors.length === 0, errors };
}

