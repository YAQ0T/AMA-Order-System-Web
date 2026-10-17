import * as notificationsApi from '../api/notifications';

/**
 * Web push registration.
 *
 * Everything here degrades quietly: push is optional, requires HTTPS (or
 * localhost), needs VAPID keys configured on the server, and needs the user to
 * grant permission. Any of those missing just means no push - the app works
 * exactly the same without it.
 *
 * Note for LAN deployments: service workers and the Notification API require a
 * secure context. http://192.168.x.x will NOT work; you need HTTPS or a
 * hostname the browser treats as secure. See the README.
 */

const urlBase64ToUint8Array = (base64String) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export function pushSupported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    window.isSecureContext
  );
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.warn('[push] service worker registration failed:', err);
    return null;
  }
}

/**
 * Ask for permission and subscribe. Returns a short status string so the caller
 * can tell the user what happened.
 */
export async function enablePush() {
  if (!pushSupported()) return 'unsupported';

  const key = await notificationsApi.fetchVapidKey();
  if (!key) return 'server-disabled';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const registration = await registerServiceWorker();
  if (!registration) return 'unsupported';

  await navigator.serviceWorker.ready;

  try {
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      }));

    // The server expects the raw PushSubscription JSON: { endpoint, keys }.
    await notificationsApi.subscribePush(subscription.toJSON());
    return 'subscribed';
  } catch (err) {
    console.warn('[push] subscribe failed:', err);
    return 'failed';
  }
}

/** Re-subscribe silently on load when permission was already granted. */
export async function resumePush() {
  if (!pushSupported()) return;
  if (Notification.permission !== 'granted') return;
  await enablePush();
}
