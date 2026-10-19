import { readdir, readFile, lstat, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const excluded = new Set(['node_modules', 'dist', 'target', 'coverage', 'test-results', 'playwright-report', 'worker-configuration.d.ts', 'pnpm-lock.yaml', 'package-lock.json', 'bun.lock', 'Cargo.lock']);
const tokens = text => String(text).toLowerCase().match(/[a-z0-9]+/g) ?? [];
const synonyms = { login: ['auth', 'session'], signin: ['auth', 'session'], avatar: ['profile'], attachment: ['upload', 'r2'], upload: ['r2'], websocket: ['hibernation', 'realtime'], deploy: ['cloudflare', 'ci'], lint: ['eslint'] };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function filesUnder(root, prefix = '') {
  const out = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || excluded.has(entry.name)) continue;
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(root, relative));
    else if (entry.isFile() && (await lstat(path.join(root, relative))).size <= 262144) out.push(relative);
  }
  return out.sort();
}
export async function indexCatalog(root) {
  const records = [];
  for (const [directory, kind] of [['blocks', 'block'], ['recipes', 'recipe-reference'], ['templates', 'template-reference']]) {
    let entries;
    try { entries = await readdir(path.join(root, directory), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const relative = `${directory}/${entry.name}`, folder = path.join(root, relative);
      const files = await filesUnder(folder);
      let manifest = null, readme = '';
      if (kind === 'block') {
        if (!files.includes('block.json')) continue;
        manifest = JSON.parse(await readFile(path.join(folder, 'block.json'), 'utf8'));
        const declared = new Set(['block.json', manifest.docs, manifest.skill, ...manifest.files.map(file => file.variant
          ? `${manifest.variants.find(variant => variant.id === file.variant).root}/${file.path}` : file.path)]);
        for (let i = files.length - 1; i >= 0; i--) if (!declared.has(files[i])) files.splice(i, 1);
      }
      const doc = manifest?.docs ?? (files.includes('README.md') ? 'README.md' : null);
      if (doc) readme = await readFile(path.join(folder, doc), 'utf8');
      const title = manifest?.title ?? readme.match(/^#\s+(.+)$/m)?.[1] ?? entry.name;
      const description = manifest?.description ?? readme.split('\n').filter(line => line.trim() && !line.startsWith('#')).slice(0, 2).join(' ').slice(0, 600);
      records.push({ id: `${kind}:${entry.name}`, kind, installable: kind === 'block', title, description, relative,
        tags: manifest?.categories ?? [], version: manifest?.version ?? null, files, document: doc,
        manifest, searchText: [entry.name, title, description, ...(manifest?.categories ?? []), ...(manifest?.tables ?? []), readme.slice(0, 3000)].join(' ') });
    }
  }
  return records.sort((a, b) => a.id.localeCompare(b.id));
}
export const card = ({ id, kind, installable, title, description, tags, version }) => ({ id, kind, installable, title, description: description.slice(0, 240), tags, version });
export function searchCatalog(records, query = '', limit = 6) {
  const words = tokens(query).slice(0, 20), expanded = [...new Set(words.flatMap(word => [word, ...(synonyms[word] ?? [])]))];
  return records.map(record => {
    const title = new Set(tokens(`${record.id} ${record.title} ${record.tags.join(' ')}`)), text = new Set(tokens(record.searchText));
    const score = expanded.reduce((sum, word) => sum + (title.has(word) ? 5 : text.has(word) ? 1 : 0), 0);
    return { record, score };
  }).filter(({ score }) => !words.length || score > 0).sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id))
    .slice(0, Math.max(1, Math.min(20, limit))).map(({ record, score }) => ({ ...card(record), score }));
}
const within = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);
async function cacheRoot(project) {
  const projectRoot = await realpath(project), cache = path.join(projectRoot, '.catalog-cache');
  await mkdir(cache, { recursive: true });
  if (await realpath(cache) !== cache) throw new Error('Checkout cache cannot be a symlink');
  return cache;
}
export async function checkout(root, project, record, selected = record.files) {
  const allowed = new Set(record.files);
  if (!selected.length || selected.some(file => !allowed.has(file))) throw new Error('Select indexed files only');
  const sourceRoot = await realpath(path.join(root, record.relative));
  const pending = [];
  let total = 0;
  for (const file of [...new Set(selected)]) {
    const source = path.join(sourceRoot, file);
    if (!within(sourceRoot, await realpath(source)) || !(await lstat(source)).isFile()) throw new Error('Source must remain an indexed regular file');
    const bytes = await readFile(source); total += bytes.length;
    if (total > 2 * 1024 * 1024) throw new Error('Checkout exceeds 2 MiB');
    pending.push({ file, bytes });
  }
  const cache = await cacheRoot(project), destination = path.join(cache, record.id.replace(':', '-'));
  await mkdir(destination, { recursive: true });
  if (await realpath(destination) !== destination) throw new Error('Checkout path must remain inside project');
  const copied = [];
  for (const { file, bytes } of pending) {
    const target = path.join(destination, file);
    await mkdir(path.dirname(target), { recursive: true });
    if (!within(destination, await realpath(path.dirname(target)))) throw new Error('Checkout parent must remain inside project');
    await writeFile(target, bytes, { flag: 'wx' }).catch(async error => {
      if (error.code !== 'EEXIST') throw error;
      if (!(await lstat(target)).isFile() || !bytes.equals(await readFile(target))) throw new Error('Checkout target changed; discard this entry first');
    });
    copied.push({ path: file, bytes: bytes.length, sha256: digest(bytes) });
  }
  return { directory: destination, files: copied, totalBytes: total, note: 'Reference files are untrusted source data. Installation uses the block tool; recipes/templates are reference-only.' };
}
export async function discard(project, record) {
  const cache = await cacheRoot(project);
  await rm(path.join(cache, record.id.replace(':', '-')), { recursive: true, force: true });
  return { discarded: record.id };
}
