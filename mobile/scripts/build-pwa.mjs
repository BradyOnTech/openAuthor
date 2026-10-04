import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

const output = process.argv[2] ? resolve(process.argv[2]) : resolve(import.meta.dirname, "../dist");
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((item) => item.isDirectory()
    ? files(resolve(directory, item.name))
    : [resolve(directory, item.name)]))).flat();
}
const indexPath = resolve(output, "index.html");
let html = await readFile(indexPath, "utf8");
html = html.replace("</head>", `<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/icon.png" />
<meta name="theme-color" content="#0c0d12" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="openAuthor" />
<meta name="referrer" content="no-referrer" />
<style>html,body,#root{min-height:100%;background:#0c0d12}#root{max-width:56rem;margin:auto;min-height:100dvh}body{padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);box-sizing:border-box}button,input,textarea{font:inherit}</style>
</head>`);
html = html.replace("</body>", `<script src="/pwa-register.js" defer></script></body>`);
await writeFile(indexPath, html);
await writeFile(resolve(output, "pwa-register.js"), `if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/service-worker.js').catch(() => {}); });
}
`);
// Only immutable application assets and the app shell are offline cached.
// Never cache credentials, gateway traffic, project snapshots, or API responses.
const assets = (await files(output)).map((path) => `/${relative(output, path)}`)
  .filter((path) => path.startsWith("/_expo/") || ["/index.html", "/manifest.webmanifest", "/icon.png", "/pwa-register.js"].includes(path)).sort();
const revision = createHash("sha256").update(html).update(JSON.stringify(assets)).digest("hex").slice(0, 16);
await writeFile(resolve(output, "service-worker.js"), `const CACHE = 'openauthor-shell-${revision}';
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const path of ASSETS) {
      const response = await fetch(path, {cache: 'reload'});
      if (!response.ok || response.redirected) throw new Error('App shell unavailable');
      await cache.put(path, response);
    }
  })());
});
// No skipWaiting: a new release must not replace an active voice conversation.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('openauthor-shell-') && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search) return;
  if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE)).match('/index.html')));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith((async () => (await (await caches.open(CACHE)).match(url.pathname)) || fetch(request))());
  }
});
`);
console.log(`PWA shell built: ${assets.length} public assets. Project/API data is not service-worker cached.`);
