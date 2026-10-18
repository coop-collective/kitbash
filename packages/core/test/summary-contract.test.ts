import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import * as contract from "../src/contract.ts";
import { parseBlockRef, pinnedRef } from "../src/ref.ts";
import { ManifestSchema } from "../src/schema.ts";
import { buildCard, buildSummary, changelogTop, changelogUpgradeSection, checkSkill, estimateJsonTokens, estimateTokens } from "../src/summary.ts";
import { fixtures, FIXTURE_ID, loadFixtureBlock, text } from "./helpers.ts";

const contractSchema = JSON.parse(readFileSync(path.join(fixtures, "..", "..", "schema", "contract.v1.json"), "utf8"));
const blockSchema = JSON.parse(readFileSync(path.join(fixtures, "..", "..", "schema", "block.v1.json"), "utf8"));
const ajv = new (Ajv2020 as unknown as typeof Ajv2020.default)({ strict: false, allErrors: true });
ajv.addSchema(contractSchema, "contract");
const check = (def: string, value: unknown) => {
  const v = ajv.getSchema(`contract#/$defs/${def}`);
  if (!v) throw new Error(`no $defs/${def}`);
  const ok = v(value);
  return ok ? true : ajv.errorsText(v.errors);
};

async function manifest() {
  return ManifestSchema.parse((await loadFixtureBlock()).manifest);
}

describe("cards and summaries", () => {
  it("a card fits 100 tokens and carries summary + est_hours_saved", async () => {
    const m = await manifest();
    const card = buildCard(m, { id: FIXTURE_ID, trust: { tier: "scanned", sandbox: "passed" }, score: 0.9 });
    expect(estimateJsonTokens({ ...card, summary: undefined })).toBeLessThanOrEqual(100);
    expect(card.summary!.length).toBeLessThanOrEqual(160);
    expect(card.summary).toBe("Adds email-code sign-in and bearer tokens to a Hono Worker.");
    expect(card.est_hours_saved).toBe(6);
    expect(card.stack).toEqual(["cloudflare-workers", "hono", "d1", "vitest-workerd"]);
    expect(contract.Card.safeParse(card).success).toBe(true);
    expect(check("Card", card)).toBe(true);
  });

  it("a long title is trimmed to fit the card budget; the summary is capped at 160 chars", async () => {
    const m = await manifest();
    m.title = "A very long title with many words in it ".repeat(3).trim().slice(0, 120);
    m.agent!.summary = `${"word ".repeat(150)}.`;
    const card = buildCard(m, { id: FIXTURE_ID, lineage: "fork of @someone/email-otp", trust: { tier: "scanned", sandbox: "passed" } });
    expect(estimateJsonTokens({ ...card, summary: undefined })).toBeLessThanOrEqual(100);
    expect(card.title.length).toBeLessThan(m.title.length);
    expect(card.summary!.length).toBeLessThanOrEqual(160);
  });

  it("the summary is ≤ 1,500 tokens, puts every piece of author prose inside untrusted_author_text, and validates", async () => {
    const b = await loadFixtureBlock();
    const m = ManifestSchema.parse(b.manifest);
    const s = buildSummary(m, { id: FIXTURE_ID, changelog: text(b.files["CHANGELOG.md"]) });
    expect(s.size.summary_tokens).toBeLessThanOrEqual(1500);
    expect(s.untrusted_author_text.notice).toBe(contract.UNTRUSTED_NOTICE);
    expect(s.untrusted_author_text.adapt).toHaveLength(4);
    expect(s.untrusted_author_text.changelog_top).toBe("1.3.0: - Resend cooldown: 5 codes per address per hour.");
    // no prose outside the envelope: params/routes descriptions are dropped, adapt only inside
    const outside = { ...s, untrusted_author_text: undefined };
    expect(JSON.stringify(outside)).not.toMatch(/Protect your routes|code-spray|Short name used/);
    expect(s.est_hours_saved).toBe(6);
    expect(contract.Summary.safeParse(s).success).toBe(true);
    expect(check("Summary", s)).toBe(true);
    expect(check("registry_get_output", s)).toBe(true);
  });

  it("an over-budget summary throws 'split it or shorten it'", async () => {
    const m = await manifest();
    m.agent!.author_notes = "x ".repeat(1400);
    m.agent!.when_to_use = Array.from({ length: 10 }, () => "y ".repeat(140));
    expect(() => buildSummary(m, { id: FIXTURE_ID })).toThrow(/split it or shorten it/);
  });

  it("changelog helpers and the token estimator", () => {
    const cl = "## 2.0.0\n\n- Breaking.\n\n## Upgrade\n\nRename the table.\n\n## 1.0.0\n\n- First.\n";
    expect(changelogTop(cl)).toBe("2.0.0: - Breaking.\n\n## Upgrade\n\nRename the table.");
    expect(changelogUpgradeSection(cl)).toBe("Rename the table.");
    expect(changelogUpgradeSection("## 1.0.0\n\n- x\n")).toBe("");
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hello world")).toBeGreaterThan(1);
  });

  it("checkSkill: frontmatter, name and budget", () => {
    expect(checkSkill("---\nname: a\ndescription: Use when x.\n---\n# A\n", "a").ok).toBe(true);
    expect(checkSkill("# no frontmatter", "a").problems[0]).toMatch(/frontmatter/);
    expect(checkSkill("---\nname: b\ndescription: d\n---\n", "a").problems).toEqual(["frontmatter: name should be a"]);
  });
});

