import { describe, expect, it } from "vitest";
import { assertPreserved, type HistorySnapshot } from "./history-snapshot";

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
