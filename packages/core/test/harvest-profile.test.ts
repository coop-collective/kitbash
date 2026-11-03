import { describe, expect, it } from "vitest";
import { appendMissingLines, mergeJsonc } from "../src/config-merge.ts";
import { memoryFs } from "../src/fs.ts";
import { harvestDraft } from "../src/harvest.ts";
import { detectStack, loadOrDetectProfile, readProfile, writeProfile, PROFILE_PATH } from "../src/profile.ts";
import { validateBlock } from "../src/scan.ts";
import { findSecrets, redactSecrets } from "../src/secrets.ts";
import { loadProject, text } from "./helpers.ts";

const SOURCE: Record<string, string> = {
  "migrations/0007_api_keys.sql": "CREATE TABLE api_keys (id TEXT PRIMARY KEY, key_hash TEXT NOT NULL, created_at TEXT);\nCREATE INDEX api_keys_hash ON api_keys(key_hash);\n",
  "src/lib/keys.ts": [
    'import { Hono } from "hono";',
    'const PREFIX = "xk_";',
    'const STRIPE = "sk_live_51HxT0kLmNoPqRsTuVwXyZ0123456789";',
    "export async function createKey(env: { DB: D1Database; KEY_PEPPER: string; MAILCHEAP_DOMAIN: string }) {",
    '  await env.DB.prepare("INSERT INTO api_keys (id) VALUES (?)").bind(crypto.randomUUID()).run();',
    "  return PREFIX + env.KEY_PEPPER + env.MAILCHEAP_DOMAIN;",
    "}",
    "export const keys = new Hono();",
    'keys.post("/api/keys", (c) => c.json({ ok: true }));',
    'keys.delete("/api/keys/:id", (c) => c.json({ ok: true, from: "mailcheap.app", site: "https://mailcheap.app" }));',
    "",
  ].join("\n"),
  "test/keys.test.ts": 'import { createKey } from "../src/lib/keys";\nimport { it } from "vitest";\nit("mailcheap", () => {});\n',
  ".dev.vars": "KEY_PEPPER=supersecretvalue\n",
};

function harvest() {
  return harvestDraft({
    name: "api-keys",
    description: "Prefixed API keys with HMAC storage and revoke routes. Harvested from mailcheap.",
    files: SOURCE,
    profile: loadProject().profile,
    packageJson: { name: "mailcheap", dependencies: { hono: "^4.7.0" } },
    wrangler: { d1_databases: [{ binding: "DB" }] },
    source: { repo: "github.com/Disturbing/mailcheap", commit: "abc1234" },
    now: "2026-10-20T09:00:00Z",
  });
}

