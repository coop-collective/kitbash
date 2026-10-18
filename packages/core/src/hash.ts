/**
 * Hashing and canonical serialization (BLOCK-SPEC §8). WebCrypto only, so this runs in Node, workerd and browsers.
 */

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

export type Bytes = Uint8Array;
export type FileData = string | Uint8Array;

export function toBytes(data: FileData): Uint8Array {
  return typeof data === "string" ? enc.encode(data) : data;
}

/** Decodes UTF-8; returns null for bytes that are not valid UTF-8 (treated as binary). */
export function tryDecodeUtf8(data: FileData): string | null {
  if (typeof data === "string") return data;
  try {
    return dec.decode(data);
  } catch {
    return null;
  }
}

/** True when the data is text: valid UTF-8 without NUL bytes. */
export function isText(data: FileData): boolean {
  const s = tryDecodeUtf8(data);
  return s !== null && !s.includes("\u0000");
}

export function hex(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export async function sha256Hex(data: FileData): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", toBytes(data) as Uint8Array<ArrayBuffer>);
  return hex(d);
}

export function byteLength(data: FileData): number {
  return toBytes(data).byteLength;
}

export function countLines(data: FileData): number {
  const s = tryDecodeUtf8(data);
  if (s === null || s.length === 0) return 0;
  const n = s.split("\n").length;
  return s.endsWith("\n") ? n - 1 : n;
}

/**
 * Deterministic JSON: object keys sorted by UTF-16 code unit order, no whitespace, `undefined` members dropped.
 * Arrays keep their order. Non-finite numbers are rejected.
 */
export function canonicalJson(value: unknown): string {
  return ser(value);
}

function ser(v: unknown): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "string":
      return JSON.stringify(v);
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new TypeError("canonicalJson: non-finite number");
      return JSON.stringify(v);
    case "object": {
      if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : ser(x))).join(",")}]`;
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${ser(o[k])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof v}`);
  }
}

/** Pretty, key-sorted JSON with a trailing newline: the on-disk form for lock and profile files. */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

export function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sortKeys) as T;
  if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) if (o[k] !== undefined) out[k] = sortKeys(o[k]);
    return out as T;
  }
  return value;
}

/**
 * The canonical manifest (BLOCK-SPEC §8): the manifest with `files[].sha256` and `size` filled, minus
 * `provenance.signature`, `provenance.registry_signature`, `provenance.scan`, `provenance.sandbox`,
 * `lineage.similarity` and `lineage.relation`, serialized with `canonicalJson`.
 */
export function canonicalManifest(manifest: unknown): string {
  return canonicalJson(stripForSigning(manifest));
}

export function stripForSigning(manifest: unknown): unknown {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("manifest must be an object");
  }
  const m = structuredClone(manifest) as Record<string, unknown>;
  const prov = m.provenance as Record<string, unknown> | undefined;
  if (prov && typeof prov === "object") {
    delete prov.signature;
    delete prov.registry_signature;
    delete prov.scan;
    delete prov.sandbox;
  }
  const lin = m.lineage as Record<string, unknown> | undefined;
  if (lin && typeof lin === "object") {
    delete lin.similarity;
    delete lin.relation;
  }
  return m;
}

export async function manifestSha256(manifest: unknown): Promise<string> {
  return sha256Hex(canonicalManifest(manifest));
}

// base64 / base64url helpers that work without Buffer.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64Encode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i]! << 16;
    out += `${B64[(n >> 18) & 63]!}${B64[(n >> 12) & 63]!}==`;
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += `${B64[(n >> 18) & 63]!}${B64[(n >> 12) & 63]!}${B64[(n >> 6) & 63]!}=`;
  }
  return out;
}

export function base64Decode(s: string): Uint8Array {
  const clean = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1) throw new TypeError("invalid base64");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]!) : 0));
    const n = (c[0]! << 18) | (c[1]! << 12) | (c[2]! << 6) | c[3]!;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const base64UrlDecode = base64Decode;
