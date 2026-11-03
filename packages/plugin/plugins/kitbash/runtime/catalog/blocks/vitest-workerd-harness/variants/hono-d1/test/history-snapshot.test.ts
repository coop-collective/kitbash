import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { assertPreserved, snapshot, type HistorySnapshot } from "./history-snapshot";

const old: HistorySnapshot = { records: { columns: ["id", "value"], rows: [{ id: 1, value: "saved" }, { id: 1, value: "saved" }] } };
describe("migration preservation guard", () => {
  it("accepts added columns and rows regardless of row order", () => {
    assertPreserved(old, { records: { columns: ["id", "value", "new"], rows: [{ id: 2, value: "new" }, { id: 1, value: "saved", new: null }, { id: 1, value: "saved", new: null }] } });
  });
  it("rejects dropped tables", () => expect(() => assertPreserved(old, {})).toThrow(/removed/));
  it("rejects removed columns", () => expect(() => assertPreserved(old, { records: { columns: ["id"], rows: [{ id: 1 }] } })).toThrow(/removed/));
  it("rejects changed values", () => expect(() => assertPreserved(old, { records: { columns: ["id", "value"], rows: [{ id: 1, value: "lost" }] } })).toThrow(/survive/));
  it("rejects collapsing duplicate rows", () => expect(() => assertPreserved(old, { records: { columns: ["id", "value"], rows: [{ id: 1, value: "saved" }] } })).toThrow(/survive/));
  it("compares blob contents rather than object identity", () => {
    assertPreserved({ blobs: { columns: ["bytes"], rows: [{ bytes: new Uint8Array([1, 2]).buffer }] } }, { blobs: { columns: ["bytes"], rows: [{ bytes: new Uint8Array([1, 2]).buffer }] } });
  });
});

it("snapshots legitimate underscore-prefix matches and prototype-like table names in D1", async () => {
  await env.DB.exec('CREATE TABLE acfx_records (value TEXT); CREATE TABLE "__proto__" (value TEXT);');
  await env.DB.exec("INSERT INTO acfx_records VALUES ('kept'); INSERT INTO \"__proto__\" VALUES ('also kept');");
  const before = await snapshot(env.DB);
  expect(Object.hasOwn(before, "acfx_records")).toBe(true);
  expect(Object.hasOwn(before, "__proto__")).toBe(true);
  expect(before["__proto__"]!.rows).toEqual([{ value: "also kept" }]);
  await env.DB.exec("DROP TABLE acfx_records");
  const after = await snapshot(env.DB);
  expect(() => assertPreserved(before, after)).toThrow(/removed/);
});