describe("contract", () => {
  it("defines the 11 registry_* tools with static descriptions and annotations", () => {
    expect(contract.REGISTRY_TOOLS.map((t) => t.name)).toEqual([
      "registry_search", "registry_get", "registry_read_file", "registry_install", "registry_verify", "registry_upgrade",
      "registry_diff", "registry_harvest", "registry_publish", "registry_propose", "registry_whoami",
    ]);
    for (const t of contract.REGISTRY_TOOLS) {
      expect(contractSchema.$defs[`${t.name}_input`]).toBeDefined();
      expect(contractSchema.$defs[`${t.name}_output`]).toBeDefined();
      expect(t.description.length).toBeGreaterThan(20);
    }
    expect(contract.REGISTRY_TOOLS.filter((t) => t.annotations.readOnlyHint).map((t) => t.name)).toEqual(["registry_search", "registry_get", "registry_read_file", "registry_diff", "registry_whoami"]);
  });

  it("tool input defaults: dry_run true, on_conflict stop, scope all", () => {
    const i = contract.registry_install_input.parse({ block: "@coop/x", project_root: "." });
    expect(i).toMatchObject({ dry_run: true, on_conflict: "stop", apply_config: true });
    expect(contract.registry_search_input.parse({ query: "auth" })).toMatchObject({ scope: "all", limit: 10 });
    expect(contract.registry_search_input.safeParse({ query: "auth", limit: 50 }).success).toBe(false);
  });

  it("the Error envelope has the shared code enum", () => {
    const e = contract.errorEnvelope("needs_local", "run it locally", { command: "kit install @coop/x" });
    expect(contract.ErrorEnvelope.safeParse(e).success).toBe(true);
    expect(check("Error", e)).toBe(true);
    expect(check("Error", { error: { code: "teapot", message: "x" } })).not.toBe(true);
  });

  it("schema/block.v1.json accepts the fixture manifest", async () => {
    const v = new (Ajv2020 as unknown as typeof Ajv2020.default)({ strict: false }).compile(blockSchema);
    expect(v((await loadFixtureBlock()).manifest)).toBe(true);
    expect(v({ name: "x" })).toBe(false);
  });

  // WP-07's draft examples (docs/examples on main, copied here) must validate against the generated contract.
  const examplesDir = path.join(fixtures, "contract-examples");
  for (const f of readdirSync(examplesDir).sort()) {
    it(`WP-07 example ${f} validates against contract.v1.json`, () => {
      const ex = JSON.parse(readFileSync(path.join(examplesDir, f), "utf8"));
      if (ex.def) return expect(check(ex.def, ex.value)).toBe(true);
      expect(check(`${ex.tool}_input`, ex.request)).toBe(true);
      expect(check(ex.response_def ?? `${ex.tool}_output`, ex.response)).toBe(true);
    });
  }
});

describe("block references", () => {
  it("splits on the last @", () => {
    expect(parseBlockRef("@coop/email-code-auth@1.3.0")).toEqual({ id: "@coop/email-code-auth", scope: "coop", name: "email-code-auth", version: "1.3.0" });
    expect(parseBlockRef("@coop/email-code-auth@stable")).toMatchObject({ tag: "stable" });
    expect(parseBlockRef("@coop/email-code-auth")).toEqual({ id: "@coop/email-code-auth", scope: "coop", name: "email-code-auth" });
    expect(pinnedRef("@coop/x", "1.0.0-beta.1")).toBe("@coop/x@1.0.0-beta.1");
    for (const bad of ["email-code-auth", "@coop", "@coop/x@", "@coop/x@1.0", "@Coop/x", "@coop/../x", "@coop/x@1.0.0@2.0.0"]) {
      expect(() => parseBlockRef(bad), bad).toThrow();
    }
  });
});
