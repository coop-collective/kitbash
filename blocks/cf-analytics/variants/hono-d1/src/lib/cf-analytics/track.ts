// Server helpers: track (events), fact (exact business facts), log, identify. All return at once: the record is
// queued and sent by one signed POST per invocation from ctx.waitUntil. Nothing here throws into the request path;
// invalid input is dropped with one console warning. Props and bodies are scrubbed before they leave the app.
import { type AnalyticsEnv, type AnalyticsExecutionContext, type WireRecord, anonId as newAnonId, enqueue, factId, flush, ulid } from "./client";
import { scrub } from "./scrub";

export { flush, type AnalyticsEnv, type AnalyticsExecutionContext } from "./client";
export { scrub } from "./scrub";

const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const PROP_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
const USER_ID_RE = /^[\x21-\x3F\x41-\x7E]{1,128}$/;
const ANON_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const SESSION_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
export const LEVELS = ["debug", "info", "warn", "error"] as const;
export type Level = (typeof LEVELS)[number];
export type Props = Record<string, string | number | boolean | null | undefined>;

export interface Who {
  /** The app's own stable account id (never an email). */
  user_id?: string;
  /** The first-party anonymous id (c.var.analytics.anon_id). */
  anon_id?: string;
  session_id?: string;
  /** ms since epoch; defaults to now. */
  ts?: number;
}

function drop(why: string): void {
  console.warn(`[analytics] dropped: ${why}`);
}

/** Scrubs props (denylist, value scrubbers, caps) and removes keys the envelope grammar would reject. */
export function cleanProps(props: Props | undefined): Record<string, string | number | boolean | null> | undefined {
  if (!props) return undefined;
  const scrubbed = scrub({ props }).props as Record<string, string | number | boolean | null>;
  const out: Record<string, string | number | boolean | null> = {};
  for (const k of Object.keys(scrubbed)) if (PROP_KEY_RE.test(k)) out[k] = scrubbed[k] as string | number | boolean | null;
  return out;
}

function ids(who: Who | undefined): Pick<WireRecord, "user_id" | "anon_id" | "session_id"> | null {
  const out: Pick<WireRecord, "user_id" | "anon_id" | "session_id"> = {};
  if (who?.user_id !== undefined) {
    if (!USER_ID_RE.test(who.user_id)) return null;
    out.user_id = who.user_id;
  }
  if (who?.anon_id !== undefined) {
    if (!ANON_ID_RE.test(who.anon_id)) return null;
    out.anon_id = who.anon_id;
  }
  if (who?.session_id !== undefined) {
    if (!SESSION_ID_RE.test(who.session_id)) return null;
    out.session_id = who.session_id;
  }
  return out;
}

function base(kind: WireRecord["kind"], name: string, who: Who | undefined, id: string): WireRecord | null {
  if (typeof name !== "string" || !NAME_RE.test(name)) return (drop(`bad ${kind} name "${String(name).slice(0, 40)}" (a-z, 0-9, _; "$" names are client-only)`), null);
  const w = ids(who);
  if (!w) return (drop(`bad identity on ${kind} "${name}"`), null);
  return { id, kind, name, ts: who?.ts ?? Date.now(), ...w, v: 1 };
}

/** A behaviour or usage event (exact from the raw tier, not indexed as a fact). */
export function track(env: AnalyticsEnv, ctx: AnalyticsExecutionContext | null | undefined, name: string, props?: Props, who?: Who): void {
  try {
    const r = base("event", name, who, ulid());
    if (!r) return;
    const p = cleanProps(props);
    if (p) r.props = p;
    enqueue(env, ctx, "server", r);
  } catch {
    /* never throws */
  }
}

export interface FactInput extends Who {
  /** The app's account id; required (a fact without one is downgraded to an event by the ingest). */
  user_id: string;
  /** What the fact is about; the id is uuid5(project, "name:subject"), so a retry or a backfill never double counts.
   *  Defaults to user_id (right for signup, activation, first_call, conversion). */
  subject?: string;
  props?: Props;
}

/** An exactly-counted business fact. Resolves to the deterministic id (or null when dropped); safe to ignore. */
export function fact(env: AnalyticsEnv, ctx: AnalyticsExecutionContext | null | undefined, name: string, input: FactInput): Promise<string | null> {
  try {
    const project = env.CANVALYTICS_PROJECT;
    const subject = input?.subject ?? input?.user_id;
    if (!project) return (drop("fact needs CANVALYTICS_PROJECT"), Promise.resolve(null));
    if (typeof subject !== "string" || subject.length === 0) return (drop(`fact "${name}" needs a subject or user_id`), Promise.resolve(null));
    const r = base("fact", name, input, "");
    if (!r) return Promise.resolve(null);
    const p = cleanProps(input.props);
    if (p) r.props = p;
    const done = factId(project, name, subject).then((id) => {
      r.id = id;
      return r;
    });
    enqueue(env, ctx, "server", done.catch(() => null));
    return done.then((x) => x.id, () => null);
  } catch {
    return Promise.resolve(null);
  }
}

/** An application log line: searchable body (scrubbed, at most 4 KB), level, name, optional props. */
export function log(env: AnalyticsEnv, ctx: AnalyticsExecutionContext | null | undefined, level: Level, name: string, body: string, props?: Props, who?: Who): void {
  try {
    if (!LEVELS.includes(level)) return drop(`bad log level "${String(level).slice(0, 12)}"`);
    const r = base("log", name, who, ulid());
    if (!r) return;
    r.level = level;
    r.body = scrub({ body: String(body ?? "") }).body as string;
    const p = cleanProps(props);
    if (p) r.props = p;
    enqueue(env, ctx, "server", r);
  } catch {
    /* never throws */
  }
}

/**
 * Link an anonymous visitor to an account (`$identify`). The ingest accepts `$` names only from the client path, so
 * this record travels in its own batch marked `X-Canvalytics-Trust: client`, signed with the server key.
 */
export function identify(env: AnalyticsEnv, ctx: AnalyticsExecutionContext | null | undefined, input: { anon_id: string; user_id: string }): void {
  try {
    const w = ids({ anon_id: input?.anon_id, user_id: input?.user_id });
    if (!w || !w.anon_id || !w.user_id) return drop("identify needs a valid anon_id and user_id");
    enqueue(env, ctx, "client", { id: ulid(), kind: "event", name: "$identify", ts: Date.now(), ...w, v: 1 });
  } catch {
    /* never throws */
  }
}

/** A fresh anonymous id, for apps that mint the cookie themselves. */
export const anonId = newAnonId;
