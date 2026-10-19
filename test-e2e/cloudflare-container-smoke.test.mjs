import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { installStandalone } from './pnpm-install.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const variants = (process.env.KIT_CONTAINER_VARIANTS ?? 'bun,go,rust').split(',');
assert.ok(variants.length && variants.every(v => ['bun', 'go', 'rust'].includes(v)), 'invalid KIT_CONTAINER_VARIANTS');
function run(command, args, cwd) {
  const env = { ...process.env, KIT_KEYCHAIN: '0', WRANGLER_SEND_METRICS: 'false' };
  // Nested Node test runners otherwise inherit the parent's internal child protocol and may run zero tests.
  delete env.NODE_TEST_CONTEXT;
  return new Promise((resolve, reject) => execFile(command, args, { cwd, timeout: 900_000, maxBuffer: 32*1024*1024, env }, (error, stdout, stderr) => error ? reject(new Error(`${command} ${args.join(' ')}\n${stdout}\n${stderr}`, { cause: error })) : resolve(stdout)));
}
for (const variant of variants) test(`installed ${variant} Cloudflare container image and rights`, { timeout: 950_000 }, async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'kit-container-smoke-'));
  try {
    await mkdir(path.join(project, '.kit'), { recursive: true });
    await writeFile(path.join(project, '.kit/project.json'), await readFile(path.join(repo, 'test-e2e/fixtures/hono-d1/.kit/project.json')));
    await writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'kit-container-host', private: true, type: 'module', packageManager: 'pnpm@12.14.0', devDependencies: { wrangler: '4.151.1', typescript: '5.9.3', '@types/node': '24.10.1' } }));
    await writeFile(path.join(project, 'pnpm-workspace.yaml'), 'packages:\n  - .\nallowBuilds:\n  esbuild: true\n  workerd: true\n');
    await run('node', [path.join(repo, 'packages/cli/src/kit.ts'), 'install', path.join(repo, 'blocks/cloudflare-container'), '--variant', variant, '--param', `serviceName=hash-${variant}`, '--apply'], project);
    await installStandalone(async (command, args, { cwd }) => {
      try { return { code: 0, out: await run(command, args, cwd), err: '' }; }
      catch (error) { return { code: 1, out: '', err: error.message }; }
    }, { cwd: project });
    const config = `container.hash-${variant}.wrangler.jsonc`;
    await run('pnpm', ['exec', 'wrangler', 'types', '-c', config, 'container.d.ts', '--env-interface', 'ContainerBindings'], project);
    await writeFile(path.join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', types: ['node'], lib: ['ES2022'], strict: true, skipLibCheck: true, noEmit: true }, include: ['src', 'container.d.ts'] }));
    await run('pnpm', ['exec', 'tsc', '--noEmit'], project);
    assert.match(await run('pnpm', ['exec', 'wrangler', 'deploy', '-c', config, '--dry-run', '--outdir', 'dist'], project), /dry-run/);
    assert.match(await run('node', ['--test', `test/hash-${variant}-gateway.test.mjs`], project), /\btests 5\b/);
    assert.match(await run('node', ['--test', `test/hash-${variant}-docker-smoke.mjs`], project), /\btests 1\b/);
  } finally { await rm(project, { recursive: true, force: true }); }
});
