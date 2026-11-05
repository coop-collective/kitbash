// Opt-in integration check: creates only a local temporary app, builds it, starts workerd, uses Chromium, cleans up.
import { mkdtemp, mkdir, cp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const recipe = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const template = process.env.KITBASH_VINEXT_TEMPLATE || resolve(recipe, '../../bootstraps/vinext/files');
const app = await mkdtemp(join(tmpdir(), 'kitbash-vinext-diagnostics-'));
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'PNPM_HOME', 'SystemRoot'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, { WRANGLER_SEND_METRICS: 'false', CI: 'true' });
async function run(args) {
  const child = spawn('pnpm', args, { cwd: app, env, stdio: 'inherit', detached: process.platform !== 'win32' });
  const stop = signal => { if (!child.pid) return; try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; } };
  const timer = setTimeout(() => stop('SIGKILL'), 300_000);
  try { const [code] = await once(child, 'exit'); assert.equal(code, 0, `pnpm ${args.join(' ')} failed or exceeded five minutes`); }
  finally { clearTimeout(timer); if (child.exitCode === null) stop('SIGKILL'); }
}
async function render(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await render(path);
    else if (entry.isFile()) {
      const value = await readFile(path, 'utf8');
      await writeFile(path, value.replaceAll('__PROJECT_NAME__', 'diagnostics-fixture').replaceAll('__HOST__', '127.0.0.1').replaceAll('__PORT__', '8799').replaceAll('__COMPATIBILITY_DATE__', '2026-08-22'));
    }
  }
}
let server, browser;
try {
  await cp(template, app, { recursive: true });
  await cp(resolve(template, '../../shared/files'), app, { recursive: true });
  await render(app);
  const workerConfig = JSON.parse(await readFile(join(app, 'wrangler.jsonc'), 'utf8'));
  assert.ok(!JSON.stringify(workerConfig).match(/\"remote\":true/), 'Fixture must not enable remote bindings');
  const manifest = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'));
  const recipeManifest = JSON.parse(await readFile(join(recipe, 'package.json'), 'utf8'));
  manifest.dependencies['web-vitals'] = recipeManifest.dependencies['web-vitals'];
  await writeFile(join(app, 'package.json'), JSON.stringify(manifest, null, 2));
  const tsconfig = JSON.parse(await readFile(join(app, 'tsconfig.json'), 'utf8'));
  tsconfig.compilerOptions.allowImportingTsExtensions = true;
  await writeFile(join(app, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
  await cp(join(recipe, 'src'), join(app, 'src/diagnostics'), { recursive: true });
  await writeFile(join(app, 'src/app/page.tsx'), `'use client';
import { useState } from 'react';
import { DevelopmentChecks, Vitals } from '../diagnostics/Diagnostics.tsx';
import type { Vital } from '../diagnostics/vitals.ts';
declare global { interface Window { __vitals?: Vital[] } }
const receive = (metric: Vital) => { (window.__vitals ||= []).push(metric); };
export default function Page() { const [count, setCount] = useState(0); return <DevelopmentChecks><Vitals onMetric={receive}/><h1>Diagnostics fixture</h1><button onClick={() => setCount(count + 1)}>Count {count}</button><div style={{height:300,width:300,background:'#ccc'}}>Stable content</div></DevelopmentChecks>; }
`);
  await writeFile(join(app, 'src/instrumentation.ts'), `declare global { var __diagnosticsRegistered: boolean | undefined; }\nexport function register() { globalThis.__diagnosticsRegistered = true; }\n`);
  await mkdir(join(app, 'src/app/api/diagnostics'), { recursive: true });
  await writeFile(join(app, 'src/app/api/diagnostics/route.ts'), `export function GET() { return Response.json({ok:true,registered:globalThis.__diagnosticsRegistered === true}); }\n`);
  console.log('Compatibility pins:', JSON.stringify(manifest.dependencies));
  await run(['install', '--no-frozen-lockfile']);
  await run(['run', 'check']);
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const { port } = reservation.address(); await new Promise(r => reservation.close(r));
  server = spawn('pnpm', ['run', 'start', '--ip', '127.0.0.1', '--port', String(port)], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  let spawnError; server.on('error', error => { spawnError = error; });
  let output = ''; for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { output = (output + data).slice(-3000); });
  const origin = `http://127.0.0.1:${port}`;
  let health;
  for (let i = 0; i < 180; i++) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null) throw new Error(`Worker exited: ${output}`);
    try { const response = await fetch(origin + '/api/diagnostics', { signal: AbortSignal.timeout(500) }); if (response.ok) { health = await response.json(); break; } } catch {}
    await delay(500);
  }
  assert.deepEqual(health, { ok: true, registered: true }, 'Built Worker must execute instrumentation.register');
  browser = await chromium.launch();
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.name));
  await page.goto(origin);
  await page.getByRole('button', { name: 'Count 0' }).click();
  await page.getByRole('button', { name: 'Count 1', exact: true }).waitFor();
  await page.waitForFunction(() => window.__vitals?.some(metric => metric.name === 'LCP'));
  const metrics = await page.evaluate(() => window.__vitals);
  assert.deepEqual(errors, []);
  assert.ok(metrics.every(metric => Object.keys(metric).sort().join(',') === 'name,scope,unit,value'));
  console.log('PASS: pinned vinext production build + workerd instrumentation + browser hydration + direct web-vitals LCP callback. No field percentile or production profiling claim.');
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null) {
    const stop = signal => { try { process.platform === 'win32' ? server.kill(signal) : process.kill(-server.pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; } };
    stop('SIGTERM'); await Promise.race([once(server, 'exit'), delay(5000)]); if (server.exitCode === null) stop('SIGKILL');
  }
  await rm(app, { recursive: true, force: true, maxRetries: 3 });
}
