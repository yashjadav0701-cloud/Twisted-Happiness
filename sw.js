// 🌸 Twisted Happiness Native Web Push + PWA Launch Worker 🌸

const TH_PWA_CACHE = 'twisted-happiness-pwa-assets';

const TH_PWA_ASSETS = [
  '/assets/icon-192.png?v=2.2'
];

/*
 * Install & Cache PWA Assets
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(TH_PWA_CACHE)
      .then((cache) => cache.addAll(TH_PWA_ASSETS))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

/*
 * Activate
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/*
 * Serve the PWA launch assets from cache
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isLaunchAsset = url.origin === self.location.origin && TH_PWA_ASSETS.includes(url.pathname);

  if (!isLaunchAsset) return;

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          const responseClone = networkResponse.clone();
          caches.open(TH_PWA_CACHE).then((cache) => cache.put(request, responseClone));
        }
        return networkResponse;
      });
    })
  );
});

/*
 * Premium Rich Push Notifications
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    console.error("Push payload was not valid JSON");
  }

  const title = data.title || '🌸 Twisted Happiness';

  const options = {
    body: data.body || 'Something new just happened!',
    icon: data.icon || '/assets/icon-192.png',
    badge: '/assets/th_logo.svg',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' }
  };

  // 🔥 FATAL FIX: Ensure image is absolutely pathed to prevent Android Chrome crash
  if (data.image && typeof data.image === 'string' && data.image.startsWith('http')) {
    options.image = data.image;
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

/*
 * Intelligently route deep-links
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});