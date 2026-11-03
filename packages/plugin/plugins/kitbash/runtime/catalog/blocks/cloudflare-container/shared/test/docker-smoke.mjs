// Explicit opt-in host test: builds an amd64 image and starts only a localhost container.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 }).trim();
test('image hashes under non-root/read-only/capability limits and cleans bounded RAM scratch', { timeout: 900_000 }, async () => {
  const image = 'kit-{{kit.serviceName}}-smoke';
  const name = `kit-{{kit.serviceName}}-${randomUUID()}`;
  docker('build', '--platform', 'linux/amd64', '-t', image, 'containers/{{kit.serviceName}}');
  const user = docker('image', 'inspect', image, '--format', '{{.Config.User}}');
  assert.match(user, /^[1-9][0-9]*:[1-9][0-9]*$/);
  const [uid, gid] = user.split(':');
  try {
    docker('run', '-d', '--platform', 'linux/amd64', '--name', name, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=256m', '--cpus=1', '--pids-limit=64', '--tmpfs', `/app-tmp:rw,noexec,nosuid,size=8388608,uid=${uid},gid=${gid},mode=700`, '-e', 'TMPDIR=/app-tmp', '-p', '127.0.0.1::8080', image);
    const port = docker('port', name, '8080/tcp').split(':').at(-1);
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { const response = await fetch(`${base}/health`); if (response.ok) { assert.equal((await response.json()).scratchMemoryBacked, true); ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, docker('logs', name));
    const response = await fetch(`${base}/hash`, { method: 'POST', body: 'hello' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { bytes: 5, sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' });
    let rejected = false;
    try { rejected = !(await fetch(`${base}/hash`, { method: 'POST', body: new Uint8Array(1_048_577) })).ok; } catch { rejected = true; }
    assert.ok(rejected, 'actual oversize body must fail');
    for (let i = 0; i < 100 && docker('exec', name, 'sh', '-c', 'ls -A /app-tmp'); i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(docker('exec', name, 'sh', '-c', 'ls -A /app-tmp'), '');
    assert.throws(() => docker('exec', name, 'sh', '-c', 'touch /app/forbidden'));
    assert.equal(docker('exec', name, 'id', '-u'), uid);
    docker('stop', '-t', '12', name);
    assert.equal(docker('inspect', name, '--format', '{{.State.ExitCode}}'), '0');
  } finally { try { docker('rm', '-f', name); } catch {} }
});
