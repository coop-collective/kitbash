// analytics(): Hono middleware. Sets the first-party anonymous-id cookie once, honours Do Not Track and Global Privacy
// Control (no cookie, no id), exposes c.var.analytics, and flushes queued records when the handler finishes.
import type { Context, MiddlewareHandler } from "hono";
import { type AnalyticsEnv, type AnalyticsExecutionContext, anonId, flushSoon } from "./client";

export const COOKIE_NAME = "{{kit.cookieName}}";
const ANON_RE = /^[A-Za-z0-9_-]{8,128}$/;
const ONE_YEAR = 365 * 86400;

export interface AnalyticsVar {
  /** The visitor's anonymous id; undefined under DNT/GPC. */
  anon_id?: string;
  /** Set it after your own sign-in check so relayed browser events carry the account id: c.get("analytics").user_id = id. */
  user_id?: string;
  /** True when the request carries DNT: 1 or Sec-GPC: 1. */
  dnt: boolean;
}
export type AnalyticsVariables = { analytics: AnalyticsVar };

export function readCookie(header: string | null | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

export function isDnt(req: Request): boolean {
  return req.headers.get("dnt") === "1" || req.headers.get("sec-gpc") === "1";
}

export function anonCookie(value: string, secure: boolean): string {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** The request's anon id, minting one (and the Set-Cookie header value) when the cookie is absent or malformed. */
export function resolveAnon(req: Request): { anon_id?: string; setCookie?: string; dnt: boolean } {
  if (isDnt(req)) return { dnt: true };
  const existing = readCookie(req.headers.get("cookie"), COOKIE_NAME);
  if (existing && ANON_RE.test(existing)) return { anon_id: existing, dnt: false };
  const anon_id = anonId();
  return { anon_id, setCookie: anonCookie(anon_id, new URL(req.url).protocol === "https:"), dnt: false };
}

/** c.executionCtx throws outside a Worker request (tests); this returns undefined instead. */
export function ctxOf(c: Context): AnalyticsExecutionContext | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

export function analytics(): MiddlewareHandler<{ Bindings: AnalyticsEnv; Variables: AnalyticsVariables }> {
  return async (c, next) => {
    const r = resolveAnon(c.req.raw);
    const v: AnalyticsVar = { dnt: r.dnt };
    if (r.anon_id) v.anon_id = r.anon_id;
    c.set("analytics", v);
    if (r.setCookie) c.header("Set-Cookie", r.setCookie, { append: true });
    try {
      await next();
    } finally {
      flushSoon(c.env, ctxOf(c));
    }
  };
}
