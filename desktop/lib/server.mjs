import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.stl': 'application/octet-stream', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
export async function createLocalServer(root, store, onError = () => {}) {
  const token = randomBytes(32).toString('hex');
  let origin;
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self' blob:; font-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'");
    if (request.headers.host !== new URL(origin).host || request.headers['x-yibei-session'] !== token || (request.headers.origin && request.headers.origin !== origin) || (request.headers['sec-fetch-site'] && !['same-origin','none'].includes(request.headers['sec-fetch-site']))) {
      response.writeHead(403).end('Forbidden'); return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    try {
      const url = new URL(request.url, origin);
      const decoded = decodeURIComponent(url.pathname);
      if (decoded.includes('..') || decoded.includes('\\') || decoded.includes('\0')) { response.writeHead(400).end(); return; }
      let data, extension;
      if (decoded.startsWith('/project-model/')) { data = await store.modelBytes(decoded); extension = '.stl'; }
      else {
        const relative = ['/', '/reconstruction', '/twin-ai', '/reconstruction/', '/twin-ai/'].includes(decoded) ? 'index.html' : decoded.slice(1);
        const destination = path.resolve(root, relative);
        if (!destination.startsWith(`${path.resolve(root)}${path.sep}`)) { response.writeHead(403).end(); return; }
        if ((await stat(destination)).isFile()) { data = await readFile(destination); extension = path.extname(destination); }
      }
      if (!data) { response.writeHead(404).end('资源不存在'); return; }
      response.setHeader('Content-Type', types[extension] || 'application/octet-stream');
      response.setHeader('Cache-Control', decoded.startsWith('/assets/') ? 'private, max-age=31536000, immutable' : 'no-store');
      response.setHeader('Content-Length', data.length);
      response.writeHead(200).end(request.method === 'HEAD' ? undefined : data);
    } catch (error) { if (error.code !== 'ENOENT') onError(error); response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('无法读取本地资源'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, token, close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }) };
}
