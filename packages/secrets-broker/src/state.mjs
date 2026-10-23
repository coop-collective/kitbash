import { closeSync, existsSync, lstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, fsyncSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fail } from './errors.mjs';

/** Single broker process per private state file. Refuse a stale lock; operator reconciles it. */
export function openState(filename) {
  const file = path.resolve(filename);
  const parent = lstatSync(path.dirname(file));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077)) fail('unavailable');
  if (existsSync(file)) {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077)) fail('unavailable');
  }
  const lock = `${file}.lock`;
  let descriptor;
  try { descriptor = openSync(lock, 'wx', 0o600); } catch { fail('conflict'); }
  let data;
  try {
    data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, entries: {} };
    if (data?.version !== 1 || !data.entries || typeof data.entries !== 'object' || Array.isArray(data.entries)) fail('conflict');
  } catch {
    closeSync(descriptor); rmSync(lock); fail('conflict');
  }
  const save = async () => {
    const temporary = `${file}.${randomUUID()}.tmp`;
    let fd;
    try {
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, `${JSON.stringify(data)}\n`);
      fsyncSync(fd);
      closeSync(fd); fd = undefined;
      renameSync(temporary, file);
      const directory = openSync(path.dirname(file), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    } finally {
      if (fd !== undefined) closeSync(fd);
      rmSync(temporary, { force: true });
    }
  };
  return { data, save, close: () => { closeSync(descriptor); rmSync(lock, { force: true }); } };
}
