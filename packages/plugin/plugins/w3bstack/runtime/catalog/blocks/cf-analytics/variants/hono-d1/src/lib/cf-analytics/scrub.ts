/**
 * PII scrubbing (DESIGN §12.3, §12.4).
 *
 * This file is self-contained on purpose (no imports): the Kitbash block `cf-analytics` vendors it byte for byte
 * (`src/lib/cf-analytics/scrub.ts`) and runs the same vectors (`test/vectors/scrub.json`), so secrets are scrubbed in the
 * app before they leave and again in the ingest.
 *
 * Two layers:
 *  - key denylist: a prop whose key names content or a credential is dropped whole;
 *  - value scrubbers: every string value (props, bodies) has emails, IPs, secrets, card numbers and long base64 runs
 *    replaced by a placeholder. Bodies are scrubbed line by line. Then caps: prop strings ≤ 256 chars, ≤ 32 props,
 *    bodies ≤ 4096 UTF-8 bytes.
 */

export const PROPS_MAX_KEYS = 32;
export const PROP_STRING_MAX_CHARS = 256;
export const BODY_MAX_BYTES = 4096;

export type ScrubScalar = string | number | boolean | null;

// ---------------------------------------------------------------------------------------------------------------
// Key denylist
// ---------------------------------------------------------------------------------------------------------------

/** Dropped when the whole key equals one of these (person names; `name` is too common a suffix to match by token). */
const DENY_EXACT: ReadonlySet<string> = new Set([
  "name",
  "first_name",
  "last_name",
  "full_name",
  "display_name",
  "given_name",
  "family_name",
  "username",
  "user_name",
  "dob",
  "birthday",
  "birthdate",
  "date_of_birth",
]);

/**
 * Content keys (xava's CONTENT_KEY set, extended): dropped when the key's LAST token is one of these, so
 * `prompt`, `system_prompt` and `error_message` go while `prompt_tokens` and `input_tokens` (usage counts) stay.
 */
const DENY_LAST_TOKEN: ReadonlySet<string> = new Set([
  "prompt",
  "prompts",
  "message",
  "messages",
  "input",
  "inputs",
  "output",
  "outputs",
  "content",
  "contents",
  "completion",
  "completions",
  "choices",
  "text",
  "body",
  "address",
  "addresses",
]);

/** Credential and contact keys: dropped when ANY `_`-separated token equals one of these (`user_email`, `access_token`). */
const DENY_ANY_TOKEN: ReadonlySet<string> = new Set([
  "email",
  "emails",
  "phone",
  "phones",
  "mobile",
  "token",
  "password",
  "passwd",
  "pwd",
  "secret",
  "secrets",
  "ssn",
  "iban",
  "cookie",
  "cookies",
  "authorization",
  "auth_header",
  "bearer",
  "jwt",
  "apikey",
  "ip",
  "credential",
  "credentials",
]);

/** Dropped when any token STARTS with one of these (`wallet*`, `card*`: `card_number`, `cardholder`, `credit_card`). */
const DENY_TOKEN_PREFIX: readonly string[] = ["wallet", "card"];

/** Dropped when the key contains one of these anywhere. */
const DENY_SUBSTRING: readonly string[] = ["api_key", "private_key", "access_key", "secret_key", "session_token"];

/** Never copied, whatever the grammar says (prototype pollution). */
const DENY_PROTO: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/** Normalises `userEmail` / `User-Email` / `user.email` to `user_email` for matching only. */
function keyTokens(key: string): string[] {
  const snake = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
  return snake.split(/[^a-z0-9]+/).filter((t) => t.length > 0);
}

/** True when the prop key must be dropped (DESIGN §12.3 key denylist). */
export function isDeniedKey(key: string): boolean {
  if (DENY_PROTO.has(key)) return true;
  const tokens = keyTokens(key);
  if (tokens.length === 0) return false;
  const joined = tokens.join("_");
  if (DENY_EXACT.has(joined)) return true;
  if (DENY_LAST_TOKEN.has(tokens[tokens.length - 1] as string)) return true;
  for (const t of tokens) {
    if (DENY_ANY_TOKEN.has(t)) return true;
    for (const p of DENY_TOKEN_PREFIX) if (t.startsWith(p)) return true;
  }
  for (const s of DENY_SUBSTRING) if (joined.includes(s)) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Value scrubbers
// ---------------------------------------------------------------------------------------------------------------

export const PLACEHOLDER = {
  email: "[email]",
  ip: "[ip]",
  secret: "[secret]",
  card: "[card]",
  blob: "[blob]",
} as const;

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * A card-like digit string: 13–19 digits, an issuer first digit (2–6: Mastercard 2/5, Amex/JCB/Diners 3, Visa 4,
 * Discover/UnionPay 6) and a valid Luhn checksum. The issuer digit keeps millisecond timestamps (`17…`) intact.
 */
export function isCardNumber(digits: string): boolean {
  return /^[2-6][0-9]{12,18}$/.test(digits) && luhn(digits);
}

const IPV4_OCTET = "(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])";
const IPV4_STRICT = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);
const IPV4_RE = new RegExp(`(?<![0-9A-Za-z.])${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}(?![0-9]|\\.[0-9])`, "g");

