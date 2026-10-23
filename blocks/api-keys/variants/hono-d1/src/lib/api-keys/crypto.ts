// Small WebCrypto helpers for API keys. Nothing here logs or returns a secret.
const enc = new TextEncoder();

/** Lowercase RFC 4648 base32 alphabet without padding: unambiguous in urls and key strings. */
const B32 = "abcdefghijklmnopqrstuvwxyz234567";

/** `n` random base32 chars (5 bits each, from crypto.getRandomValues). */
export function randomB32(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = "";
  for (let i = 0; i < n; i++) s += B32[bytes[i]! & 31];
  return s;
}

/** base62 secret, rejection-sampled so every char is uniform. */
export function randomB62(n: number): string {
  const A = "0123456789" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ" + "abcdefghijklmnopqrstuvwxyz";
  let s = "";
  while (s.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) {
      if (b < 248 && s.length < n) s += A[b % 62];
    }
  }
  return s;
}

/** hex HMAC-SHA256(secret, msg). */
export async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time compare. Lengths are compared first, which leaks only the length (callers compare fixed-length hashes). */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}
