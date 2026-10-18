// registry_search (DESIGN §6.3, MVP): D1 FTS5 over each block's `latest` version, scoped to what the caller may
// see, ranked by bm25 plus a stack boost. Cards are precomputed at publish (one per variant, sized for a two-decimal
// score), so a search is one query plus JSON parsing.
import type { CardT } from "@kitbash/core";
import { z } from "zod";
import type { Bindings, Caller } from "./types";

export const SearchQuery = z.strictObject({
  q: z.string().min(1).max(500),
  runtime: z.string().max(64).optional(),
  framework: z.string().max(64).optional(),
  db: z.string().max(64).optional(),
  ui: z.string().max(64).optional(),
  tags: z.array(z.string().max(64)).max(10).optional(),
  scope: z.enum(["private", "public", "all"]).default("all"),
  limit: z.number().int().min(1).max(20).default(10),
});
export type SearchQueryT = z.infer<typeof SearchQuery>;

/** Words of the query as an FTS5 expression: each word quoted with a prefix star, any word may match. */
export function ftsQuery(q: string): string | null {
  const words = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 20);
  if (!words.length) return null;
  return [...new Set(words)].map((w) => `"${w}"*`).join(" OR ");
}

interface Row {
  version_id: string;
  cards_json: string;
  categories: string;
  rank: number;
}

export async function search(env: Bindings, caller: Caller, q: SearchQueryT): Promise<{ results: CardT[] }> {
  const match = ftsQuery(q.q);
  if (!match) return { results: [] };
  const vis = q.scope === "all" ? "" : q.scope === "public" ? "AND b.visibility = 'public'" : "AND b.visibility = 'private'";
  // bm25 column weights: version_id (unindexed), title, description, categories, tables, routes, stack
  const { results } = await env.DB.prepare(
    `SELECT bv.id AS version_id, bv.cards_json, bv.categories, bm25(block_search, 0.0, 10.0, 3.0, 4.0, 2.0, 2.0, 1.0) AS rank
       FROM block_search
       JOIN block_versions bv ON bv.id = block_search.version_id
       JOIN blocks b ON b.id = bv.block_id
      WHERE block_search MATCH ?1
        AND bv.status = 'active' AND b.yanked_at IS NULL
        AND (b.visibility = 'public' OR b.org_id IN (SELECT org_id FROM org_members WHERE member_id = ?2))
        ${vis}
        AND bv.id = COALESCE(
              (SELECT t.version_id FROM block_tags t WHERE t.block_id = b.id AND t.tag = 'latest'),
              (SELECT v2.id FROM block_versions v2 WHERE v2.block_id = b.id AND v2.status = 'active' ORDER BY v2.published_at DESC LIMIT 1))
      ORDER BY rank
      LIMIT 200`,
  )
    .bind(match, caller.member.id)
    .all<Row>();

  const wanted = (["runtime", "framework", "db", "ui"] as const).map((k) => q[k]?.toLowerCase()).filter((x): x is string => !!x);
  const tags = (q.tags ?? []).map((t) => t.toLowerCase());
  const best = Math.max(1e-9, ...results.map((r) => -r.rank));
  const scored: CardT[] = [];
  for (const r of results) {
    if (tags.length) {
      const cats = new Set(r.categories.split(" ").filter(Boolean));
      if (!tags.every((t) => cats.has(t))) continue;
    }
    const cards = Object.values(JSON.parse(r.cards_json) as Record<string, CardT>);
    // the variant that matches the requested stack best (ties: the first, i.e. the manifest order)
    let card = cards[0]!;
    let stackScore = 0;
    for (const c of cards) {
      const have = new Set(c.stack.map((s) => s.toLowerCase()));
      const s = wanted.length ? wanted.filter((w) => have.has(w)).length / wanted.length : 0;
      if (s > stackScore) {
        stackScore = s;
        card = c;
      }
    }
    const text = Math.max(0, -r.rank) / best;
    const score = wanted.length ? 0.6 * text + 0.4 * stackScore : text;
    scored.push({ ...card, score: Math.round(Math.max(0, Math.min(1, score)) * 100) / 100 });
  }
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { results: scored.slice(0, q.limit) };
}
