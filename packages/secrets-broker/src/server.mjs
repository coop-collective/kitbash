#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from './service.mjs';
import { openState } from './state.mjs';
import { fail, publicError } from './errors.mjs';

export function createBrokerServer(service, { audit = entry => console.log(JSON.stringify(entry)) } = {}) {
  return createServer({ requestTimeout: 15_000, headersTimeout: 10_000, maxHeaderSize: 8192 }, async (request, response) => {
    const requestId = randomUUID();
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    let output;
    try {
      if (request.method !== 'POST' || request.url !== '/v1/operations' || request.headers.origin ||
          request.headers['content-type']?.split(';')[0] !== 'application/json') fail('invalid_request');
      const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.authorization ?? '');
      if (!match) fail('forbidden');
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 8192) fail('invalid_request');
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('invalid_request'); }
      output = await service.execute(input, match[1]);
      // Only validated response metadata goes into the audit event; no HTTP body/headers.
      audit({ requestId, operation: output.operation, project: output.project, target: output.target, status: output.status });
      response.statusCode = 200;
    } catch (error) {
      output = publicError(error);
      response.statusCode = { forbidden: 403, invalid_request: 400, conflict: 409, unavailable: 503, provider_failed: 502 }[output.error.code];
      audit({ requestId, code: output.error.code });
    }
    response.end(JSON.stringify(output));
  });
}

export async function main(argv, { env = process.env } = {}) {
  if (argv.includes('--help')) {
    console.log('Usage: node src/server.mjs --config /operator/policy.json --state /operator/private/state.json. Bind: KIT_BROKER_HOST (default 127.0.0.1), KIT_BROKER_PORT (default 8789). Put behind HTTPS on an isolated host.');
    return;
  }
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--config', '--state'].includes(argv[i]) || !argv[i + 1] || args[argv[i]]) fail('invalid_request');
    args[argv[i]] = argv[i + 1];
  }
  if (!args['--config'] || !args['--state']) fail('invalid_request');
  const config = JSON.parse(readFileSync(args['--config'], 'utf8'));
  const store = openState(args['--state']);
  let server;
  try {
    const service = createService(config, store);
    server = createBrokerServer(service);
    const port = Number(env.KIT_BROKER_PORT ?? 8789);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail('invalid_request');
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, env.KIT_BROKER_HOST ?? '127.0.0.1', resolve);
    });
    console.log(JSON.stringify({ status: 'broker_listening' }));
  } catch (error) { server?.close(); store.close(); throw error; }
  const shutdown = () => server.close(() => { store.close(); process.exit(0); });
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(JSON.stringify(publicError(error)));
    process.exitCode = 1;
  });
}