describe("harvestDraft", () => {
  it("infers migrations, tables, routes, env, secrets, bindings, exports, tests and deps", () => {
    const h = harvest();
    const m = h.manifest as Record<string, any>;
    expect(m.migrations).toEqual([{ file: "migrations/0001_api_keys.sql", name: "api_keys", creates: ["api_keys"] }]);
    expect(m.tables).toEqual(["api_keys"]);
    expect(m.routes).toEqual([
      { method: "POST", path: "/api/keys", auth: "public" },
      { method: "DELETE", path: "/api/keys/:id", auth: "public" },
    ]);
    expect(m.bindings).toEqual([{ type: "d1", name: "DB", required: true }]);
    expect(m.secrets.map((s: { name: string }) => s.name)).toEqual(["KEY_PEPPER"]);
    expect(m.env.map((s: { name: string }) => s.name)).toEqual(["MAILCHEAP_DOMAIN"]);
    expect(m.exports.map((e: { symbol: string }) => e.symbol)).toEqual(["createKey", "keys"]);
    expect(m.tests).toEqual([{ file: "test/keys.test.ts", runner: "vitest-workerd", covers: [] }]);
    expect(m.dependencies).toEqual(["hono@^4.7.0"]);
    expect(m.verify.commands).toEqual(["npx vitest run {{paths.tests}}/keys.test.ts", "npx tsc --noEmit"]);
    expect(m.variants[0]).toMatchObject({ id: "hono-d1", root: "variants/hono-d1" });
    expect(m.provenance.source).toMatchObject({ repo: "github.com/Disturbing/mailcheap", commit: "abc1234" });
  });

  it("redacts known secrets, drops secret files, and proposes params from repeated literals", () => {
    const h = harvest();
    const keys = text(h.files["variants/hono-d1/src/lib/keys.ts"])!;
    expect(keys).not.toContain("sk_live_");
    expect(keys).toContain("REDACTED_STRIPE_SECRET_KEY");
    expect(h.redactions).toEqual(expect.arrayContaining([{ path: ".dev.vars", kind: "env-file", count: 1 }, { path: "src/lib/keys.ts", kind: "stripe-secret-key", count: 1 }]));
    expect(Object.keys(h.files).some((p) => p.includes(".dev.vars"))).toBe(false);
    const params = (h.manifest.params as { name: string; default: string }[]).map((p) => `${p.name}=${p.default}`);
    expect(params).toEqual(expect.arrayContaining(["appSlug=mailcheap", "tokenPrefix=xk_", "appDomain=mailcheap.app"]));
    expect(keys).toContain('const PREFIX = "{{kit.tokenPrefix}}";');
    expect(keys).toContain('from: "{{kit.appDomain}}"');
    expect(text(h.files["variants/hono-d1/test/keys.test.ts"])).toContain('it("{{kit.appSlug}}"');
  });

  it("the draft fails validation only on its two TODOs, and passes once they are written", async () => {
    const h = harvest();
    const v = await validateBlock({ manifest: h.manifest, files: h.files });
    const blocking = v.findings.filter((f) => f.severity === "block");
    expect(blocking.map((f) => `${f.rule}@${f.path}`)).toEqual(["todo@block.json#/agent/summary", "todo@block.json#/agent/adapt/0/title"]);
    expect(h.todo.slice(0, 2)).toEqual(["Write agent.summary (replace the TODO)", "Write agent.adapt[] (replace the TODO item; add where/do/check)"]);
    const m = structuredClone(h.manifest) as Record<string, any>;
    m.agent.summary = "Adds prefixed API keys with HMAC storage and two routes.";
    m.agent.adapt[0].title = "Mount the keys routes";
    const v2 = await validateBlock({ manifest: m, files: h.files });
    expect(v2.findings.filter((f) => f.severity === "block")).toEqual([]);
    expect(v2.ok).toBe(true);
  });

  it("files that already contain {{kit. tokens are copied verbatim with template: false", () => {
    const h = harvestDraft({ name: "x", description: "X.", files: { "src/lib/t.ts": "const s = '{{kit.foo}}';\n" } });
    expect((h.manifest.files as { template?: boolean }[])[0]!.template).toBe(false);
    expect(h.todo.some((t) => t.includes("template: false"))).toBe(true);
  });

  it("refuses unsafe paths in the selection", () => {
    const h = harvestDraft({ name: "x", description: "X.", files: { "../etc/passwd": "root", "src/lib/a.ts": "export const a = 1;\n" } });
    expect(Object.keys(h.files).some((p) => p.includes("passwd"))).toBe(false);
    expect(h.todo.some((t) => t.includes("unsafe path"))).toBe(true);
  });
});

describe("secrets", () => {
  it("known formats are found; identifiers and hashes are not", () => {
    const hits = findSecrets([
      "hq_9fK2mQx7LpZ4vB8nR1tY6wE3sA0dG5hJ",
      "xk_live_ab12CD34ef56GH78ij90",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "postgres://admin:hunter22pass@db.example.com/x",
    ].join("\n"));
    expect(hits.map((h) => h.kind)).toEqual(["ideator-token", "xinf-key", "jwt", "private-key", "url-credentials"]);
    expect(findSecrets("const kit_template_hono_d1_database_name = 1; hq_template_project_name_value")).toEqual([]);
    expect(findSecrets("sha256 = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad").filter((h) => h.confidence === "known")).toEqual([]);
    expect(redactSecrets("key=AKIAIOSFODNN7EXAMPLE").text).toBe("key=REDACTED_AWS_ACCESS_KEY");
  });
});

