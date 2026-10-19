// Optional local Linux boundary test. Build kit-container-gateway:test before running.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const id = docker('run', '-d', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
  '--memory=128m', '--tmpfs', '/tmp:rw,noexec,nosuid,size=8m,mode=1777',
  '-e', 'TMPDIR=/tmp', '-p', '127.0.0.1::8080', 'kit-container-gateway:test');
try {
  const binding = docker('port', id, '8080/tcp');
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const origin = `http://${binding}`;
  let ready = false;
  for (let n = 0; n < 50; n++) {
    try { ready = (await fetch(`${origin}/health`)).ok; } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, 'container became healthy');
  const response = await fetch(`${origin}/hash`, { method: 'POST', body: 'container smoke' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { bytes: 15, sha256: createHash('sha256').update('container smoke').digest('hex') });
  docker('exec', id, 'node', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { access, readdir, stat, statfs } from 'node:fs/promises';
    import { constants } from 'node:fs';
    assert.notEqual(process.getuid(), 0);
    assert.equal((await stat('/app/server.mjs')).uid, 0);
    await assert.rejects(access('/app/server.mjs', constants.W_OK));
    assert.equal(Number((await statfs('/tmp')).type), 0x01021994);
    assert.deepEqual(await readdir('/tmp'), []);
  `);
  console.log('Docker smoke passed: non-root, immutable app, tmpfs scratch, HTTP digest, cleanup');
} finally { docker('rm', '-f', id); }
