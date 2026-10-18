/**
 * The three sizes of a block (DESIGN §2.3): card (≤ 100 tokens), summary (≤ 1,500 tokens), bundle. Budgets are
 * enforced here; a summary over budget throws with "split it or shorten it".
 */
import { KitError } from "./errors.ts";
import { UNTRUSTED_NOTICE, type CardT, type PriceT, type SummaryT, type TrustT } from "./contract.ts";
import { defaultVariant, type Manifest } from "./schema.ts";
import { checkVerifyCommand } from "./verify.ts";

export const CARD_BUDGET = 100;
export const SUMMARY_BUDGET = 1500;
export const SKILL_BUDGET = 1500;

/**
 * Token estimate without a tokenizer: the larger of chars/3.6 and the number of word pieces (letter runs, digit
 * groups of up to 3, punctuation runs). Slightly above what current BPE tokenizers report for English prose and
 * JSON, so a block that passes here passes there.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const chars = text.length / 3.6;
  const pieces = (text.match(/[A-Za-z]+|[0-9]{1,3}|[^\sA-Za-z0-9]+/g) ?? []).length;
  return Math.ceil(Math.max(chars, pieces));
}

export function estimateJsonTokens(value: unknown): number {
  return estimateTokens(JSON.stringify(value));
}

export interface CardOptions {
  id: string;
  variant?: string;
  trust?: TrustT;
  price?: PriceT;
  lineage?: string;
  score?: number;
}

function firstSentence(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(one);
  const sentence = m ? m[1]! : one;
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Builds a search card: ≤ 100 tokens, plus an optional one-line `summary` (≤ 160 chars, the first sentence of
 * `agent.summary`, author text). Trims the title when the card is over budget.
 */
export function buildCard(m: Manifest, opts: CardOptions): CardT {
  const variant = opts.variant ?? defaultVariant(m).id;
  const v = m.variants.find((x) => x.id === variant);
  const stack = { ...m.stack, ...(v?.stack ?? {}) };
  const card: CardT = {
    id: opts.id,
    version: m.version,
    variant,
    title: m.title.slice(0, 120),
    stack: [stack.runtime, stack.framework, stack.db, stack.ui && stack.ui !== "none" ? stack.ui : undefined, stack.test].filter(
      (x): x is string => typeof x === "string",
    ),
    size: { files: m.size?.files ?? m.files.length, lines: m.size?.lines ?? 0 },
    trust: opts.trust ?? { tier: "unreviewed", sandbox: "not_run" },
    license: m.license,
    score: Math.max(0, Math.min(1, opts.score ?? 0)),
  };
  if (opts.price) card.price = opts.price;
  if (opts.lineage) card.lineage = opts.lineage;
  else if (m.lineage?.forked_from) card.lineage = `fork of ${m.lineage.forked_from.block}`;
  if (m.agent?.summary) card.summary = firstSentence(m.agent.summary, 160);
  if (typeof m.meta?.est_hours_saved === "number") card.est_hours_saved = m.meta.est_hours_saved;
  // fit the budget (measured without the optional one-line summary, which is capped at 160 chars on its own)
  const { summary: _s, ...rest } = card;
  while (estimateJsonTokens({ ...rest, title: card.title }) > CARD_BUDGET && card.title.length > 30) {
    card.title = `${card.title.slice(0, Math.floor(card.title.length * 0.8)).trimEnd()}…`;
  }
  return card;
}

/** The top `## <version>` section of a CHANGELOG (without its heading line), trimmed. */
export function changelogTop(changelog: string | undefined): string | undefined {
  if (!changelog) return undefined;
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => /^##\s+\S/.test(l));
  if (start < 0) return undefined;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^##\s+\S/.test(lines[i]!) && !/^##\s+Upgrade\b/i.test(lines[i]!)) { end = i; break; }
  const heading = lines[start]!.replace(/^##\s+/, "").trim();
  const body = lines.slice(start + 1, end).join("\n").trim();
  const out = `${heading}: ${body}`.trim();
  return out.length > 1200 ? `${out.slice(0, 1199)}…` : out;
}

/** The `## Upgrade` section inside the top changelog entry (or anywhere before the second version heading). */
export function changelogUpgradeSection(changelog: string | undefined): string {
  if (!changelog) return "";
  const lines = changelog.split("\n");
  let seenVersion = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^##\s+Upgrade\b/i.test(l) || /^###\s+Upgrade\b/i.test(l)) {
      const level = l.startsWith("###") ? 3 : 2;
      const out: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const h = /^(#{2,3})\s/.exec(lines[j]!);
        if (h && h[1]!.length <= level) break;
        out.push(lines[j]!);
      }
      return out.join("\n").trim();
    }
    if (/^##\s+\S/.test(l)) {
      seenVersion++;
      if (seenVersion > 1) break;
    }
  }
  return "";
}

export interface SummaryOptions {
  id: string;
  variant?: string;
  trust?: TrustT;
  price?: PriceT;
  lineage?: string;
  changelog?: string;
}

