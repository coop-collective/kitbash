import { expect } from "vitest";

type Row = Record<string, unknown>;
export type HistorySnapshot = Record<string, { columns: string[]; rows: Row[] }>;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const rowKey = (row: Row, columns: string[]) => JSON.stringify(columns.map((column) => {
  const value = row[column];
  return value instanceof ArrayBuffer ? [...new Uint8Array(value)] : value;
}));

export async function snapshot(db: D1Database): Promise<HistorySnapshot> {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name != 'd1_migrations' ORDER BY name").all<{ name: string }>()).results;
  const result: HistorySnapshot = Object.create(null);
  for (const { name } of tables) {
    const columns = (await db.prepare(`PRAGMA table_info(${quote(name)})`).all<{ name: string }>()).results.map((column) => column.name);
    result[name] = { columns, rows: (await db.prepare(`SELECT * FROM ${quote(name)}`).all<Row>()).results };
  }
  return result;
}

// New tables, columns and rows are allowed. Every old table, column and row occurrence must remain.
export function assertPreserved(before: HistorySnapshot, after: HistorySnapshot): void {
  for (const [table, original] of Object.entries(before)) {
    expect(Object.hasOwn(after, table), `table ${table} was removed`).toBe(true);
    const current = after[table]!;
    for (const column of original.columns) expect(current.columns, `${table}.${column} was removed`).toContain(column);
    const counts = new Map<string, number>();
    for (const row of current.rows) {
      const key = rowKey(row, original.columns);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const row of original.rows) {
      const key = rowKey(row, original.columns);
      const count = counts.get(key) ?? 0;
      expect(count, `${table}: ${key} did not survive`).toBeGreaterThan(0);
      counts.set(key, count - 1);
    }
  }
}
