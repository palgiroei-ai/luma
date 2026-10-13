// Offline support: page files cache-first; data.enc.json network-first (new start lists win when online).
const CACHE = 'comps-v16';
const TIMEOUT_MS = 3000; // weak hall Wi-Fi: don't hang on a stalled network, use the cache
const FILES = ['./', 'index.html', 'app.js', 'engine.js', 'store.js', 'sync.js', 'install.js', 'changelog.js', 'decrypt.js', 'comps.css', 'logo-palgitraining.svg', 'mark.svg', 'icon-180.png', 'manifest.webmanifest', 'data.enc.json', 'data.view.enc.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API calls (sync, push status) always go live
  const networkFirst = url.pathname.endsWith('.enc.json') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
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

// Lock-screen alerts (comp-push Worker). Every push shows a notification (iOS requires it).
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'מעקב ראונד', {
    // tag = one athlete: a newer alert replaces the older notification; renotify still sounds/vibrates.
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, icon: 'icon-180.png', badge: 'icon-180.png', lang: 'he', dir: 'rtl', data: { url: './' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
