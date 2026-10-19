// handleRelay: POST {{kit.relayPath}} from CLIENT_SNIPPET. Validates and allowlists the browser's events, strips query
// strings, reduces the referrer to a host, scrubs, and forwards them to Canvalytics as trust "client" with the server
// key (never the browser's). Always answers fast: 204 (also when DNT/GPC means nothing is sent), 400, 403, 413.
import type { Context } from "hono";
import { type AnalyticsEnv, enqueue } from "./client";
import { type AnalyticsVar, ctxOf, isDnt, resolveAnon } from "./middleware";
import { cleanProps } from "./track";
import { refDomain, stripQuery } from "./scrub";

/** Events the browser may send. Server facts (signup, conversion...) are deliberately absent. */
export const CLIENT_EVENTS: ReadonlySet<string> = new Set("{{kit.clientEvents}}".split(",").map((s) => s.trim()).filter(Boolean));
/** Props the browser may send on those events (path and ref are handled for $pageview). */
export const CLIENT_PROPS: ReadonlySet<string> = new Set("{{kit.clientProps}}".split(",").map((s) => s.trim()).filter(Boolean));
/** Browser-only reserved names the relay accepts. */
const RESERVED_OK: ReadonlySet<string> = new Set(["$pageview", "$pageleave"]);
export const RELAY_MAX_BYTES = 4096;
const MAX_EVENTS = 10;
const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const PROP_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;

/** Reads at most max bytes of the body; null when it is larger. */
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? "0") > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const buf = new Uint8Array(n);
  let o = 0;
  for (const p of parts) (buf.set(p, o), (o += p.byteLength));
  return new TextDecoder().decode(buf);
}

function cleanPath(p: unknown): string {
  return typeof p === "string" && p.startsWith("/") && !p.startsWith("//") ? stripQuery(p).slice(0, 200) : "/";
}

function browserProps(name: string, raw: unknown): Record<string, string | number | boolean | null> {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const kept: Record<string, string | number | boolean | null> = {};
  let n = 0;
  for (const k of Object.keys(src)) {
    if (n >= 12) break;
    const v = src[k];
    if (!PROP_KEY_RE.test(k) || !CLIENT_PROPS.has(k)) continue;
    if (v !== null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    if (k === "href") {
      const h = typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? stripQuery(v).slice(0, 200) : "";
      if (h) kept[k] = h;
    } else {
      kept[k] = typeof v === "string" ? v.slice(0, 120) : v;
    }
    n++;
  }
  const out = cleanProps(kept) ?? {};
  if (name === "$pageview" || name === "$pageleave") {
    out.path = cleanPath((src as { path?: unknown }).path);
    const ref = typeof src.ref === "string" && src.ref ? refDomain(src.ref) : null;
    if (ref) out.ref_domain = ref.slice(0, 100);
  }
  return out;
}

export async function handleRelay(c: Context<{ Bindings: AnalyticsEnv }>): Promise<Response> {
  const req = c.req.raw;
  c.header("Cache-Control", "no-store");
  if (isDnt(req)) return c.body(null, 204);
  const origin = req.headers.get("origin");
  if (origin) {
    let ok = false;
    try {
      ok = new URL(origin).host === new URL(req.url).host;
    } catch {
      /* malformed Origin */
    }
    if (!ok) return c.body(null, 403);
  }
  const raw = await readCapped(req, RELAY_MAX_BYTES);
  if (raw === null) return c.body(null, 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "null");
  } catch {
    return c.body(null, 400);
  }
  const list = (Array.isArray(parsed) ? parsed : [parsed]).filter((x): x is { name: unknown; props?: unknown } => !!x && typeof x === "object").slice(0, MAX_EVENTS);
  const valid = list.filter(
    (x) => typeof x.name === "string" && (NAME_RE.test(x.name) || RESERVED_OK.has(x.name)) && CLIENT_EVENTS.has(x.name),
  ) as { name: string; props?: unknown }[];
  if (valid.length === 0) return c.body(null, 400);

  // Who: the middleware's decision when it ran, else the same logic here (cookie set once, on this response).
  const v = c.get("analytics" as never) as AnalyticsVar | undefined;
  let anon: string | undefined;
  let userId: string | undefined;
  if (v) {
    if (v.dnt) return c.body(null, 204);
    anon = v.anon_id;
    userId = v.user_id;
  } else {
    const r = resolveAnon(req);
    anon = r.anon_id;
    if (r.setCookie) c.header("Set-Cookie", r.setCookie, { append: true });
  }

  const ctx = ctxOf(c);
  const now = Date.now();
  for (const e of valid) {
    enqueue(c.env, ctx, "client", {
      id: crypto.randomUUID(),
      kind: "event",
      name: e.name,
      ts: now,
      ...(anon ? { anon_id: anon } : {}),
      ...(userId ? { user_id: userId } : {}),
      props: browserProps(e.name, e.props),
      v: 1,
    });
  }
  return c.body(null, 204);
}
