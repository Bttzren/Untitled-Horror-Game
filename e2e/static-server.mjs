// Serves the built game (dist/) from http://127.0.0.1:4174/nested/ for browser tests:
// a sub-folder, the way itch.io serves uploaded games.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve('dist');
const PREFIX = '/nested/';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  if (!path.startsWith(PREFIX)) { res.writeHead(404).end('not found'); return; }
  const file = resolve(join(ROOT, normalize(path.slice(PREFIX.length) || 'index.html')));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(4174, '127.0.0.1', () => console.log('built game on http://127.0.0.1:4174/nested/'));
