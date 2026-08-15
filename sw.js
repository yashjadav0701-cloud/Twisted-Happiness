// CACHE KILL SWITCH
// This forces all user browsers to delete old files and fetch the new updates immediately.

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName))
      );
    }).then(() => {
      self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (e) => {
  // Pass through everything, do not intercept or cache
});