function isIPv6(candidate: string): boolean {
  let s = candidate;
  if (!/[0-9A-Fa-f]/.test(s)) return false;
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!IPV4_STRICT.test(tail)) return false;
    s = `${s.slice(0, lastColon + 1)}0:0`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return false;
  const groups = (part: string): string[] => (part === "" ? [] : part.split(":"));
  const all = [...groups(halves[0] as string), ...(halves.length === 2 ? groups(halves[1] as string) : [])];
  if (!all.every((g) => /^[0-9A-Fa-f]{1,4}$/.test(g))) return false;
  return halves.length === 2 ? all.length <= 7 : all.length === 8;
}

type Rule = readonly [RegExp, string | ((m: string, ...groups: string[]) => string)];

/** Applied in order to every line. Secrets first (a JWT contains base64 and dots), blobs last. */
const RULES: readonly Rule[] = [
  // credential assignments in log lines and query strings: password=…, "api_key": "…", token: …
  [
    /\b(password|passwd|pwd|secret|client_secret|token|access_token|refresh_token|id_token|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)((?:(?:Bearer|Basic|Token)\s+)?[^\s"'&,;]+)/gi,
    "$1$2[secret]",
  ],
  // HTTP authorization schemes
  [/\b([Bb]earer)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 [secret]"],
  [
    /\b(Basic)\s+([A-Za-z0-9+/]{8,}={0,2})(?![A-Za-z0-9+/=])/g,
    (m: string, scheme: string, cred: string) => (/[0-9A-Z+/=]/.test(cred.slice(1)) ? `${scheme} [secret]` : m),
  ],
  // JWT (header.payload.signature, the signature may be empty for alg none)
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, PLACEHOLDER.secret],
  // prefixed keys: Stripe sk_/rk_, PostHog phx_, Ideator hq_, Canvalytics ck_/cr_, webhook and GitHub tokens, Slack
  [
    /(?<![A-Za-z0-9])(?:sk|rk|phx|hq|ck|cr|whsec|ghp|gho|ghu|ghs|ghr|github_pat|xox[abprs])[_-][A-Za-z0-9_.-]{8,}/g,
    PLACEHOLDER.secret,
  ],
  // OpenAI / Anthropic style sk-…
  [/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/g, PLACEHOLDER.secret],
  // AWS access key ids
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, PLACEHOLDER.secret],
  // email addresses (bounded quantifiers: linear time on adversarial input)
  [
    /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}\b/g,
    PLACEHOLDER.email,
  ],
  // IPv6 (candidate run, then a real parser; times like 12:30:45 and MAC addresses are left alone)
  [
    /(?<![0-9A-Za-z:.])[0-9A-Fa-f:.]{2,45}(?![0-9A-Za-z:])/g,
    (m: string) => {
      const trimmed = m.replace(/\.+$/, "");
      const trailing = m.slice(trimmed.length);
      if ((trimmed.match(/:/g) ?? []).length < 2) return m;
      return isIPv6(trimmed) ? PLACEHOLDER.ip + trailing : m;
    },
  ],
  // IPv4
  [IPV4_RE, PLACEHOLDER.ip],
  // card numbers, optionally grouped by spaces or dashes
  [
    /(?<![0-9])[2-6](?:[ -]?[0-9]){12,18}(?![0-9])/g,
    (m: string) => (isCardNumber(m.replace(/[ -]/g, "")) ? PLACEHOLDER.card : m),
  ],
  // long base64 / base64url runs with mixed case and digits (random keys, encoded payloads); paths and
  // dashed titles have too many separators to qualify
  [
    /[A-Za-z0-9+/_-]{40,}={0,2}/g,
    (m: string) => {
      const seps = (m.match(/[/_-]/g) ?? []).length;
      const mixed = /[A-Z]/.test(m) && /[a-z]/.test(m) && /[0-9]/.test(m);
      return mixed && seps * 16 <= m.length ? PLACEHOLDER.blob : m;
    },
  ],
];

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// C0 controls except tab, plus DEL; newlines are handled by the line splitter
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Scrubs one line (no newline handling). */
function scrubLine(line: string): string {
  let out = line.replace(LONE_SURROGATE, "�").replace(CONTROL, "");
  for (const [re, rep] of RULES) {
    re.lastIndex = 0;
    out = out.replace(re, rep as never);
  }
  return out;
}

