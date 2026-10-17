/* Service worker for web push notifications.
 *
 * The Node server already sends pushes via web-push + VAPID
 * (server/utils/push.js), and the Flutter app cannot receive them on the web.
 * This is one of the things the browser client gets that the Flutter build does
 * not.
 *
 * No offline caching here on purpose: order data must never be served stale
 * from a cache, and the app is useless without the API anyway.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'نظام طلبات AMA';
  const options = {
    body: payload.body || payload.message || '',
    icon: '/logo.png',
    badge: '/favicon.png',
    dir: 'rtl',
    lang: 'ar',
    data: { url: payload.url || '/', orderId: payload.orderId ?? null },
    tag: payload.orderId ? `order-${payload.orderId}` : undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an existing tab if the app is already open.
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
