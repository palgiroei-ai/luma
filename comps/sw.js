// Offline support: page files cache-first; data.enc.json network-first (new start lists win when online).
const CACHE = 'comps-v2';
const TIMEOUT_MS = 3000; // weak hall Wi-Fi: don't hang on a stalled network, use the cache
const FILES = ['./', 'index.html', 'app.js', 'engine.js', 'store.js', 'decrypt.js', 'comps.css', 'logo-palgitraining.svg', 'mark.svg', 'icon-180.png', 'manifest.webmanifest', 'data.enc.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const networkFirst = url.pathname.endsWith('data.enc.json') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
  if (networkFirst) {
    const cached = () => caches.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(res => {
      if (!res.ok) throw new Error('bad status');
      if (url.origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    });
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS));
    e.respondWith(Promise.race([net, timeout]).catch(async () => (await cached()) || net));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  })));
});
