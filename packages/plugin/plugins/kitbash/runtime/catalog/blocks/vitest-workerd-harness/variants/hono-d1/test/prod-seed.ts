// Rows that exist in production when the replay test starts: one INSERT per row, written against the schema as of
// the last migration production has run (`shippedThrough`). Add a row for every table that holds data you cannot lose.
// The default seeds the template's `meta` table and works with the hono-d1 reference project.
export const PROD_SEED: string[] = [
  "INSERT INTO meta (key, value) VALUES ('prod-seed', 'row written before the newer migrations')",
];
