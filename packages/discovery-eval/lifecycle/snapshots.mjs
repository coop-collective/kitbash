import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const ignored = new Set(['node_modules', '.git', '.wrangler', 'dist', 'coverage', '.catalog-cache', '.kit-home', '.kit', 'worker-configuration.d.ts', '.dev.vars', '__lifecycle_owner.txt', 'TASK.md']);
export async function sourceFiles(root, prefix = '') {
  const files = [];
  for (const item of (await readdir(path.join(root, prefix), { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (ignored.has(item.name) || item.name.startsWith('.env') || item.name.startsWith('.claude')) continue;
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isSymbolicLink()) throw new Error(`Source symlink refused: ${relative}`);
    if (item.isDirectory()) files.push(...await sourceFiles(root, relative));
    else if (item.isFile()) {
      const body = await readFile(path.join(root, relative));
      if (body.length > 2 * 1024 * 1024) throw new Error(`Oversized source: ${relative}`);
      files.push({path: relative, sha256: sha256(body), bytes: body.length});
    }
  }
  return files;
}
export async function snapshotApp(project, blobRoot) {
  const files = await sourceFiles(project);
  await mkdir(blobRoot, {recursive:true});
  for (const file of files) {
    try { await writeFile(path.join(blobRoot, file.sha256), await readFile(path.join(project,file.path)), {flag:'wx'}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  return {sha256: sha256(JSON.stringify(files)), files};
}
export async function restoreApp(manifest, blobRoot, destination) {
  await mkdir(destination, {recursive:false});
  for (const file of manifest.files) {
    if (path.isAbsolute(file.path) || file.path.split(/[\\/]/).some(p => p === '..' || p === '.' || !p) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Unsafe snapshot path');
    const body = await readFile(path.join(blobRoot,file.sha256));
    if (sha256(body) !== file.sha256) throw new Error('Snapshot hash mismatch');
    const target = path.join(destination,file.path);
    await mkdir(path.dirname(target),{recursive:true});
    await writeFile(target,body,{flag:'wx'});
  }
  await writeFile(path.join(destination,'.dev.vars'), 'SESSION_SECRET=local-only-session-secret-at-least-32-characters\nDEMO_PASSWORD=local-demo-password\n',{flag:'wx'});
}
export function totals(attempts) {
  const complete = attempts.every(a => a.agent?.resultPresent && Number.isFinite(a.agent.costUsd));
  return {attempts: attempts.length, billingComplete: complete, knownCostUsd: attempts.reduce((s,a)=>s+(Number.isFinite(a.agent?.costUsd)?a.agent.costUsd:0),0), costUsd: complete ? attempts.reduce((s,a)=>s+a.agent.costUsd,0) : null, agentWallMs: attempts.reduce((s,a)=>s+(a.agent?.wallMs??0),0), validationWallMs: attempts.reduce((s,a)=>s+(a.validationWallMs??0),0)};
}
