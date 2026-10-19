import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scratchRoot, withScratch } from './scratch.mjs';
const MAX_BYTES = 1_048_576;
export async function startServer({ port = 8080, host = '0.0.0.0', root, deadlineMs = 10_000 } = {}) {
  const scratch = root ? await scratchRoot([root]) : await scratchRoot();
  let active = 0;
  const server = createServer(async (request, response) => {
    if (request.url === '/health' && request.method === 'GET') { response.end('ok'); return; }
    if (request.url !== '/hash' || request.method !== 'POST') { response.writeHead(404).end(); return; }
    if (active >= 2) { response.writeHead(503, { 'retry-after': '1' }).end(); request.resume(); return; }
    active++;
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), deadlineMs);
    try {
      const result = await withScratch(scratch.path, async (directory) => {
        const path = join(directory, 'input');
        let bytes = 0;
        const limit = new Transform({ transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          callback(bytes > MAX_BYTES ? new Error('Payload too large') : null, bytes > MAX_BYTES ? undefined : chunk);
        } });
        await pipeline(request, limit, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal: abort.signal });
        const hash = createHash('sha256');
        await pipeline(createReadStream(path), hash, { signal: abort.signal });
        return { bytes, sha256: hash.digest('hex') };
      });
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(result));
    } catch (error) {
      // pipeline destroys a failed inbound stream. Clients may see a disconnect rather than an HTTP error.
      if (!response.destroyed) response.writeHead(abort.signal.aborted ? 408 : error.message === 'Payload too large' ? 413 : 500).end();
    } finally { clearTimeout(timer); active--; }
  });
  server.requestTimeout = deadlineMs;
  server.headersTimeout = deadlineMs;
  server.maxHeadersCount = 30;
  await new Promise((resolve) => server.listen(port, host, resolve));
  return { server, scratch };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server, scratch } = await startServer();
  console.log(JSON.stringify({ event: 'ready', scratchMemoryBacked: scratch.memoryBacked }));
  process.on('SIGTERM', () => { server.close(); setTimeout(() => process.exit(1), 10_000).unref(); });
}
