import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readBlockDir } from '@kitbash/core/node';
import { validateBlock } from '@kitbash/core';

const root = new URL('../blocks/', import.meta.url);
const entries = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
for (const entry of entries) {
  const result = await validateBlock(await readBlockDir(fileURLToPath(new URL(`${entry.name}/`, root))));
  const blocked = result.findings.filter(finding => finding.severity === 'block');
  const warnings = result.findings.filter(finding => finding.severity === 'warn');
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${entry.name}: ${blocked.length} blocking, ${warnings.length} warnings`);
  for (const finding of result.findings) console.log(`  ${finding.severity}: ${finding.path}: ${finding.rule}: ${finding.detail}`);
  if (!result.ok) process.exitCode = 1;
}
