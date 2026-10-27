// Caches the app shell so the PWA opens instantly and installs; API calls always go to the network.
const CACHE = 'officebuffet-v17';
const SHELL = [
  '/', '/index.html', '/css/app.css', '/js/app.js', '/js/jalali.js', '/fonts/Vazirmatn.woff2',
  '/manifest.webmanifest', '/apple-touch-icon.png', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Network first (so updates show up immediately), cached copy when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/index.html') : undefined))),
  );
});

// New-request notifications for the admin (sent by the server through Web Push).
self.addEventListener('push', (event) => {
  const msg = event.data ? event.data.json() : {};
  event.waitUntil(Promise.all([
    self.registration.showNotification(msg.title || 'بوفه', {
      body: msg.body || '',
      tag: msg.tag,
      renotify: !!msg.tag, // a new request with the same tag still rings instead of updating silently
      dir: 'rtl',
      lang: 'fa',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [300, 120, 300, 120, 600], // Android: a long, recognizable pattern
      data: { url: msg.url || '/' },
      requireInteraction: true,
    }),
    // An open app plays its own chime right away.
    self.clients.matchAll({ type: 'window' }).then((wins) => wins.forEach((w) => w.postMessage({ type: 'request' }))),
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    const win = wins.find((w) => new URL(w.url).origin === location.origin);
    if (!win) return self.clients.openWindow(url);
    return win.focus().then((w) => (w || win).navigate(url));
  }));
});