/** Truncates to at most `max` code points (never splits a surrogate pair). */
export function truncateChars(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = "";
  let n = 0;
  for (const ch of s) {
    if (n === max) break;
    out += ch;
    n++;
  }
  return out;
}

const encoder = new TextEncoder();

/** UTF-8 byte length. */
export function utf8Length(s: string): number {
  return encoder.encode(s).length;
}

/** Truncates to at most `maxBytes` UTF-8 bytes on a code point boundary. */
export function truncateBytes(s: string, maxBytes: number): string {
  if (s.length * 3 <= maxBytes || utf8Length(s) <= maxBytes) return s;
  let out = "";
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + n > maxBytes) break;
    out += ch;
    bytes += n;
  }
  return out;
}

/** Scrubs a single-line string value (newlines collapse to spaces) and caps it at `maxChars`. */
export function scrubString(s: string, maxChars: number = PROP_STRING_MAX_CHARS): string {
  return truncateChars(scrubLine(s.replace(/\r\n|\r|\n/g, " ")), maxChars);
}

/** Scrubs a log/message body line by line and caps it at `maxBytes` UTF-8 bytes. */
export function scrubBody(body: string, maxBytes: number = BODY_MAX_BYTES): string {
  // Work on a bounded prefix: nothing past 4× the cap can survive the cap, and it bounds the regex work.
  const input = body.length > maxBytes * 4 ? body.slice(0, maxBytes * 4) : body;
  const lines = input.split(/\r\n|\r|\n/);
  return truncateBytes(lines.map(scrubLine).join("\n"), maxBytes);
}

/** Scrubs one prop value. Strings are scrubbed and capped; card-like integers become `[card]`; non-scalars are dropped (undefined). */
export function scrubValue(v: unknown): ScrubScalar | undefined {
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return undefined;
    if (Number.isSafeInteger(v) && isCardNumber(String(Math.abs(v)))) return PLACEHOLDER.card;
    return v;
  }
  if (typeof v === "string") return scrubString(v);
  return undefined;
}

/**
 * Scrubs a props object: denylisted keys dropped, values scrubbed, non-scalar values dropped, at most 32 keys kept
 * (in insertion order). Returns a fresh object; only own enumerable keys of the input are read.
 */
export function scrubProps(props: unknown): Record<string, ScrubScalar> {
  const out: Record<string, ScrubScalar> = {};
  if (props === null || typeof props !== "object" || Array.isArray(props)) return out;
  let n = 0;
  for (const key of Object.keys(props)) {
    if (n >= PROPS_MAX_KEYS) break;
    if (isDeniedKey(key)) continue;
    const v = scrubValue((props as Record<string, unknown>)[key]);
    if (v === undefined) continue;
    Object.defineProperty(out, key, { value: v, enumerable: true, writable: true, configurable: true });
    n++;
  }
  return out;
}

export interface Scrubbable {
  props?: Record<string, unknown> | undefined;
  body?: string | undefined;
}

/** Scrubs a record's `props` and `body`; every other field is copied as is. Returns a new object. */
export function scrub<T extends Scrubbable>(record: T): T {
  const out = { ...record };
  if (record.props !== undefined) out.props = scrubProps(record.props) as T["props"];
  if (typeof record.body === "string") out.body = scrubBody(record.body) as T["body"];
  return out;
}

/** Keeps a path without query string or fragment (DESIGN §12.4), scrubbed and capped. */
export function stripQuery(path: string): string {
  const cut = path.search(/[?#]/);
  return scrubString(cut === -1 ? path : path.slice(0, cut));
}

/** Reduces a referrer URL to its lower-cased host, or null when it is not an http(s) URL. */
export function refDomain(referrer: string): string | null {
  try {
    const u = new URL(referrer);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}
