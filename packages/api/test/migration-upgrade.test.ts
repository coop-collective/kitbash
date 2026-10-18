// Migration replay scaffold (Ideator's migration-upgrade pattern, DESIGN §5.7). PROD_SIM_DB is a second, empty D1
// (vitest.config.ts). Today: 0001 (kit-api), 0002_auth (email-code-auth, installed from the registry), 0003
// (members.default_org_id). They apply cleanly to an empty database and the FTS triggers keep block_search in step.
// Once a version has shipped, apply the shipped prefix here, insert realistic rows, apply the rest and assert every
// row survived.
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { E } from "./helpers";

const all = (E as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS;

describe("migrations", () => {
  it("are numbered NNNN_name.sql in order and apply to an empty database", async () => {
    expect(all.map((m) => m.name)[0]).toBe("0001_schema.sql");
    all.forEach((m, i) => expect(m.name).toMatch(new RegExp(`^${String(i + 1).padStart(4, "0")}_[a-z0-9_]+\\.sql$`)));
    const db = E.PROD_SIM_DB;
    await applyD1Migrations(db, all);
    const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger') ORDER BY name").all<{ name: string }>();
    const names = results.map((r) => r.name);
    for (const t of ["orgs", "members", "org_members", "member_tokens", "publisher_keys", "blocks", "block_versions", "block_files", "block_tags", "block_search", "projects", "installs", "proposals", "events"]) {
      expect(names).toContain(t);
    }
    expect(names).toContain("block_versions_search_insert");
  });

  it("keeps block_search in step with block_versions (insert, update, delete)", async () => {
    const db = E.PROD_SIM_DB;
    await applyD1Migrations(db, all);
    const t = "2026-10-18T00:00:00Z";
    await db.batch([
      db.prepare("INSERT INTO orgs (id, slug, name, created_at) VALUES ('org_m', 'mig', 'mig', ?)").bind(t),
      db.prepare("INSERT INTO blocks (id, org_id, name, license, created_at) VALUES ('blk_m', 'org_m', 'thing', 'MIT', ?)").bind(t),
      db.prepare(
        `INSERT INTO block_versions (id, block_id, version, manifest_json, manifest_sha256, publisher_sig, registry_sig, size_json, cards_json, published_at, title, description, categories)
         VALUES ('ver_m', 'blk_m', '1.0.0', '{}', 'x', 's', 'r', '{}', '{}', ?, 'Quokka uploads', 'Stores files in R2', 'storage')`,
      ).bind(t),
    ]);
    const hit = (q: string) => db.prepare("SELECT version_id FROM block_search WHERE block_search MATCH ?").bind(q).all<{ version_id: string }>();
    expect((await hit("quokka")).results).toEqual([{ version_id: "ver_m" }]);
    await db.prepare("UPDATE block_versions SET title = 'Wombat uploads' WHERE id = 'ver_m'").run();
    expect((await hit("quokka")).results).toEqual([]);
    expect((await hit("wombat")).results).toEqual([{ version_id: "ver_m" }]);
    await db.prepare("DELETE FROM block_versions WHERE id = 'ver_m'").run();
    expect((await hit("wombat")).results).toEqual([]);
  });
});
