// Small WebCrypto helpers for Workers: encodings, SHA-256, HMAC-SHA256 (with HKDF-derived per-purpose keys),
// constant-time comparison, and CSPRNG ids, tokens and digit codes. No dependencies; runs in workerd and Node 20+.
//
// Harvested from Ideator (packages/api/src/util.ts: ids, sha256Hex, base64url) and social-connector
// (telegram-connector/src/lib/crypto.ts: HKDF purpose keys, hashed constant-time compare, base64url decode;
// telegram-connector/src/auth/email-code.ts: rejection-sampled codes).

const encoder = new TextEncoder();

export function utf8(value: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(value) as Uint8Array<ArrayBuffer>;
}

export function toHex(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("invalid base64url");
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(input: string | Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", typeof input === "string" ? utf8(input) : input));
}

/** HMAC-SHA256 of `message` under a raw string key, as lowercase hex. */
export async function hmacSha256Hex(key: string | CryptoKey, message: string): Promise<string> {
  const k = typeof key === "string" ? await crypto.subtle.importKey("raw", utf8(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]) : key;
  return toHex(await crypto.subtle.sign("HMAC", k, utf8(message)));
}

/** HKDF-SHA256 (RFC 5869): `length` bytes of key material from `ikm`, `salt` and `info`. */
export async function hkdf(
  ikm: string | Uint8Array<ArrayBuffer>,
  salt: string | Uint8Array<ArrayBuffer>,
  info: string | Uint8Array<ArrayBuffer>,
  length = 32,
): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = (v: string | Uint8Array<ArrayBuffer>) => (typeof v === "string" ? utf8(v) : v);
  const base = await crypto.subtle.importKey("raw", bytes(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: bytes(salt), info: bytes(info) }, base, length * 8);
  return new Uint8Array(bits);
}

const purposeKeys = new Map<string, Promise<CryptoKey>>();

/**
 * An HMAC-SHA256 key for one purpose, derived from a secret (a pepper) with HKDF, so each use of the secret (login
 * codes, bearer tokens, cookies) gets an independent key. Cached per isolate.
 */
export function purposeKey(secret: string, purpose: string, salt = "kitbash/crypto-utils"): Promise<CryptoKey> {
  const id = `${salt}\u0000${purpose}\u0000${secret}`;
  let k = purposeKeys.get(id);
  if (!k) {
    k = (async () => {
      const ikm = await crypto.subtle.importKey("raw", utf8(secret), "HKDF", false, ["deriveKey"]);
      return crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: utf8(salt), info: utf8(purpose) },
        ikm,
        { name: "HMAC", hash: "SHA-256", length: 256 },
        false,
        ["sign", "verify"],
      );
    })();
    k.catch(() => purposeKeys.delete(id));
    purposeKeys.set(id, k);
  }
  return k;
}

/** HMAC-SHA256 hex of `message` under the `purpose` key derived from `secret`. */
export async function peppered(secret: string, purpose: string, message: string): Promise<string> {
  return hmacSha256Hex(await purposeKey(secret, purpose), message);
}

/**
 * Constant-time string comparison. Both sides are hashed first, so the time depends on neither the contents nor
 * the lengths.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([crypto.subtle.digest("SHA-256", utf8(a)), crypto.subtle.digest("SHA-256", utf8(b))]);
  return crypto.subtle.timingSafeEqual(da, db);
}

/** `n` uniform decimal digits from the CSPRNG (rejection sampling: bytes ≥ 250 are dropped, so no modulo bias). */
export function randomDigits(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 64) throw new Error("randomDigits: n must be 1..64");
  let out = "";
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) {
      if (b < 250 && out.length < n) out += String(b % 10);
    }
  }
  return out;
}

/** `bytes` random bytes as base64url (32 bytes → 43 characters). */
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** A prefixed random id, e.g. `mem_3f9c1a0b7d2e4c55` (64 bits: for row ids, not for secrets). */
export function newId(prefix: string): string {
  return `${prefix}_${toHex(crypto.getRandomValues(new Uint8Array(8)))}`;
}
