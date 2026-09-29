import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalServer } from '../lib/server.mjs';

test('independent ephemeral server serves SPA offline; denies untrusted origins, traversal and methods; releases port', async () => {
  const occupied = http.createServer(); await new Promise((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  const root = await mkdtemp(path.join(os.tmpdir(), 'yibei-static-'));
  await writeFile(path.join(root, 'index.html'), '<h1>offline app</h1>');
  const api = await createLocalServer(root, { modelBytes: async (url) => url === '/project-model/test' ? Buffer.from('STL') : null });
  try {
    assert.notEqual(new URL(api.origin).port, String(occupied.address().port));
    const headers = { 'X-Yibei-Session': api.token };
    for (const route of ['/', '/reconstruction', '/twin-ai']) { const response = await fetch(api.origin + route, { headers }); assert.equal(response.status, 200); assert.equal(await response.text(), '<h1>offline app</h1>'); assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/); }
    assert.equal((await fetch(api.origin + '/project-model/test', { headers })).status, 200);
    assert.equal((await fetch(api.origin)).status, 403);
    assert.equal((await fetch(api.origin, { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
    const badHost = await new Promise((resolve, reject) => { const request = http.get(api.origin, { headers: { ...headers, Host: 'evil.example' } }, (response) => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); });
    assert.equal(badHost, 403);
    assert.equal((await fetch(api.origin, { method: 'POST', headers })).status, 405);
    assert.equal((await fetch(api.origin + '/%2e%2e%5cprivate', { headers })).status, 400);
    assert.equal((await fetch(api.origin + '/missing.js', { headers })).status, 404);
  } finally { await api.close(); await new Promise((resolve) => occupied.close(resolve)); }
  await assert.rejects(fetch(api.origin));
});
