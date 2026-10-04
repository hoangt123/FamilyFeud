// Static file serving for the web client, plus the browser copy of the QR
// library. Intentionally tiny — no framework.
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { config } from '../../config/index.js';
import { lanAddress } from './network.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const PUBLIC = config.paths.public;
const SHARED = resolve(config.paths.root, 'src/shared');
const VENDOR_QR = resolve(config.paths.root, 'node_modules/qrcode-generator/qrcode.js');
const { version: APP_VERSION } = JSON.parse(
  readFileSync(resolve(config.paths.root, 'package.json'), 'utf8'),
);

// The three screens share one page; the script picks its mode from the path.
const SCREENS = new Set(['/', '/board', '/host', '/display']);

function sendFile(res, filePath, type) {
  res.writeHead(200, {
    'Content-Type': type || MIME[extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  createReadStream(filePath).pipe(res);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

export function createRequestHandler({ getScheme = () => 'http' } = {}) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);

      if (SCREENS.has(pathname)) pathname = '/index.html';
      else if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), version: APP_VERSION }));
      } else if (pathname === '/api/join-info') {
        // LAN links for a second device — the page can't derive them from
        // location.origin when the host opened it via localhost.
        const base = `${getScheme()}://${lanAddress()}:${config.port}`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ hostUrl: `${base}/host`, displayUrl: `${base}/display` }));
      } else if (pathname === '/vendor/qrcode.js') {
        if (existsSync(VENDOR_QR)) return sendFile(res, VENDOR_QR, MIME['.js']);
        return notFound(res);
      } else if (pathname.startsWith('/shared/')) {
        // Pure-ESM constants shared by server and browser.
        const target = normalize(join(SHARED, pathname.slice('/shared/'.length)));
        if (target.startsWith(SHARED) && existsSync(target)) return sendFile(res, target);
        return notFound(res);
      }

      // Resolve within public/, blocking path traversal.
      const target = normalize(join(PUBLIC, pathname));
      if (!target.startsWith(PUBLIC)) return notFound(res);
      if (!existsSync(target)) return notFound(res);
      const info = await stat(target);
      if (!info.isFile()) return notFound(res);
      sendFile(res, target);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error');
    }
  };
}
