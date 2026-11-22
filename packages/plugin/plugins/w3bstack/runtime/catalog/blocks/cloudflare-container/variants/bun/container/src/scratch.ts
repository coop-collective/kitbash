import { access, lstat, mkdtemp, rm, statfs } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
export async function scratchRoot(candidates = [process.env.TMPDIR, '/dev/shm', '/app-tmp', '/tmp'].filter((x): x is string => Boolean(x))) {
  for (const root of candidates) {
    try {
      const info = await lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink()) continue;
      await access(root, constants.W_OK | constants.X_OK);
      const fs = await statfs(root);
      return { path: root, memoryBacked: Number(fs.type) === 0x01021994 };
    } catch { /* Use another writable location without escalating privileges. */ }
  }
  throw new Error('No writable scratch directory');
}
export async function withScratch<T>(root: string, task: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(root, 'job-'));
  try { return await task(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
