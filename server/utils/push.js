const webpush = require('web-push');
const { PushSubscription } = require('../db');

// Keys come from the environment. Generate a fresh pair with:
//   npx web-push generate-vapid-keys
// and put them in server/.env as VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

const pushEnabled = Boolean(publicVapidKey && privateVapidKey);

if (pushEnabled) {
    webpush.setVapidDetails(vapidSubject, publicVapidKey, privateVapidKey);
} else {
    console.warn('[push] VAPID keys not set - web push is disabled. See server/.env.example');
}

const sendPushNotification = async (userId, payload) => {
    if (!pushEnabled) return;
    try {
        const subscriptions = await PushSubscription.findAll({ where: { userId } });

        const notifications = subscriptions.map(sub => {
            const pushConfig = {
                endpoint: sub.endpoint,
                keys: {
                    auth: sub.auth,
                    p256dh: sub.p256dh
                }
            };
            return webpush.sendNotification(pushConfig, JSON.stringify(payload))
                .catch(err => {
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        // Subscription is invalid, delete it
                        return sub.destroy();
                    }
                    console.error('Error sending push notification:', err);
                });
        });

        await Promise.all(notifications);
    } catch (error) {
        console.error('Error in sendPushNotification:', error);
    }
};

module.exports = { sendPushNotification };
