import { access, lstat, mkdtemp, rm, statfs } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
/** /tmp is a location, not a promise of RAM backing. Confirm using statfs. */
export async function scratchRoot(candidates = [process.env.TMPDIR, '/dev/shm', '/app-tmp', '/tmp'].filter(Boolean)) {
  for (const root of candidates) {
    try {
      const info = await lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink()) continue;
      await access(root, constants.W_OK | constants.X_OK);
      const fs = await statfs(root);
      return { path: root, memoryBacked: Number(fs.type) === 0x01021994 };
    } catch { /* Try the next writable location without changing privileges. */ }
  }
  throw new Error('No writable scratch directory');
}
export async function withScratch(root, task) {
  const directory = await mkdtemp(join(root, 'job-'));
  try { return await task(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
