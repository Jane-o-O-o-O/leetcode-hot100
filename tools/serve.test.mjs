import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createStaticServer } from './serve.js';

let directory;
let server;
let origin;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hot100-server-'));
  await writeFile(join(directory, 'index.html'), '<h1>Hot 100</h1>');
  await writeFile(join(directory, 'app.js'), 'export default 100;');
  server = createStaticServer({ rootDirectory: directory });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

test('静态服务器支持 GET、HEAD 和正确的 MIME/安全响应头', async () => {
  const response = await fetch(`${origin}/`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await response.text(), '<h1>Hot 100</h1>');

  const head = await fetch(`${origin}/app.js`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(await head.text(), '');
});

test('ETag 命中时返回 304，避免重复传输静态资源', async () => {
  const first = await fetch(`${origin}/app.js`);
  const etag = first.headers.get('etag');
  assert.ok(etag);
  const cached = await fetch(`${origin}/app.js`, { headers: { 'If-None-Match': etag } });
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), '');
});

test('拒绝不支持的方法与编码反斜杠目录穿越', async () => {
  const post = await fetch(`${origin}/`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');

  const status = await new Promise((resolve, reject) => {
    const request = http.get(`${origin}/%5c..%5coutside.txt`, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
  });
  assert.equal(status, 403);
});
