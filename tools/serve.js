// 零依赖静态文件服务器（Node 18+），供没有 Python 的环境一键启动使用。
// 用法：node tools/serve.js [端口]   默认 8931，仅监听 127.0.0.1。
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.zip': 'application/zip',
};

function isInside(root, target) {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === '' || (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`));
}

function sendText(res, status, message, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(message);
}

export function createStaticServer({ rootDirectory = defaultRoot } = {}) {
  const root = resolve(rootDirectory);
  const canonicalRootPromise = realpath(root);

  return http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, '405 Method Not Allowed', { Allow: 'GET, HEAD' });
      return;
    }

    try {
      let pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname).replace(/\\/g, '/');
      if (pathname.endsWith('/')) pathname += 'index.html';

      const candidate = resolve(root, `.${pathname}`);
      if (!isInside(root, candidate)) {
        sendText(res, 403, '403 Forbidden');
        return;
      }

      // 同时校验 realpath，避免项目目录内的符号链接越界读取文件。
      const [canonicalRoot, filePath] = await Promise.all([canonicalRootPromise, realpath(candidate)]);
      if (!isInside(canonicalRoot, filePath)) {
        sendText(res, 403, '403 Forbidden');
        return;
      }

      const info = await stat(filePath);
      if (!info.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' });

      const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
      const headers = {
        'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-cache',
        ETag: etag,
        'Last-Modified': info.mtime.toUTCString(),
        'X-Content-Type-Options': 'nosniff',
      };

      // no-cache 会要求浏览器重新验证；ETag 命中后仅返回 304，不再重复传输
      // Monaco / Pyodide 等大文件。流式发送则避免服务器把整个文件读入内存。
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, {
          'Cache-Control': headers['Cache-Control'],
          ETag: headers.ETag,
          'Last-Modified': headers['Last-Modified'],
        });
        res.end();
        return;
      }

      res.writeHead(200, headers);
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      await pipeline(createReadStream(filePath), res);
    } catch (error) {
      if (!res.headersSent) sendText(res, 404, '404 Not Found');
      else if (!res.writableEnded) res.destroy(error);
    }
  });
}

function parsePort(value) {
  const port = Number(value || 8931);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`端口无效: ${value}`);
  return port;
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  const port = parsePort(process.argv[2]);
  createStaticServer().listen(port, '127.0.0.1', () => {
    console.log(`Hot 100 刷题已启动：http://127.0.0.1:${port}`);
    console.log('按 Ctrl+C 停止');
  });
}
