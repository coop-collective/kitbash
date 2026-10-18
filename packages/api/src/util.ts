// Small helpers shared by the routes.
import { base64UrlEncode } from "@kitbash/core";

export function newId(prefix: string): string {
  return `${prefix}_${base64UrlEncode(crypto.getRandomValues(new Uint8Array(12))).replace(/[-_]/g, "x").slice(0, 16)}`;
}

/** ISO-8601 UTC, second precision (the contract's Timestamp form). */
export function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** `coop` or `@coop` -> `coop`. */
export function scopeSlug(scope: string): string {
  return decodeURIComponent(scope).replace(/^@/, "");
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
