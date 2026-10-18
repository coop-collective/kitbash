#!/usr/bin/env node
// Emits schema/block.v1.json (the block.json manifest) and schema/contract.v1.json (the registry_* tool contract)
// from the zod schemas in src/. `--check` fails when the committed files are out of date (used by `pnpm validate`).
// Requires Node >= 22.18 (type stripping) since it imports the TypeScript sources directly.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ManifestSchema, SCHEMA_URL } from "../src/schema.ts";
import { CONTRACT_DEFS } from "../src/contract.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "schema");
const check = process.argv.includes("--check");

function strip(s) {
  const { $schema: _s, $id: _i, ...rest } = s;
  return rest;
}

const block = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: SCHEMA_URL,
  title: "Kitbash block manifest (block.json) v1",
  ...strip(z.toJSONSchema(ManifestSchema, { io: "input", unrepresentable: "any" })),
};

const reg = z.registry();
for (const [id, schema] of Object.entries(CONTRACT_DEFS)) reg.add(schema, { id });
const out = z.toJSONSchema(reg, { uri: (id) => `#/$defs/${id}`, io: "input", unrepresentable: "any" });
const defs = {};
for (const id of Object.keys(CONTRACT_DEFS)) defs[id] = strip(out.schemas[id]);
// shapes zod pulled out as shared sub-schemas without an id land under __shared
if (out.schemas.__shared) Object.assign(defs, Object.fromEntries(Object.entries(out.schemas.__shared.$defs ?? {}).map(([k, v]) => [k, v])));
const contract = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://kitbash.dev/schema/contract.v1.json",
  title: "Kitbash registry_* tool contract v1",
  description:
    "One $defs entry per tool input/output (registry_<tool>_input|_output) plus shared shapes. Author-written prose only ever appears inside untrusted_author_text (or the length-capped Card.summary).",
  $defs: defs,
};

const files = { "block.v1.json": block, "contract.v1.json": contract };
let stale = false;
mkdirSync(outDir, { recursive: true });
for (const [name, json] of Object.entries(files)) {
  const text = `${JSON.stringify(json, null, 2)}\n`;
  const p = join(outDir, name);
  if (check) {
    let cur = "";
    try {
      cur = readFileSync(p, "utf8");
    } catch {}
    if (cur !== text) {
      console.error(`schema/${name} is out of date; run pnpm -F core gen-schema`);
      stale = true;
    }
  } else {
    writeFileSync(p, text);
    console.log(`wrote schema/${name}`);
  }
}
if (stale) process.exit(1);
