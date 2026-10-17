const express = require('express');
const { TelegramLink } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const telegram = require('../utils/telegram');
const { logActivity } = require('../utils/activityLogger');

const router = express.Router();

// GET /api/telegram/status - is the feature on, and is THIS user linked?
router.get('/status', authenticateToken, async (req, res) => {
    try {
        const link = await TelegramLink.findOne({ where: { userId: req.user.id } });
        const linked = Boolean(link?.chatId);
        res.json({
            enabled: telegram.enabled(),
            // Only roles that are actually sent messages may link; the app
            // hides the card for everyone else.
            canLink: telegram.canLink(req.user.role),
            botUsername: telegram.getBotUsername(),
            linked,
            telegramUsername: linked ? link.telegramUsername : null,
            linkedAt: linked ? link.linkedAt : null,
        });
    } catch (error) {
        console.error('Error reading Telegram status:', error);
        res.status(500).json({ error: 'Failed to read Telegram status' });
    }
});

// POST /api/telegram/link - issue a one-time t.me link. Opening it in Telegram
// and tapping Start completes the link (handled by the bot in utils/telegram.js).
router.post('/link', authenticateToken, async (req, res) => {
    if (!telegram.enabled()) {
        return res.status(503).json({ error: 'Telegram is not configured on the server' });
    }
    // Linking a role that is never messaged would look like it worked and then
    // deliver nothing - refuse instead.
    if (!telegram.canLink(req.user.role)) {
        return res.status(403).json({ error: 'Telegram notifications are only for takers and accountants' });
    }
    try {
        const { appUrl, url, expiresAt } = await telegram.createLinkCode(req.user.id);
        res.json({ appUrl, url, expiresAt });
    } catch (error) {
        console.error('Error creating Telegram link code:', error.message);
        res.status(503).json({ error: 'The Telegram bot cannot be reached right now' });
    }
});

// DELETE /api/telegram/link - stop Telegram notifications. There is no email
// fallback, so after this the user is only notified inside the app.
router.delete('/link', authenticateToken, async (req, res) => {
    try {
        const link = await TelegramLink.findOne({ where: { userId: req.user.id } });
        const previousChat = link?.chatId;
        if (link) {
            await link.update({
                chatId: null,
                telegramUsername: null,
                linkedAt: null,
                linkCode: null,
                linkCodeExpiresAt: null,
            });
        }
        if (previousChat) {
            telegram.notifyUnlinked(previousChat).catch(() => {});
            await logActivity(req.user.id, 'telegram_unlinked', 'user', req.user.id, null, req.ip);
        }
        res.json({ linked: false });
    } catch (error) {
        console.error('Error unlinking Telegram:', error);
        res.status(500).json({ error: 'Failed to unlink Telegram' });
    }
});

module.exports = router;
