const CACHE = 'openauthor-shell-1344c1f2027e991f';
const ASSETS = ["/_expo/static/js/web/index-49c4913ae4c7a7a9703a57d7e8182046.js","/icon.png","/index.html","/manifest.webmanifest","/pwa-register.js"];
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
