const express = require('express');
const { Notification, PushSubscription } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { sendServerError } = require('../utils/serverError');

const router = express.Router();

// Public VAPID key so the browser can subscribe to push.
router.get('/vapid-public-key', (req, res) => {
    const key = process.env.VAPID_PUBLIC_KEY || null;
    res.json({ key, enabled: Boolean(key) });
});

// The server sends each push as a request to the subscription's "endpoint"
// address, so only the browsers' own push services are accepted there.
// Otherwise any logged-in user could make the server send requests to an
// address of their choosing - including machines on the company network.
const PUSH_SERVICE_HOSTS = ['.googleapis.com', '.mozilla.com', '.mozaws.net', '.windows.com', '.apple.com'];
const validSubscription = (sub) => {
    if (!sub || typeof sub !== 'object') return false;
    const { endpoint, keys } = sub;
    if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
    if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return false;
    if (keys.p256dh.length > 200 || keys.auth.length > 100) return false;
    let url;
    try {
        url = new URL(endpoint);
    } catch {
        return false;
    }
    return url.protocol === 'https:' && PUSH_SERVICE_HOSTS.some((suffix) => url.hostname.endsWith(suffix));
};

// Subscribe to push notifications
router.post('/subscribe', authenticateToken, async (req, res) => {
    try {
        const subscription = req.body;
        if (!validSubscription(subscription)) {
            return res.status(400).json({ error: 'Invalid push subscription' });
        }

        // Check if subscription already exists
        const existing = await PushSubscription.findOne({
            where: { endpoint: subscription.endpoint }
        });

        if (!existing) {
            await PushSubscription.create({
                endpoint: subscription.endpoint,
                p256dh: subscription.keys.p256dh,
                auth: subscription.keys.auth,
                userId: req.user.id
            });
        } else {
            // Update user if changed (e.g. different user on same device)
            if (existing.userId !== req.user.id) {
                existing.userId = req.user.id;
                await existing.save();
            }
        }

        res.status(201).json({ message: 'Subscribed successfully' });
    } catch (error) {
        sendServerError(res, error, 'POST /api/notifications/subscribe');
    }
});

// Get unread notifications
router.get('/', authenticateToken, async (req, res) => {
    try {
        const notifications = await Notification.findAll({
            where: { userId: req.user.id },
            order: [['createdAt', 'DESC'], ['id', 'DESC']],
            limit: 50
        });
        res.json(notifications);
    } catch (error) {
        sendServerError(res, error, 'GET /api/notifications');
    }
});

// Mark notification as read
router.put('/:id/read', authenticateToken, async (req, res) => {
    try {
        const notification = await Notification.findByPk(req.params.id);
        if (!notification) return res.status(404).json({ error: 'Notification not found' });

        if (notification.userId !== req.user.id) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        notification.isRead = true;
        await notification.save();
        res.json(notification);
    } catch (error) {
        sendServerError(res, error, 'PUT /api/notifications/:id/read');
    }
});

// Mark all as read
router.put('/read-all', authenticateToken, async (req, res) => {
    try {
        await Notification.update(
            { isRead: true },
            { where: { userId: req.user.id, isRead: false } }
        );
        res.json({ message: 'All marked as read' });
    } catch (error) {
        sendServerError(res, error, 'PUT /api/notifications/read-all');
    }
});

module.exports = router;
