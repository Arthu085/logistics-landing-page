import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/assets/favicon.svg', ['assets/favicon.svg', 'image/svg+xml']],
  ['/assets/route-network.svg', ['assets/route-network.svg', 'image/svg+xml']],
  ['/healthz', ['healthz', 'text/plain; charset=utf-8']],
  ['/version.json', ['version.json', 'application/json']],
]);
const port = Number(process.env.PORT ?? 3000);
const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const entry = files.get(request.url?.split('?')[0]);
  if (!entry) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(new URL(`../dist/${entry[0]}`, import.meta.url));
    response.writeHead(200, { 'Content-Type': entry[1], 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(503).end('Run npm run build first.');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Preview: http://localhost:${port}`));
