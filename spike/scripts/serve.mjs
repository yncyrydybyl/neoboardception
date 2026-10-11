// Minimal HTTPS static server for the spike (NeoBoard build + inner test widget).
//
//   TLS_CERT=… TLS_KEY=… node spike/scripts/serve.mjs
//
// Env: NEOBOARD_PORT (5443), INNER_PORT (5444), TLS_CERT / TLS_KEY (PEM paths;
// if unset a throwaway self-signed cert is generated with openssl into
// spike/.certs/). Framing is allowed from anywhere (frame-ancestors *).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:https';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function tls() {
  let cert = process.env.TLS_CERT;
  let key = process.env.TLS_KEY;
  if (!cert || !key) {
    const dir = join(ROOT, 'spike', '.certs');
    cert = join(dir, 'cert.pem');
    key = join(dir, 'key.pem');
    if (!existsSync(cert)) {
      mkdirSync(dir, { recursive: true });
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-days',
          '30',
          '-subj',
          '/CN=localhost',
          '-keyout',
          key,
          '-out',
          cert,
        ],
        { stdio: 'ignore' },
      );
    }
  }
  return { cert: readFileSync(cert), key: readFileSync(key) };
}

export function serveDir(dir, port, opts = tls()) {
  const server = createServer(opts, async (req, res) => {
    try {
      const p = decodeURIComponent(
        (req.url || '/').split('?')[0].split('#')[0],
      );
      let rel = normalize(p).replace(/^(\.\.[/\\])+/, '');
      if (rel === '/' || rel === '') rel = '/index.html';
      let file = join(dir, rel);
      let st = await stat(file).catch(() => null);
      if (st?.isDirectory()) {
        file = join(file, 'index.html');
        st = await stat(file).catch(() => null);
      }
      if (!st && !extname(rel)) {
        file = join(dir, 'index.html');
        st = await stat(file).catch(() => null);
      }
      if (!st) {
        res.writeHead(404);
        res.end('404');
        return;
      }
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] || 'application/octet-stream',
        'access-control-allow-origin': '*',
        'content-security-policy': 'frame-ancestors *',
        'cache-control': 'no-store',
      });
      res.end(await readFile(file));
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t = tls();
  const nb = Number(process.env.NEOBOARD_PORT ?? 5443);
  const inner = Number(process.env.INNER_PORT ?? 5444);
  await serveDir(join(ROOT, 'matrix-neoboard-widget', 'build'), nb, t);
  await serveDir(join(ROOT, 'spike', 'test-widget', 'dist'), inner, t);
  console.log(`NeoBoard fork:  https://localhost:${nb}/`);
  console.log(`inner widget:   https://localhost:${inner}/`);
}
