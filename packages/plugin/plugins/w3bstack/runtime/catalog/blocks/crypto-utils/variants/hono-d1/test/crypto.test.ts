// crypto-utils: known-answer vectors (FIPS 180-2, RFC 4231, RFC 5869) and the properties the other blocks rely on.
import { describe, expect, it } from "vitest";
import {
  base64url,
  fromBase64url,
  fromHex,
  hkdf,
  hmacSha256Hex,
  newId,
  peppered,
  purposeKey,
  randomDigits,
  randomToken,
  sha256Hex,
  timingSafeEqual,
  toHex,
  utf8,
} from "{{paths.lib|rel}}/crypto-utils/crypto";

describe("encodings", () => {
  it("hex round-trips and rejects junk", () => {
    expect(toHex(new Uint8Array([0, 1, 254, 255]))).toBe("0001feff");
    expect([...fromHex("0001feff")]).toEqual([0, 1, 254, 255]);
    expect(() => fromHex("abc")).toThrow();
    expect(() => fromHex("zz")).toThrow();
  });

  it("base64url round-trips without padding", () => {
    for (const n of [0, 1, 2, 3, 31, 32, 33]) {
      const b = crypto.getRandomValues(new Uint8Array(n));
      const s = base64url(b);
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/);
      expect([...fromBase64url(s)]).toEqual([...b]);
    }
    expect(base64url(new Uint8Array([251, 255]))).toBe("-_8");
    expect(() => fromBase64url("a+b/")).toThrow();
  });
});

describe("hashes", () => {
  it("sha256Hex matches FIPS 180-2", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex(utf8("abc"))).toBe(await sha256Hex("abc"));
  });

  it("hmacSha256Hex matches RFC 4231 test case 2", async () => {
    expect(await hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });

  it("hkdf matches RFC 5869 test case 1", async () => {
    const okm = await hkdf(fromHex("0b".repeat(22)), fromHex("000102030405060708090a0b0c"), fromHex("f0f1f2f3f4f5f6f7f8f9"), 42);
    expect(toHex(okm)).toBe("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865");
  });

  it("peppered separates purposes and secrets, and is stable", async () => {
    const a = await peppered("secret-one", "codes", "m");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await peppered("secret-one", "codes", "m")).toBe(a);
    expect(await peppered("secret-one", "tokens", "m")).not.toBe(a);
    expect(await peppered("secret-two", "codes", "m")).not.toBe(a);
    expect(await hmacSha256Hex(await purposeKey("secret-one", "codes"), "m")).toBe(a);
  });
});

describe("comparison", () => {
  it("timingSafeEqual", async () => {
    expect(await timingSafeEqual("abc", "abc")).toBe(true);
    expect(await timingSafeEqual("abc", "abd")).toBe(false);
    expect(await timingSafeEqual("abc", "abcd")).toBe(false);
    expect(await timingSafeEqual("", "")).toBe(true);
  });
});

describe("randomness", () => {
  it("randomDigits gives n digits, roughly uniform", () => {
    expect(randomDigits(6)).toMatch(/^\d{6}$/);
    expect(() => randomDigits(0)).toThrow();
    const counts = new Array(10).fill(0);
    for (const d of Array.from({ length: 300 }, () => randomDigits(64)).join("")) counts[Number(d)]++;
    // 19,200 digits: each count is ~1,920 (sd ~42); a biased generator or a constant falls far outside this band
    for (const c of counts) {
      expect(c).toBeGreaterThan(1600);
      expect(c).toBeLessThan(2250);
    }
  });

  it("randomToken and newId", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(16)).toHaveLength(22);
    expect(randomToken()).not.toBe(randomToken());
    expect(newId("mem")).toMatch(/^mem_[0-9a-f]{16}$/);
  });
});
