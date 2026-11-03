import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

function tests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) return tests(name);
    return entry.isFile() && /\.test\.[mc]js$/.test(name) ? [name] : [];
  });
}

const files = tests('test').sort();
if (files.length) {
  const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
