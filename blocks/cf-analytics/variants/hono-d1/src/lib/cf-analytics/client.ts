// Canvalytics transport: per-invocation queue, signing, chunking, retries. It never throws into the request path.
//
// Wire format (Canvalytics DESIGN 4.2): POST {CANVALYTICS_URL} with headers X-Canvalytics-{Key,Timestamp,Signature,
// Batch,Lib}; the signature is v1=hex HMAC-SHA256(secret, `${ts}.${batch_id}.${hex sha256(body)}`) over the exact
// body bytes. The key secret (env[KEY_SECRET], `ck_<id>.<secret>`) is read by NAME and never logged or sent.
//
// Sections marked "vendored" copy the algorithms of @canvalytics/core (sign.ts, ids.ts) because a block cannot import
// across repositories; test/analytics.test.ts pins them with the same reference vectors as core.

export interface AnalyticsExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}
/** A service binding (or anything with fetch). */
export interface FetcherLike {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}
export interface AnalyticsEnv {
  /** Ingest endpoint, e.g. https://ingest.<host>/v1/ingest. With a service binding only its path matters. */
  CANVALYTICS_URL?: string;
  /** Canvalytics project id (namespaces deterministic fact ids). */
  CANVALYTICS_PROJECT?: string;
  /** Service binding to the ingest Worker (same account); used only when TRANSPORT is "service-binding". */
  CANVALYTICS?: FetcherLike;
}

/** Name of the secret holding the server key. Values are read from env by this name only. */
export const KEY_SECRET = "{{kit.keySecretName}}";
/** "https" posts to CANVALYTICS_URL; "service-binding" posts through env.CANVALYTICS (same account) and never over the public hop. */
export const TRANSPORT: "https" | "service-binding" = "{{kit.transport}}";
/** Worker to bind as CANVALYTICS when TRANSPORT is "service-binding". */
export const INGEST_SERVICE = "{{kit.ingestService}}";
export const LIB = "cf-analytics/1.0 ({{kit.libName}})";
export const CHUNK_RECORDS = 200;
/** Stay under the ingest's 1 MB request cap even when records carry large props. */
export const CHUNK_BYTES = 900_000;

/** Test and tuning knobs. */
export const tuning = { retries: 2, retryBaseMs: 150, tickMs: 0 };

export type Lane = "server" | "client";
/** One envelope as sent (the server adds trust, uid, project_id...). */
export interface WireRecord {
  id: string;
  kind: "event" | "fact" | "log";
  name: string;
  ts: number;
  user_id?: string;
  anon_id?: string;
  session_id?: string;
  props?: Record<string, unknown>;
  body?: string;
  level?: string;
  v: 1;
}

// ---- vendored from @canvalytics/core: key, ids, signing ------------------------------------------------------------

const FULL_KEY_RE = /^(ck_[A-Za-z0-9]{8,64})\.([A-Za-z0-9_-]{16,128})$/;
export function parseServerKey(full: unknown): { id: string; secret: string } | null {
  const m = typeof full === "string" ? FULL_KEY_RE.exec(full) : null;
  return m ? { id: m[1] as string, secret: m[2] as string } : null;
}

const enc = new TextEncoder();
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CANVALYTICS_NAMESPACE = "6f1d3c8e-2b7a-4c59-9e41-0a8d5b3f7c21";

export function ulid(now: number = Date.now(), random?: Uint8Array): string {
  const rnd = random ?? crypto.getRandomValues(new Uint8Array(10));
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = "";
  let acc = 0;
  let bits = 0;
  for (const byte of rnd) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      rand += CROCKFORD[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  return time + rand;
}

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += (b[i] as number).toString(16).padStart(2, "0");
  return s;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
}

/** Returns the X-Canvalytics-Signature value `v1=<hex>`. `ts` is unix seconds. */
export async function signBatch(input: { secret: string; ts: number; batchId: string; body: string }): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(input.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const canonical = `${input.ts}.${input.batchId}.${await sha256Hex(input.body)}`;
  return `v1=${toHex(await crypto.subtle.sign("HMAC", key, enc.encode(canonical)))}`;
}

