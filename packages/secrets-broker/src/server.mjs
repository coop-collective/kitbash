#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from './service.mjs';
import { openState } from './state.mjs';
import { fail, publicError } from './errors.mjs';
import { createBrokerHandler } from './http.mjs';

export function createBrokerServer(service, options = {}) {
  const handler = createBrokerHandler(service, options);
  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000, maxHeaderSize: 8192 }, async (request, response) => {
    try {
      const hasBody = !['GET', 'HEAD'].includes(request.method);
      const webRequest = new Request(new URL(request.url, 'http://localhost'), {
        method: request.method, headers: request.headers,
        ...(hasBody ? { body: Readable.toWeb(request), duplex: 'half' } : {}),
      });
      const result = await handler.fetch(webRequest);
      response.statusCode = result.status;
      result.headers.forEach((value, name) => response.setHeader(name, value));
      if (result.body) for await (const chunk of result.body) {
        if (!response.write(chunk)) await once(response, 'drain');
      }
      response.end();
    } catch { response.destroy(); }
  });
  server.once('close', () => { void handler.close(); });
  return server;
}

export async function main(argv, { env = process.env } = {}) {
  if (argv.includes('--help')) {
    console.log('Usage: node src/server.mjs --config /operator/policy.json --state /operator/private/state.json. Routes: /mcp (remote connector), /v1/operations (HTTP client). Bind: KIT_BROKER_HOST (default 127.0.0.1), KIT_BROKER_PORT (default 8789). Put behind HTTPS on an isolated host.');
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
    const service = createService(config, store, { env });
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
