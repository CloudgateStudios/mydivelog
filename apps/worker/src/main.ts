import { createServer } from 'node:http';
import { healthResponse } from './health.js';

/**
 * The worker consumes pg-boss jobs (imports, exports, email) — none of which
 * exist yet. It still serves HTTP, because a Fly machine with no listening
 * port has no health check, and a worker that dies silently is worse than one
 * that fails loudly.
 *
 * Job consumers arrive in Phase 3 with the import pipeline.
 */
const port = Number(process.env['WORKER_PORT'] ?? 53003);

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(healthResponse()));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`worker listening on http://0.0.0.0:${port}`);
});

// Fly sends SIGTERM before replacing a machine. Stop accepting connections and
// let in-flight work finish rather than dropping it mid-job.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
