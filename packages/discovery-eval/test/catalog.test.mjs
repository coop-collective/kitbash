import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { indexCatalog, searchCatalog, checkout, discard } from "../catalog.mjs";

test("browse, reference labeling, selective bounded materialization, symlink isolation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "catalog-test-"));
  try {
    const recipe = path.join(root, "recipes/auth-session");
    await mkdir(path.join(recipe, "node_modules"), { recursive: true });
    await writeFile(
      path.join(recipe, "README.md"),
      "# Auth session\n\nRevocable browser login.",
    );
    await writeFile(path.join(recipe, ".dev.vars"), "PRIVATE=yes");
    await writeFile(path.join(recipe, "node_modules/secret"), "excluded");
    await symlink("/etc/hosts", path.join(recipe, "linked"));
    const records = await indexCatalog(root);
    assert.equal(records.length, 1);
    assert.equal(records[0].installable, false);
    assert.deepEqual(records[0].files, ["README.md"]);
    assert.equal(searchCatalog(records).length, 1);
    assert.equal(
      searchCatalog(records, "signin")[0].id,
      "recipe-reference:auth-session",
    );
    const project = path.join(root, "app");
    await mkdir(project);
    await assert.rejects(
      checkout(root, project, records[0], ["../outside"]),
      /indexed/,
    );
    const result = await checkout(root, project, records[0]);
    assert.equal(result.totalBytes, 40);
    assert.equal(
      await readFile(path.join(result.directory, "README.md"), "utf8"),
      "# Auth session\n\nRevocable browser login.",
    );
    await checkout(root, project, records[0]);
    await writeFile(path.join(result.directory, "README.md"), "changed");
    await assert.rejects(checkout(root, project, records[0]), /changed/);
    await discard(project, records[0]);
    await rm(path.join(project, ".catalog-cache"), { recursive: true });
    await symlink(recipe, path.join(project, ".catalog-cache"));
    await assert.rejects(checkout(root, project, records[0]), /symlink/);
    await assert.rejects(discard(project, records[0]), /symlink/);
    assert.equal(
      (await readFile(path.join(recipe, "README.md"), "utf8")).startsWith("#"),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manifest documents cannot escape, expose private files, or follow symlinks; declared lock/config files remain available", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "catalog-docs-"));
  try {
    const folder = path.join(root, "blocks/example");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(root, "outside.txt"), "private content");
    await writeFile(path.join(folder, "README.md"), "# Example");
    await writeFile(path.join(folder, "Cargo.lock"), "locked dependencies");
    await writeFile(path.join(folder, ".dockerignore"), "node_modules");
    await writeFile(path.join(folder, ".dev.vars"), "PRIVATE=fixture");
    const manifest = {
      name: "example",
      docs: "README.md",
      files: [{ path: "Cargo.lock" }, { path: ".dockerignore" }],
      variants: [],
    };
    const put = (doc) =>
      writeFile(
        path.join(folder, "block.json"),
        JSON.stringify({ ...manifest, docs: doc }),
      );
    await put("README.md");
    const records = await indexCatalog(root);
    assert.ok(records[0].files.includes("Cargo.lock"));
    assert.ok(records[0].files.includes(".dockerignore"));
    for (const doc of [
      "../../outside.txt",
      ".dev.vars",
      ".dev.vars.production",
      ".npmrc",
    ]) {
      await put(doc);
      await assert.rejects(indexCatalog(root));
    }
    await symlink(
      path.join(root, "outside.txt"),
      path.join(folder, "linked.md"),
    );
    await put("linked.md");
    await assert.rejects(indexCatalog(root), /non-symlink/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("nested checkout symlink is rejected before any outside directory is created", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "catalog-nested-"));
  try {
    const recipe = path.join(root, "recipes/example");
    await mkdir(path.join(recipe, "deep/new"), { recursive: true });
    await writeFile(path.join(recipe, "deep/new/file.txt"), "source");
    const [record] = await indexCatalog(root);
    const project = path.join(root, "project"),
      outside = path.join(root, "outside");
    await mkdir(outside);
    const target = path.join(
      project,
      ".catalog-cache",
      record.id.replace(":", "-"),
    );
    await mkdir(target, { recursive: true });
    await symlink(outside, path.join(target, "deep"));
    await assert.rejects(checkout(root, project, record), /non-symlink/);
    await assert.rejects(
      readFile(path.join(outside, "new/file.txt")),
      /ENOENT/,
    );
    assert.deepEqual(
      await (await import("node:fs/promises")).readdir(outside),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
