// Local design preview. Explicit asset allowlist prevents access to private repo files.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const assets = new Map([
  ['/', [new URL('./warroom-warm.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/assets/flaticon-uicons.woff2', [new URL('./assets/flaticon-uicons-regular-rounded-3.3.1.woff2', import.meta.url), 'font/woff2']],
  ['/cozy', [new URL('./warroom-cozy.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/warroom-cozy.css', [new URL('./warroom-cozy.css', import.meta.url), 'text/css; charset=utf-8']],
  ['/warroom-cozy.js', [new URL('./warroom-cozy.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/horizon', [new URL('./warroom-horizon.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/warroom-horizon.css', [new URL('./warroom-horizon.css', import.meta.url), 'text/css; charset=utf-8']],
  ['/warroom-horizon.js', [new URL('./warroom-horizon.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/work', [new URL('./warroom-work.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/warroom-work.css', [new URL('./warroom-work.css', import.meta.url), 'text/css; charset=utf-8']],
  ['/warroom-work.js', [new URL('./warroom-work.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/warroom-style.css', [new URL('../../warroom/public/style.css', import.meta.url), 'text/css; charset=utf-8']],
  ['/work.css', [new URL('../../warroom/public/work.css', import.meta.url), 'text/css; charset=utf-8']],
  ['/health', [new URL('./warroom-health.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/ops', [new URL('./warroom-ops.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/warroom-ops.js', [new URL('./warroom-ops.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/warroom-ops.css', [new URL('./warroom-ops.css', import.meta.url), 'text/css; charset=utf-8']],
  ['/warroom-warm.js', [new URL('./warroom-warm.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/favicon.svg', [new URL('../../warroom/public/favicon.svg', import.meta.url), 'image/svg+xml']],
  ...['symbol_dark.svg', 'symbol_light.svg', 'primary_logo_dark.svg', 'primary_logo_light.svg'].map((f) => [`/assets/${f}`, [new URL(`../../warroom/public/assets/${f}`, import.meta.url), 'image/svg+xml']]),
  ...Array.from({ length: 9 }, (_, n) => [`/fonts/thai-${n}.woff2`, [new URL(`../../warroom/public/fonts/thai-${n}.woff2`, import.meta.url), 'font/woff2']]),
]);
http.createServer(async (request, response) => {
  const asset = assets.get(new URL(request.url, 'http://localhost').pathname);
  if (!asset || request.method !== 'GET') { response.writeHead(404); response.end('Not found'); return; }
  try {
    const data = await readFile(asset[0]);
    response.writeHead(200, {
      'content-type': asset[1],
      'cache-control': 'no-store',
      ...(asset[0].pathname.endsWith('/warroom-work.html') ? {
        'content-security-policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      } : {}),
    });
    response.end(data);
  } catch { response.writeHead(500); response.end('Preview asset unavailable'); }
}).listen(4174, '127.0.0.1', () => console.log('Design preview: http://127.0.0.1:4174 — synthetic data only'));
