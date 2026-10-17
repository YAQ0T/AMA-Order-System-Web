const express = require('express');
const { Notification, PushSubscription } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Public VAPID key so the browser can subscribe to push.
router.get('/vapid-public-key', (req, res) => {
    const key = process.env.VAPID_PUBLIC_KEY || null;
    res.json({ key, enabled: Boolean(key) });
});

// Subscribe to push notifications
router.post('/subscribe', authenticateToken, async (req, res) => {
    try {
        const subscription = req.body;

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
        console.error('Error subscribing:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get unread notifications
router.get('/', authenticateToken, async (req, res) => {
    try {
        const notifications = await Notification.findAll({
            where: { userId: req.user.id },
            order: [['createdAt', 'DESC']],
            limit: 50
        });
        res.json(notifications);
    } catch (error) {
        res.status(500).json({ error: error.message });
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
        res.status(500).json({ error: error.message });
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
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
