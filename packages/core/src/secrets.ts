/**
 * Secret detection (scanner rule 1) and redaction (harvester). Known key formats are `block`; high-entropy strings
 * are `warn` (they are often hashes or test vectors) unless they sit in an env-like assignment.
 */

export interface SecretHit {
  kind: string;
  /** 0-based index into the text. */
  index: number;
  match: string;
  line: number;
  confidence: "known" | "entropy";
}

/** Prefixed app tokens look like snake_case identifiers unless the tail is random; require randomness. */
const randomTail = (m: string) => {
  const tail = m.slice(m.indexOf("_") + 1);
  return /\d/.test(tail) && /[A-Za-z]/.test(tail) && !/^[a-z0-9_]+$/.test(tail) && shannonEntropy(tail) > 3.5;
};

export const SECRET_PATTERNS: readonly { kind: string; re: RegExp; check?: (m: string) => boolean }[] = [
  { kind: "private-key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },
  { kind: "stripe-secret-key", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/g },
  { kind: "stripe-test-key", re: /\b(?:sk|rk)_test_[A-Za-z0-9]{16,}/g },
  { kind: "stripe-webhook-secret", re: /\bwhsec_[A-Za-z0-9]{24,}/g },
  { kind: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "ideator-token", re: /\bhq_[A-Za-z0-9_-]{20,}/g , check: randomTail },
  { kind: "xinf-key", re: /\bxk_(?:live|test)_[A-Za-z0-9_-]{16,}/g , check: randomTail },
  { kind: "mailcheap-token", re: /\bmc_[A-Za-z0-9_-]{20,}/g , check: randomTail },
  { kind: "kitbash-token", re: /\bkit_[A-Za-z0-9_-]{20,}/g , check: randomTail },
  { kind: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/g },
  { kind: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "openai-key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: "cloudflare-api-token", re: /\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*[=:]\s*["']?[A-Za-z0-9_-]{40}\b/g },
  { kind: "url-credentials", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"'`]+:[^\s:/@"'`]{6,}@[^\s"'`]+/gi },
];

export function shannonEntropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function lineAt(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

const CANDIDATE = /[A-Za-z0-9+/_=-]{32,}/g;

/** True for strings that look random enough to be a credential (and aren't obviously something else). */
export function looksHighEntropy(token: string): boolean {
  if (token.length < 32) return false;
  if (/^[a-f0-9]+$/i.test(token)) return token.length >= 40 && shannonEntropy(token) > 3.6 && token.length !== 64 && token.length !== 40;
  if (/^[A-Za-z]+$/.test(token) || /^[0-9]+$/.test(token)) return false;
  if (/^[A-Za-z0-9_]+$/.test(token) && /_/.test(token) && !/\d/.test(token)) return false; // SNAKE_CASE_NAMES
  if (/^[a-z0-9-]+$/.test(token) && token.split("-").length > 3) return false; // kebab-case identifiers
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((r) => r.test(token)).length;
  return classes >= 3 && shannonEntropy(token) > 4.2;
}

/** Finds secrets in text. `entropy: false` limits the search to known formats. */
export function findSecrets(text: string, opts: { entropy?: boolean } = {}): SecretHit[] {
  const hits: SecretHit[] = [];
  const covered: [number, number][] = [];
  for (const { kind, re, check } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (check && !check(m[0])) continue;
      hits.push({ kind, index: m.index!, match: m[0], line: lineAt(text, m.index!), confidence: "known" });
      covered.push([m.index!, m.index! + m[0].length]);
    }
  }
  if (opts.entropy !== false) {
    for (const m of text.matchAll(CANDIDATE)) {
      const start = m.index!;
      if (covered.some(([a, b]) => start < b && start + m[0].length > a)) continue;
      // skip integrity hashes and data URIs: they are content hashes, not credentials
      const before = text.slice(Math.max(0, start - 12), start);
      if (/sha(256|384|512)-$|base64,$/.test(before)) continue;
      if (looksHighEntropy(m[0])) {
        hits.push({ kind: "high-entropy", index: start, match: m[0], line: lineAt(text, start), confidence: "entropy" });
      }
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** Replaces every secret found with `REDACTED_<KIND>` and reports what was redacted. */
export function redactSecrets(text: string, opts: { entropy?: boolean } = {}): { text: string; redactions: { kind: string; count: number }[] } {
  const hits = findSecrets(text, opts);
  if (hits.length === 0) return { text, redactions: [] };
  let out = "";
  let last = 0;
  const counts = new Map<string, number>();
  for (const h of hits) {
    if (h.index < last) continue; // overlapping
    out += text.slice(last, h.index) + `REDACTED_${h.kind.toUpperCase().replace(/-/g, "_")}`;
    last = h.index + h.match.length;
    counts.set(h.kind, (counts.get(h.kind) ?? 0) + 1);
  }
  out += text.slice(last);
  return { text: out, redactions: [...counts].map(([kind, count]) => ({ kind, count })) };
}

// ---------- text hygiene (scanner rule 5, partial) ----------

export interface HygieneHit {
  rule: "invisible_unicode" | "ansi_escape" | "control_char" | "bidi_control";
  index: number;
  line: number;
  codepoint: string;
}

// Zero-width and joiners, word joiner and invisible operators, BOM (not at start), tag characters, variation
// selectors supplement (GlassWorm), private use areas, interlinear annotation, Mongolian vowel separator, soft hyphen.
const INVISIBLE = /[\u00ad\u180e\u200b-\u200d\u2060-\u2064\ufeff\ufff9-\ufffb\ue000-\uf8ff]|[\u{e0000}-\u{e007f}]|[\u{e0100}-\u{e01ef}]|[\u{f0000}-\u{10ffff}]/gu;
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/gu;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b|\u009b/g;
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f\u0080-\u009a\u009c-\u009f]/g;

export function findHiddenText(text: string): HygieneHit[] {
  const hits: HygieneHit[] = [];
  const add = (rule: HygieneHit["rule"], re: RegExp) => {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (rule === "invisible_unicode" && m[0] === "\ufeff" && m.index === 0) continue; // a leading BOM is fine
      hits.push({ rule, index: m.index!, line: lineAt(text, m.index!), codepoint: `U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}` });
    }
  };
  add("invisible_unicode", INVISIBLE);
  add("bidi_control", BIDI);
  add("ansi_escape", ANSI);
  add("control_char", CTRL);
  return hits.sort((a, b) => a.index - b.index);
}