/**
 * Builds the `registry_get` summary: the manifest minus file contents, with every piece of author prose inside
 * `untrusted_author_text`. Throws `KitError(invalid_params, rule "budget")` above 1,500 tokens.
 */
export function buildSummary(m: Manifest, opts: SummaryOptions): SummaryT {
  const variant = opts.variant ?? defaultVariant(m).id;
  const v = m.variants.find((x) => x.id === variant);
  const verifyCommands = m.verify?.commands ?? [];
  const s: SummaryT = {
    detail: "summary",
    id: opts.id,
    version: m.version,
    variant,
    variants: m.variants.map((x) => ({ id: x.id, default: x === defaultVariant(m), ...(x.stack ? { stack: x.stack } : {}) })),
    title: m.title,
    license: m.license,
    stack: { ...m.stack, ...(v?.stack ?? {}) },
    size: { files: m.size?.files ?? m.files.length, lines: m.size?.lines ?? 0, ...(m.size?.summary_tokens !== undefined ? { summary_tokens: m.size.summary_tokens } : {}) },
    trust: opts.trust ?? { tier: "unreviewed", sandbox: "not_run" },
    params: (m.params ?? []).map(({ description: _d, ...p }) => p),
    verify: {
      commands: verifyCommands,
      ...(m.verify?.expect ? { expect: m.verify.expect } : {}),
    },
    untrusted_author_text: { notice: UNTRUSTED_NOTICE },
  };
  const skipped = verifyCommands.filter((c) => !/\{\{/.test(c) && !checkVerifyCommand(c).allowed);
  if (skipped.length) s.verify.skipped = skipped.map((command) => ({ command, reason: checkVerifyCommand(command).reason ?? "not allowed" }));
  if (opts.price) s.price = opts.price;
  if (opts.lineage) s.lineage = opts.lineage;
  const compat = { ...(m.compat ?? {}), ...(v?.compat ?? {}) };
  if (Object.keys(compat).length) s.compat = compat;
  if (m.env?.length) s.env = m.env.map((e) => ({ name: e.name, secret: !!e.secret, ...(e.default !== undefined ? { default: e.default } : {}) }));
  if (m.secrets?.length) s.secrets = m.secrets.map((x) => ({ name: x.name, required: x.required ?? true }));
  if (m.bindings?.length) s.bindings = m.bindings.map((b) => ({ type: b.type, name: b.name, required: b.required ?? true }));
  if (m.migrations?.length) s.migrations = m.migrations.map((x) => ({ name: x.name, creates: x.creates ?? [] }));
  if (m.tables?.length) s.tables = m.tables;
  if (m.routes?.length) s.routes = m.routes.map(({ description: _d, ...r }) => r);
  if (m.exports?.length) s.exports = m.exports;
  if (m.tests?.length) s.tests = m.tests;
  if (m.dependencies?.length) s.dependencies = m.dependencies;
  if (m.devDependencies?.length) s.devDependencies = m.devDependencies;
  if (m.registryDependencies?.length) s.registryDependencies = m.registryDependencies;
  if (typeof m.meta?.est_hours_saved === "number") s.est_hours_saved = m.meta.est_hours_saved;
  const u = s.untrusted_author_text;
  u.description = m.description;
  if (m.agent?.summary) u.summary = m.agent.summary;
  if (m.agent?.when_to_use?.length) u.when_to_use = m.agent.when_to_use;
  if (m.agent?.when_not_to_use?.length) u.when_not_to_use = m.agent.when_not_to_use;
  if (m.agent?.adapt?.length) u.adapt = m.agent.adapt;
  if (m.agent?.author_notes) u.author_notes = m.agent.author_notes;
  const top = changelogTop(opts.changelog);
  if (top) u.changelog_top = top;
  const tokens = estimateJsonTokens(s);
  if (tokens > SUMMARY_BUDGET) {
    throw new KitError("invalid_params", `summary is ~${tokens} tokens (budget ${SUMMARY_BUDGET}): split it or shorten it`, { rule: "budget", details: { tokens } });
  }
  s.size.summary_tokens = tokens;
  return s;
}

export interface SkillCheck {
  ok: boolean;
  tokens: number;
  problems: string[];
  frontmatter: Record<string, string>;
}

/** Checks SKILL.md: Agent Skills frontmatter (`name`, `description`), budget, and the recommended headings. */
export function checkSkill(md: string, blockName?: string): SkillCheck {
  const problems: string[] = [];
  const frontmatter: Record<string, string> = {};
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(md.replace(/^﻿/, ""));
  if (!fm) problems.push("missing frontmatter (--- name/description ---)");
  else {
    for (const line of fm[1]!.split("\n")) {
      const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
      if (m) frontmatter[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
    if (!frontmatter.name) problems.push("frontmatter: name is required");
    else if (blockName && frontmatter.name !== blockName) problems.push(`frontmatter: name should be ${blockName}`);
    if (!frontmatter.description) problems.push("frontmatter: description is required");
  }
  const tokens = estimateTokens(md);
  if (tokens > SKILL_BUDGET) problems.push(`~${tokens} tokens (budget ${SKILL_BUDGET})`);
  return { ok: problems.length === 0, tokens, problems, frontmatter };
}