/** RFC 9562 UUIDv5 (SHA-1 over namespace bytes + UTF-8 name). */
export async function uuid5(namespace: string, name: string): Promise<string> {
  const h = namespace.toLowerCase().replace(/-/g, "");
  const nb = enc.encode(name);
  const data = new Uint8Array(16 + nb.length);
  for (let i = 0; i < 16; i++) data[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  data.set(nb, 16);
  const b = new Uint8Array(await crypto.subtle.digest("SHA-1", data)).slice(0, 16);
  b[6] = ((b[6] as number) & 0x0f) | 0x50;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const x = toHex(b);
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Deterministic fact id: uuid5(uuid5(CANVALYTICS_NAMESPACE, projectId), `${name}:${subject}`). */
export async function factId(projectId: string, name: string, subject: string): Promise<string> {
  return uuid5(await uuid5(CANVALYTICS_NAMESPACE, projectId), `${name}:${subject}`);
}

/** A random anonymous id (22 chars base64url, 128 bits). */
export function anonId(): string {
  let bin = "";
  for (const b of crypto.getRandomValues(new Uint8Array(16))) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---- queue and transport -------------------------------------------------------------------------------------------

interface Queue {
  pending: Promise<WireRecord | null>[];
  scheduled: boolean;
}
type QueueKey = object;
const queues = new WeakMap<QueueKey, { server: Queue; client: Queue }>();

function queueFor(owner: QueueKey, lane: Lane): Queue {
  let q = queues.get(owner);
  if (!q) {
    q = { server: { pending: [], scheduled: false }, client: { pending: [], scheduled: false } };
    queues.set(owner, q);
  }
  return q[lane];
}

let warned = false;
function warnOnce(msg: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[analytics] ${msg}`);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const tick = () => sleep(tuning.tickMs);

/**
 * Queue one record (or a promise of one, for ids that need hashing) for this invocation. The first record schedules a
 * single flush through ctx.waitUntil after a tick, so a burst in one handler becomes one POST.
 * `owner` is the execution context (or the env when there is none, e.g. a plain function).
 */
export function enqueue(env: AnalyticsEnv, ctx: AnalyticsExecutionContext | null | undefined, lane: Lane, record: WireRecord | Promise<WireRecord | null>): void {
  try {
    const owner = (ctx ?? env) as QueueKey;
    const q = queueFor(owner, lane);
    q.pending.push(Promise.resolve(record).catch(() => null));
    if (!q.scheduled) {
      q.scheduled = true;
      const run = tick().then(() => drain(env, owner, lane));
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(run);
      else void run;
    }
  } catch (e) {
    warnOnce(`enqueue failed: ${(e as Error)?.message ?? "error"}`);
  }
}

/** Flush now (crons, queue consumers, the end of a request). Resolves when the POSTs are done; never rejects. */
export async function flush(env: AnalyticsEnv, ctx?: AnalyticsExecutionContext | null): Promise<void> {
  const owner = (ctx ?? env) as QueueKey;
  await drain(env, owner, "server");
  await drain(env, owner, "client");
}

/** Called when the handler finishes: do not wait for the tick, flush inside waitUntil. */
export function flushSoon(env: AnalyticsEnv, ctx: AnalyticsExecutionContext | null | undefined): void {
  if (!ctx || typeof ctx.waitUntil !== "function") return;
  const owner = ctx as QueueKey;
  const q = queues.get(owner);
  if (!q || (q.server.pending.length === 0 && q.client.pending.length === 0)) return;
  ctx.waitUntil(flush(env, ctx));
}

async function drain(env: AnalyticsEnv, owner: QueueKey, lane: Lane): Promise<void> {
  const q = queueFor(owner, lane);
  const taken = q.pending.splice(0);
  q.scheduled = false;
  if (taken.length === 0) return;
  try {
    const records = (await Promise.all(taken)).filter((r): r is WireRecord => r !== null);
    for (const chunk of chunks(records)) await send(env, chunk, lane);
  } catch (e) {
    warnOnce(`flush failed: ${(e as Error)?.message ?? "error"}`);
  }
}

/** Split into batches of at most 200 records and about 900 KB. */
export function chunks(records: WireRecord[]): { records: WireRecord[]; body: string }[] {
  const out: { records: WireRecord[]; body: string }[] = [];
  let cur: WireRecord[] = [];
  let bytes = 0;
  const close = () => {
    if (cur.length) out.push({ records: cur, body: JSON.stringify({ records: cur }) });
    cur = [];
    bytes = 0;
  };
  for (const r of records) {
    const n = JSON.stringify(r).length + 1;
    if (cur.length >= CHUNK_RECORDS || (cur.length > 0 && bytes + n > CHUNK_BYTES)) close();
    cur.push(r);
    bytes += n;
  }
  close();
  return out;
}

async function send(env: AnalyticsEnv, chunk: { body: string }, lane: Lane): Promise<void> {
  const key = parseServerKey((env as unknown as Record<string, unknown>)[KEY_SECRET]);
  const url = env.CANVALYTICS_URL;
  if (!key || !url) {
    warnOnce(`not configured: set CANVALYTICS_URL and the ${KEY_SECRET} secret (ck_<id>.<secret>); events are dropped`);
    return;
  }
  const binding = TRANSPORT === "service-binding" ? env.CANVALYTICS : undefined;
  if (TRANSPORT === "service-binding" && !binding) {
    warnOnce(`transport is service-binding but env.CANVALYTICS is not bound (service ${INGEST_SERVICE}); events are dropped`);
    return;
  }
  const batchId = ulid();
  for (let attempt = 0; attempt <= tuning.retries; attempt++) {
    try {
      const ts = Math.floor(Date.now() / 1000);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Canvalytics-Key": key.id,
        "X-Canvalytics-Timestamp": String(ts),
        "X-Canvalytics-Batch": batchId,
        "X-Canvalytics-Signature": await signBatch({ secret: key.secret, ts, batchId, body: chunk.body }),
        "X-Canvalytics-Lib": LIB,
      };
      if (lane === "client") headers["X-Canvalytics-Trust"] = "client";
      const init: RequestInit = { method: "POST", headers, body: chunk.body };
      const res = binding ? await binding.fetch(url, init) : await fetch(url, init);
      if (res.status === 429 || res.status >= 500) {
        await res.body?.cancel().catch(() => {});
        if (attempt < tuning.retries) {
          await sleep(tuning.retryBaseMs * (attempt + 1) * (0.5 + Math.random()));
          continue;
        }
        warnOnce(`ingest answered ${res.status}; batch ${batchId} dropped`);
        return;
      }
      if (!res.ok) warnOnce(`ingest answered ${res.status}; batch ${batchId} dropped`);
      else await res.body?.cancel().catch(() => {});
      return;
    } catch (e) {
      if (attempt < tuning.retries) {
        await sleep(tuning.retryBaseMs * (attempt + 1) * (0.5 + Math.random()));
        continue;
      }
      warnOnce(`ingest unreachable (${(e as Error)?.name ?? "error"}); batch ${batchId} dropped`);
    }
  }
}
