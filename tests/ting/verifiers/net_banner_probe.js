#!/usr/bin/env node
/**
 * Локальная статика + скриншоты баннера низкой скорости через CDP.
 * Запуск: node tests/ting/verifiers/net_banner_probe.js
 * Требует запущенный Chrome с --remote-debugging-port (используется browser MCP).
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, '../../..');
const PUBLIC = path.join(root, 'public');
// URL /assets/*, /ting/* живут в public/, тестовые страницы — в tests/.
const PREFIXED = ['/assets/', '/ting/', '/h/'];

function resolveFile(urlPath) {
  if (PREFIXED.some((p) => urlPath.startsWith(p))) {
    return path.join(PUBLIC, urlPath.replace(/^\//, ''));
  }
  if (urlPath === '/') return path.join(PUBLIC, 'index.html');
  return path.join(root, urlPath.replace(/^\//, ''));
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const full = resolveFile(urlPath);
      if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404).end('nf');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      fs.createReadStream(full).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  console.log('http://127.0.0.1:' + port + '/tests/ting/verifiers/net_banner_probe.html');
  process.on('SIGINT', () => { srv.close(); process.exit(0); });
})();
