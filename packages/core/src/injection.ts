/**
 * Prompt-injection heuristics for author-written text (scanner rule 5). These run on manifest text fields
 * (`title`, `description`, `agent.*`, descriptions, notes) and on every Markdown file in the bundle.
 * They are heuristics: `block` for phrasing that has no business in a feature's docs (instructions aimed at an
 * agent, exfiltration, pipe-to-shell), `warn` for things that are sometimes legitimate (URLs to fetch, HTML
 * comments, encoded blobs).
 */
import type { Severity } from "./errors.ts";

export interface InjectionHit {
  rule: string;
  severity: Severity;
  line: number;
  excerpt: string;
}

const BLOCK_PATTERNS: { rule: string; re: RegExp }[] = [
  {
    rule: "ignore_instructions",
    re: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|preceding|all|any|your|system|safety)\b[^.\n]{0,30}\b(instructions?|prompts?|rules|guidelines|directions|guardrails|constraints)\b/i,
  },
  { rule: "role_override", re: /\b(you (must|should|will) now|you are now|from now on,? you|act as (an?|the) (admin|root|system|developer))\b/i },
  { rule: "new_instructions", re: /\b(new|updated|real|actual|hidden|secret) (system )?(instructions?|directives?|orders)\s*[:-]/i },
  { rule: "conceal_from_user", re: /\b(do not|don't|never|without)\s+(\w+\s+){0,2}(tell|telling|inform|informing|mention\w* (this|it) to|alert|alerting|ask|asking|notify|notifying|warn|warning)\s+(the\s+|your\s+)?(user|human|person|owner|operator)\b/i },
  { rule: "pipe_to_shell", re: /\b(curl|wget|iwr|invoke-webrequest)\b[^\n|]{0,200}\|\s*(sudo\s+)?(ba|z|da|k)?sh\b|\b(ba|z)?sh\s+<\(\s*(curl|wget)/i },
  { rule: "tool_permission", re: /\b(disable|turn off|skip|bypass)\b[^.\n]{0,30}\b(sandbox|permission|approval|confirmation|allowlist|safety)\b/i },
];

const SECRETISH = /\b(secrets?|credentials?|tokens?|api[ _-]?keys?|private[ _-]?keys?|ssh|\.env\b|\.dev\.vars|passwords?|env(ironment)?[ _-]?(vars?|variables)|cookies?|session)\b/i;
const EXFIL_VERB = /\b(send|post|upload|exfiltrate|forward|transmit|leak|copy|share|report)\b/i;
const DESTINATION = /https?:\/\/|\bwebhook\b|\b[a-z0-9-]+\.(com|net|org|io|dev|xyz|ru|cn|site|app)\b/i;

const WARN_PATTERNS: { rule: string; re: RegExp }[] = [
  { rule: "url_instruction", re: /\b(fetch|download|visit|open|curl|wget|load|go to|navigate to|read)\b[^\n]{0,40}https?:\/\//i },
  { rule: "agent_addressed", re: /\b(as an ai|ai assistant|language model|dear (ai|agent|assistant)|(claude|chatgpt|codex|copilot|gemini|the agent|the assistant)[,:]?\s+(must|should|need to|has to|will))\b/i },
  { rule: "system_prompt", re: /\bsystem prompt\b/i },
  { rule: "encoded_payload", re: /[A-Za-z0-9+/]{80,}={0,2}/ },
  { rule: "decode_and_run", re: /\b(base64\s+(-d|--decode)|atob\s*\(|eval\s*\()/i },
];

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function excerpt(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 77)}...` : t;
}

/** Scans author text. `markdown` also flags HTML comments (hidden from rendered views, visible to agents). */
export function findInjection(text: string, opts: { markdown?: boolean } = {}): InjectionHit[] {
  const hits: InjectionHit[] = [];
  for (const { rule, re } of BLOCK_PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of text.matchAll(g)) hits.push({ rule, severity: "block", line: lineOf(text, m.index!), excerpt: excerpt(m[0]) });
  }
  // exfiltration: a sentence with a send-like verb, something secret, and a destination
  // sentences end at . ! ? followed by whitespace, or at a newline (".dev.vars" and "a.example.com" don't split)
  for (const m of text.matchAll(/[^\n]+?(?:[.!?](?=\s)|$)/gm)) {
    const sentence = m[0];
    if (EXFIL_VERB.test(sentence) && SECRETISH.test(sentence) && DESTINATION.test(sentence)) {
      hits.push({ rule: "exfiltration", severity: "block", line: lineOf(text, m.index!), excerpt: excerpt(sentence) });
    }
  }
  for (const { rule, re } of WARN_PATTERNS) {
    const g = new RegExp(re.source, `${re.flags.replace("g", "")}g`);
    for (const m of text.matchAll(g)) hits.push({ rule, severity: "warn", line: lineOf(text, m.index!), excerpt: excerpt(m[0]) });
  }
  if (opts.markdown) {
    for (const m of text.matchAll(/<!--([\s\S]*?)-->/g)) {
      const body = m[1] ?? "";
      const imperative = /\b(ignore|must|agent|assistant|claude|codex|llm|ai|run|execute|instruction|prompt|curl|fetch)\b/i.test(body);
      hits.push({ rule: "html_comment", severity: imperative ? "block" : "warn", line: lineOf(text, m.index!), excerpt: excerpt(body) });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}
