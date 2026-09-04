// 🌸 Twisted Happiness Native Web Push + PWA Launch Worker 🌸

const TH_PWA_CACHE = 'twisted-happiness-pwa-assets';

const TH_PWA_ASSETS = [
  '/assets/icon-192.png?v=2.2'
];


/*
 * Install
 *
 * Cache the animated logo and logo fallback so the PWA launch
 * animation can work even when the app is opened with poor
 * or temporarily unavailable network connectivity.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(TH_PWA_CACHE)
      .then((cache) => {
        return cache.addAll(TH_PWA_ASSETS);
      })
      .catch(() => {
        /*
         * Do not prevent the service worker from installing if
         * the video cannot be cached for some reason.
         *
         * The browser can still request the video normally.
         */
      })
      .then(() => {
        return self.skipWaiting();
      })
  );
});


/*
 * Activate immediately and take control of open pages.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.clients.claim()
  );
});


/*
 * Serve the PWA launch assets from cache when available.
 *
 * Everything else continues to behave normally.
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(
    request.url
  );

  const isLaunchAsset =
    url.origin === self.location.origin &&
    TH_PWA_ASSETS.includes(url.pathname);

  if (!isLaunchAsset) {
    return;
  }

  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {

        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request)
          .then((networkResponse) => {

            if (
              networkResponse &&
              networkResponse.ok
            ) {
              const responseClone =
                networkResponse.clone();

              caches.open(TH_PWA_CACHE)
                .then((cache) => {
                  cache.put(
                    request,
                    responseClone
                  );
                });
            }

            return networkResponse;
          });
      })
  );
});


/*
 * Listen for push signals sent from the server/database
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    // Safely parse the JSON payload
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

  // 🔥 CRITICAL FIX: Only attach the image if it is a valid string. 
  // Passing 'null' here causes Android to instantly crash and hide the notification.
  if (data.image && typeof data.image === 'string' && data.image.trim() !== '') {
    options.image = data.image;
  }

  event.waitUntil(self.registration.showNotification(title, options));
});


/*
 * When you tap the notification on your phone/PC lock screen,
 * intelligently route to the correct URL.
 */
self.addEventListener('notificationclick', (event) => {

  event.notification.close();
  
  const urlToOpen = event.notification.data.url || '/';

  event.waitUntil(

    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    })

    .then((clientList) => {

      for (
        let i = 0;
        i < clientList.length;
        i++
      ) {

        const client =
          clientList[i];

        if (
          client.url.includes(self.location.origin) &&
          'focus' in client
        ) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(
          urlToOpen
        );
      }

    })

  );
});
