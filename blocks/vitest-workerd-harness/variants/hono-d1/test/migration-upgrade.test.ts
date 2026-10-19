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
import { snapshot, assertPreserved } from "./history-snapshot";

describe("migrations on top of the production state", () => {
  it("apply cleanly and keep every seeded row intact", async () => {
    const db = (env as unknown as { PROD_SIM_DB: D1Database }).PROD_SIM_DB;
    const shipped = all.filter((m) => num(m) <= SHIPPED_THROUGH);
    expect(all.every((m) => Number.isSafeInteger(num(m))), "migration names need numeric prefixes").toBe(true);
    expect(shipped.some((m) => num(m) === SHIPPED_THROUGH), "shippedThrough must name an existing migration").toBe(true);
    await applyD1Migrations(db, shipped);
    expect(PROD_SEED.length, "replay needs production-shaped seed rows").toBeGreaterThan(0);
    await db.batch(PROD_SEED.map((sql) => db.prepare(sql)));
    const before = await snapshot(db);

    await applyD1Migrations(db, all);

    const after = await snapshot(db);
    assertPreserved(before, after);
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    await applyD1Migrations(db, all);
    const rerun = await snapshot(db);
    assertPreserved(after, rerun);
    assertPreserved(rerun, after);
  });
});