describe("config merges", () => {
  it("preserves append-only Durable Object migration tags", () => {
    const base = '{ "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Existing"] }] }';
    const collision = mergeJsonc(base, '{ "migrations": [{ "tag": "v1", "new_sqlite_classes": ["New"] }] }', "jsonc-deep", { file: "wrangler.jsonc" });
    expect(collision.conflicts[0]?.detail).toMatch(/choose a new tag/);
    expect(collision.text).toBe(base);
    expect(mergeJsonc(base, '{ "migrations": [{ "new_sqlite_classes": ["Existing"], "tag": "v1" }] }', "jsonc-deep").changed).toBe(false);
    const fresh = mergeJsonc(base, '{ "migrations": [{ "tag": "v2", "new_sqlite_classes": ["New"] }] }', "jsonc-deep");
    expect(JSON.parse(fresh.text).migrations).toHaveLength(2);
    expect(mergeJsonc(null, '{ "migrations": [{ "tag": "v1" }, { "tag": "v1" }] }', "jsonc-deep").conflicts).toHaveLength(1);
  });

  it("unions container definitions by class without replacing host image settings", () => {
    const base = '{ "containers": [{ "class_name": "App", "image": "./custom.Dockerfile" }] }';
    const patch = '{ "containers": [{ "class_name": "App", "image": "./Dockerfile", "max_instances": 2 }, { "class_name": "Other", "image": "./other.Dockerfile" }] }';
    const result = mergeJsonc(base, patch, "jsonc-deep", { file: "wrangler.jsonc" });
    expect(JSON.parse(result.text).containers).toEqual([
      { class_name: "App", image: "./custom.Dockerfile", max_instances: 2 },
      { class_name: "Other", image: "./other.Dockerfile" },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(mergeJsonc(result.text, patch, "jsonc-deep").changed).toBe(false);
  });

  it("jsonc-deep keeps comments, unions bindings by name, keeps the project's values", () => {
    const base = '{\n  // keep me\n  "d1_databases": [\n    { "binding": "DB", "database_id": "real" }\n  ],\n  "compatibility_flags": ["nodejs_compat"]\n}\n';
    const r = mergeJsonc(base, '{ "d1_databases": [{ "binding": "DB", "database_id": "REPLACE_ME", "migrations_dir": "migrations" }, { "binding": "LOGS", "database_id": "x" }], "compatibility_flags": ["nodejs_compat", "x"] }', "jsonc-deep", { file: "wrangler.jsonc" });
    expect(r.conflicts).toEqual([]);
    expect(r.text).toContain("// keep me");
    expect(r.text).toContain('"database_id": "real"');
    expect(r.text).toContain('"binding": "LOGS"');
    expect(r.text).toContain('"migrations_dir": "migrations"');
    expect(r.text).toContain('["nodejs_compat", "x"]');
    expect(r.warnings[0]).toMatch(/kept the project's value "real"/);
  });

  it("type changes are conflicts; null removals are conflicts; json-merge-patch keeps project arrays", () => {
    expect(mergeJsonc('{ "vars": [] }', '{ "vars": { "A": "1" } }', "jsonc-deep").conflicts).toHaveLength(1);
    expect(mergeJsonc('{ "a": 1 }', '{ "a": null }', "json-merge-patch").conflicts[0]!.detail).toMatch(/never remove/);
    const r = mergeJsonc('{ "a": [1] }', '{ "a": [2], "b": true }', "json-merge-patch");
    expect(JSON.parse(r.text)).toEqual({ a: [1], b: true });
    expect(mergeJsonc(null, '{ "x": 1 }', "jsonc-deep").text).toBe('{ "x": 1 }\n');
    expect(mergeJsonc("{ not json", '{ "x": 1 }', "jsonc-deep").conflicts).toHaveLength(1);
  });

  it("append-missing-lines matches keys, writes secret names without values, and is idempotent", () => {
    const r = appendMissingLines("A=1\n", "A=2\n# pepper\nTOKEN_PEPPER=shouldnotship\nB=x\n", { secretNames: ["TOKEN_PEPPER"] });
    expect(r.text).toBe("A=1\n# pepper\nTOKEN_PEPPER=\nB=x\n");
    expect(appendMissingLines(r.text, "A=2\nTOKEN_PEPPER=\nB=x\n").changed).toBe(false);
    expect(appendMissingLines("node_modules", "node_modules\n.kit/plans/\n").text).toBe("node_modules\n.kit/plans/\n");
  });
});

describe("profile", () => {
  it("detects the stack of hono-d1-min", async () => {
    const { tree } = loadProject();
    const fs = memoryFs({ ...tree, "pnpm-lock.yaml": "", "tsconfig.json": "{}" });
    const d = await detectStack(fs);
    expect(d.stack).toEqual({ lang: "ts", runtime: "cloudflare-workers", framework: "hono", db: "d1", ui: "none", test: "vitest-workerd" });
    expect(d.paths.migrations).toBe("migrations");
    // new migrations are always UTC timestamps, even next to existing NNNN_ files (they sort first)
    expect(d.migrations).toEqual({ pattern: "TIMESTAMP_name.sql" });
    expect(d.config).toEqual({ wrangler: "wrangler.jsonc", env_example: ".dev.vars.example" });
    expect(d.package_manager).toBe("pnpm");
  });

  it("detects Next.js and timestamp migrations", async () => {
    const fs = memoryFs({
      "package.json": JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" }, devDependencies: { vitest: "4" } }),
      "next.config.ts": "export default {}",
      "app/page.tsx": "",
      "db/migrations/20260514143000_init.sql": "",
    });
    const d = await detectStack(fs);
    expect(d.stack).toMatchObject({ framework: "nextjs", ui: "react", test: "vitest" });
    expect(d.paths.migrations).toBe("db/migrations");
    expect(d.migrations.pattern).toBe("TIMESTAMP_name.sql");
  });

  it("reads, writes and validates .kit/project.json", async () => {
    const { tree, profile } = loadProject();
    const fs = memoryFs({ ...tree });
    expect(await readProfile(fs)).toEqual(profile);
    await writeProfile(fs, profile);
    expect(text(fs.tree[PROFILE_PATH])!.endsWith("}\n")).toBe(true);
    fs.tree[PROFILE_PATH] = JSON.stringify({ ...profile, paths: { lib: "../x" } });
    await expect(readProfile(fs)).rejects.toThrow(/paths/);
    const fresh = await loadOrDetectProfile(memoryFs({ "package.json": "{}" }));
    expect(fresh.detected).toBe(true);
    expect(fresh.profile.project_id).toMatch(/^prj_[a-z2-7]{20}$/);
  });
});

describe("timestamp migrations", () => {
  it("stamps a block's migrations after existing NNNN_ files and the newest timestamp, in increasing seconds", async () => {
    const { renumberMigrations } = await import("../src/plan.ts");
    const profile = { migrations: { pattern: "TIMESTAMP_name.sql" } } as never;
    const out = renumberMigrations(["0001_auth.sql", "0002_auth_tokens.sql"], ["0053_first_picks.sql"], profile, "2026-11-03T01:45:00Z");
    expect(out).toEqual({ "0001_auth.sql": "20261103014500_auth.sql", "0002_auth_tokens.sql": "20261103014501_auth_tokens.sql" });
    expect(["0053_first_picks.sql", ...Object.values(out)].sort()).toEqual(["0053_first_picks.sql", "20261103014500_auth.sql", "20261103014501_auth_tokens.sql"]);
    const later = renumberMigrations(["0001_x.sql"], ["20261103014501_auth_tokens.sql"], profile, "2026-11-03T01:45:00Z");
    expect(later).toEqual({ "0001_x.sql": "20261103014502_x.sql" });
  });
});
