// 🌸 Twisted Happiness Native Web Push Worker 🌸

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

// Listen for push signals sent from the server/database when you are offline
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || '🌸 New Order Received!';
  const options = {
    body: data.body || 'A new customer just placed an order on your store.',
    icon: '/assets/th_logo.svg',
    badge: '/assets/th_logo.svg',
    vibrate: [200, 100, 200],
    data: { url: '/admin/admin-enquiries.html' }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// When you tap the notification on your phone/PC lock screen, open the admin panel
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.includes('/admin/') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/admin/admin-enquiries.html');
      }
    })
  );
});