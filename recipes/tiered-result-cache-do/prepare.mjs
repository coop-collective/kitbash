// Render the shipped implementation, so this integration fixture cannot drift into a second cache library.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { renderTemplate } from '@kitbash/core';
const block = new URL('../../blocks/tiered-result-cache/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('block.json', block), 'utf8'));
const source = await readFile(new URL('variants/hono-d1/src/result-cache.ts', block), 'utf8');
const params = Object.fromEntries(manifest.params.map(({ name, default: value }) => [name, value]));
const output = new URL('src/generated/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('result-cache.ts', output), renderTemplate(source, { params }));
