/** Unified diffs for plans and `kit diff`. */
import { createTwoFilesPatch, structuredPatch } from "diff";

/** A unified diff of one file. `null` before = created, `null` after = deleted. Binary content is summarized. */
export function unifiedDiff(path: string, before: string | null, after: string | null, opts: { context?: number; note?: string } = {}): string {
  const header = opts.note ? `# ${opts.note}\n` : "";
  if ((before !== null && before.includes("\u0000")) || (after !== null && after.includes("\u0000"))) {
    return `${header}Binary files ${before === null ? "/dev/null" : `a/${path}`} and ${after === null ? "/dev/null" : `b/${path}`} differ\n`;
  }
  const patch = createTwoFilesPatch(
    before === null ? "/dev/null" : `a/${path}`,
    after === null ? "/dev/null" : `b/${path}`,
    before ?? "",
    after ?? "",
    undefined,
    undefined,
    { context: opts.context ?? 3 },
  );
  // drop the "Index:" / "====" preamble lines some versions emit; keep from the first "---"
  const i = patch.indexOf("--- ");
  return header + (i > 0 ? patch.slice(i) : patch);
}

export function hunkCount(before: string, after: string, context = 3): number {
  return structuredPatch("a", "b", before, after, undefined, undefined, { context }).hunks.length;
}
