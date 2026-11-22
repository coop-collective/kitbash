import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.E2E_PORT ?? 8798);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid E2E_PORT');
const child = spawn(process.execPath, [root + 'node_modules/wrangler/bin/wrangler.js',
  'dev', '--local', '--ip', '127.0.0.1', '--port', String(port)], {
  cwd: root, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; child.kill('SIGTERM'); });
child.once('error', () => { console.error('Local Worker failed to start'); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = stopping ? 0 : (code ?? 1); });
