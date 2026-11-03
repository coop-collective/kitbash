import { startServer } from './app';
const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const { server, scratch } = await startServer({ port });
console.log(JSON.stringify({ event: 'ready', scratchMemoryBacked: scratch.memoryBacked }));
process.on('SIGTERM', () => { server.close(); setTimeout(() => process.exit(1), 10_000).unref(); });
