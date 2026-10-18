// Newer migrations applied on top of the production state, with rows in it.
//
// PROD_SIM_DB is a second, empty D1 (vitest.config.ts). It replays the migrations production already ran
// (numbers 1..{{kit.shippedThrough}}), writes the rows in test/prod-seed.ts, then applies the remaining migrations.
// Every seeded row must survive with the values it had, and no foreign key may dangle.
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { PROD_SEED } from "./prod-seed";

const SHIPPED_THROUGH = {{kit.shippedThrough}};
const all = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS;
const num = (m: D1Migration) => Number(/^\d+/.exec(m.name)?.[0] ?? Number.NaN);
type Row = Record<string, unknown>;

async function snapshot(db: D1Database): Promise<Record<string, Row[]>> {
  const tables = (
    await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name").all<{ name: string }>()
  ).results;
  const out: Record<string, Row[]> = {};
  for (const t of tables) out[t.name] = (await db.prepare(`SELECT * FROM "${t.name}"`).all<Row>()).results;
  return out;
}

describe("migrations on top of the production state", () => {
  it("apply cleanly and keep every seeded row intact", async () => {
    const db = (env as unknown as { PROD_SIM_DB: D1Database }).PROD_SIM_DB;
    const shipped = all.filter((m) => num(m) <= SHIPPED_THROUGH);
    expect(shipped.length, "shippedThrough must name at least one migration").toBeGreaterThan(0);
    await applyD1Migrations(db, shipped);
    await db.batch(PROD_SEED.map((sql) => db.prepare(sql)));
    const before = await snapshot(db);

    await applyD1Migrations(db, all);

    const after = await snapshot(db);
    for (const [table, rows] of Object.entries(before)) {
      // a table may be rebuilt or dropped by a later migration; rows only have to survive where the table still exists
      if (!(table in after)) continue;
      for (const row of rows) {
        const kept = after[table]!.some((r) => Object.entries(row).every(([col, v]) => !(col in r) || r[col] === v));
        expect(kept, `${table}: ${JSON.stringify(row)} did not survive`).toBe(true);
      }
    }
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });
});
