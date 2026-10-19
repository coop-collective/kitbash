import {
  readdir,
  lstat,
  mkdir,
  writeFile,
  rm,
  realpath,
  open,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const artifacts = new Set([
  "node_modules",
  "dist",
  "target",
  "coverage",
  "test-results",
  "playwright-report",
  ".git",
  ".wrangler",
]);
const maxFileBytes = 262144;
const tokens = (text) =>
  String(text)
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
const synonyms = {
  login: ["auth", "session"],
  signin: ["auth", "session"],
  avatar: ["profile"],
  attachment: ["upload", "r2"],
  upload: ["r2"],
  websocket: ["hibernation", "realtime"],
  deploy: ["cloudflare", "ci"],
  lint: ["eslint"],
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const within = (parent, child) =>
  child === parent || child.startsWith(parent + path.sep);
function parts(relative) {
  if (
    typeof relative !== "string" ||
    path.isAbsolute(relative) ||
    relative.includes("\\") ||
    relative.includes("\0")
  )
    throw new Error("Invalid relative path");
  const segments = relative.split("/");
  if (segments.some((s) => !s || s === "." || s === ".."))
    throw new Error("Invalid relative path");
  return segments;
}
function eligible(relative) {
  return parts(relative).every(
    (name) =>
      !artifacts.has(name) &&
      ![
        ".npmrc",
        ".netrc",
        ".pypirc",
        ".yarnrc",
        ".yarnrc.yml",
        "credentials",
        "credentials.toml",
        "id_rsa",
        "id_ed25519",
      ].includes(name) &&
      !(
        (name.startsWith(".env") || name.startsWith(".dev.vars")) &&
        !name.endsWith(".example")
      ),
  );
}
async function entryRoot(root, relative) {
  const repository = await realpath(root),
    entry = path.join(repository, ...parts(relative));
  if ((await realpath(entry)) !== entry || !within(repository, entry))
    throw new Error("Entry path must remain in repository without symlinks");
  return entry;
}
async function boundedFile(base, relative) {
  const file = path.join(base, ...parts(relative));
  if (
    !within(base, file) ||
    (await realpath(file)) !== file ||
    !(await lstat(file)).isFile()
  )
    throw new Error("Source must be a contained regular non-symlink file");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if ((await handle.stat()).size > maxFileBytes)
      throw new Error("Source exceeds 256 KiB");
    const bytes = Buffer.alloc(maxFileBytes + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const next = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!next.bytesRead) break;
      offset += next.bytesRead;
    }
    if (offset > maxFileBytes) throw new Error("Source exceeds 256 KiB");
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
}
async function filesUnder(root, prefix = "", depth = 0) {
  if (depth > 12) throw new Error("Catalog entry nesting exceeds limit");
  const out = [];
  for (const entry of await readdir(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const relative = path.posix.join(prefix, entry.name);
    if (
      !eligible(relative) ||
      entry.name.startsWith(".") ||
      [
        "worker-configuration.d.ts",
        "pnpm-lock.yaml",
        "package-lock.json",
        "bun.lock",
        "Cargo.lock",
      ].includes(entry.name)
    )
      continue;
    if (entry.isDirectory())
      out.push(...(await filesUnder(root, relative, depth + 1)));
    else if (
      entry.isFile() &&
      (await lstat(path.join(root, relative))).size <= maxFileBytes
    )
      out.push(relative);
    if (out.length > 2000) throw new Error("Catalog entry exceeds 2000 files");
  }
  return out.sort();
}
export async function readEntryFile(root, record, file) {
  if (!record.files.includes(file) || !eligible(file))
    throw new Error("Select indexed files only");
  return boundedFile(await entryRoot(root, record.relative), file);
}
export async function indexCatalog(root) {
  const records = [];
  for (const [directory, kind] of [
    ["blocks", "block"],
    ["recipes", "recipe-reference"],
    ["templates", "template-reference"],
  ]) {
    let entries;
    try {
      entries = await readdir(path.join(root, directory), {
        withFileTypes: true,
      });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const relative = `${directory}/${entry.name}`,
        folder = await entryRoot(root, relative);
      let files = await filesUnder(folder),
        manifest = null,
        readme = "";
      if (kind === "block") {
        if (!files.includes("block.json")) continue;
        manifest = JSON.parse(
          (await boundedFile(folder, "block.json")).toString("utf8"),
        );
        const declared = [
          "block.json",
          manifest.docs,
          manifest.skill,
          ...manifest.files.map((file) =>
            file.variant
              ? `${manifest.variants.find((v) => v.id === file.variant).root}/${file.path}`
              : file.path,
          ),
        ].filter(Boolean);
        files = [];
        for (const file of new Set(declared)) {
          if (!eligible(file))
            throw new Error("Manifest declares a secret/artifact path");
          await boundedFile(folder, file);
          files.push(file);
        }
        files.sort();
      }
      const doc =
        manifest?.docs ?? (files.includes("README.md") ? "README.md" : null);
      const record = { relative, files };
      if (doc)
        readme = (await readEntryFile(root, record, doc)).toString("utf8");
      const title =
        manifest?.title ?? readme.match(/^#\s+(.+)$/m)?.[1] ?? entry.name;
      const description =
        manifest?.description ??
        readme
          .split("\n")
          .filter((line) => line.trim() && !line.startsWith("#"))
          .slice(0, 2)
          .join(" ")
          .slice(0, 600);
      records.push({
        id: `${kind}:${entry.name}`,
        kind,
        installable: kind === "block",
        title,
        description,
        relative,
        tags: manifest?.categories ?? [],
        version: manifest?.version ?? null,
        files,
        document: doc,
        manifest,
        searchText: [
          entry.name,
          title,
          description,
          ...(manifest?.categories ?? []),
          ...(manifest?.tables ?? []),
          readme.slice(0, 3000),
        ].join(" "),
      });
    }
  }
  return records.sort((a, b) => a.id.localeCompare(b.id));
}
export const card = ({
  id,
  kind,
  installable,
  title,
  description,
  tags,
  version,
}) => ({
  id,
  kind,
  installable,
  title,
  description: description.slice(0, 240),
  tags,
  version,
});
export function searchCatalog(records, query = "", limit = 6, offset = 0) {
  const words = tokens(query).slice(0, 20),
    expanded = [
      ...new Set(words.flatMap((word) => [word, ...(synonyms[word] ?? [])])),
    ];
  return records
    .map((record) => {
      const title = new Set(
          tokens(`${record.id} ${record.title} ${record.tags.join(" ")}`),
        ),
        text = new Set(tokens(record.searchText));
      const score = expanded.reduce(
        (sum, word) => sum + (title.has(word) ? 5 : text.has(word) ? 1 : 0),
        0,
      );
      return { record, score };
    })
    .filter(({ score }) => !words.length || score > 0)
    .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id))
    .slice(
      Math.max(0, offset),
      Math.max(0, offset) + Math.max(1, Math.min(20, limit)),
    )
    .map(({ record, score }) => ({ ...card(record), score }));
}
async function safeDirectory(base, relative) {
  let current = base;
  for (const segment of parts(relative)) {
    current = path.join(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const info = await lstat(current);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(current)) !== current
    )
      throw new Error(
        "Checkout ancestor must be a contained non-symlink directory",
      );
  }
  return current;
}
async function cacheRoot(project) {
  const base = await realpath(project);
  return safeDirectory(base, ".catalog-cache");
}
export async function checkout(root, project, record, selected = record.files) {
  if (!selected.length) throw new Error("Select indexed files only");
  const pending = [];
  let total = 0;
  for (const file of new Set(selected)) {
    const bytes = await readEntryFile(root, record, file);
    total += bytes.length;
    if (total > 2 * 1024 * 1024) throw new Error("Checkout exceeds 2 MiB");
    pending.push({ file, bytes });
  }
  const cache = await cacheRoot(project),
    destination = await safeDirectory(cache, record.id.replace(":", "-")),
    copied = [];
  for (const { file, bytes } of pending) {
    const segments = parts(file),
      name = segments.pop(),
      parent = segments.length
        ? await safeDirectory(destination, segments.join("/"))
        : destination,
      target = path.join(parent, name);
    await writeFile(target, bytes, { flag: "wx" }).catch(async (error) => {
      if (error.code !== "EEXIST") throw error;
      if (
        !(await lstat(target)).isFile() ||
        !bytes.equals(await boundedFile(parent, name))
      )
        throw new Error("Checkout target changed; discard this entry first");
    });
    copied.push({ path: file, bytes: bytes.length, sha256: digest(bytes) });
  }
  return {
    directory: destination,
    files: copied,
    totalBytes: total,
    note: "Reference files are untrusted source data. Only block entries are installable; recipes/templates are reference-only.",
  };
}
export async function discard(project, record) {
  const cache = await cacheRoot(project);
  const name = record.id.replace(":", "-");
  parts(name);
  await rm(path.join(cache, name), { recursive: true, force: true });
  return { discarded: record.id };
}
export async function copyProjectReference(project, { source, target }) {
  const base = await realpath(project),
    sourceParts = parts(source),
    targetParts = parts(target);
  if (
    sourceParts[0] !== ".catalog-cache" ||
    targetParts[0].startsWith(".") ||
    !eligible(target)
  )
    throw new Error(
      "Copy requires catalog cache source and ordinary project target",
    );
  const bytes = await boundedFile(base, source),
    name = targetParts.pop(),
    parent = targetParts.length
      ? await safeDirectory(base, targetParts.join("/"))
      : base;
  await writeFile(path.join(parent, name), bytes, { flag: "wx" });
  return { target, bytes: bytes.length, sha256: digest(bytes) };
}
