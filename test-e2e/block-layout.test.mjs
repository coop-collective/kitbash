import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const blocks = new URL("../blocks/", import.meta.url);

test("catalog runtime payloads mirror their namespaced project source destinations", async () => {
  for (const entry of await readdir(blocks, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = new URL(`${entry.name}/`, blocks);
    const manifest = JSON.parse(await readFile(new URL("block.json", root), "utf8"));
    const roots = new Map(manifest.variants.map((variant) => [variant.id, variant.root]));
    for (const file of manifest.files) {
      if (!/^\{\{paths\.(lib|routes)\}\}\//.test(file.target)) continue;
      const destination = file.target.replace("{{paths.lib}}", "src/lib").replace("{{paths.routes}}", "src/routes");
      const source = file.path.replace(/^shared\//, "");
      assert.equal(source, destination, `${entry.name}: copying the source tree must preserve ${destination}`);
      assert.match(destination, new RegExp(`^src/(lib|routes)/${entry.name}/`), `${entry.name}: modules must own a namespace`);
      const fileRoot = file.variant ? new URL(`${roots.get(file.variant)}/`, root) : root;
      await access(new URL(file.path, fileRoot));
    }
    for (const exported of manifest.exports) {
      assert.ok(manifest.files.some((file) => file.path === exported.from), `${entry.name}: export ${exported.symbol} must name a declared payload`);
    }
  }
});
