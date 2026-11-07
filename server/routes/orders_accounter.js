const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { fetchOrdersForRole } = require('./order_helpers');
const { sendServerError } = require('../utils/serverError');

const router = express.Router();

// Accounter Orders (Completed + Entered ERP)
router.get('/accounter', authenticateToken, async (req, res) => {
    try {
        if (!['accounter', 'admin'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Only accounters or admins can view ERP-entered orders' });
        }

        let accounterId = req.user.id;
        if (req.user.role === 'admin' && req.query.accounterId) {
            const parsedId = parseInt(req.query.accounterId, 10);
            if (!Number.isNaN(parsedId)) {
                accounterId = parsedId;
            }
        }

        const { rows, count, limit, offset } = await fetchOrdersForRole(req, 'accounter', { accounterId });

        res.json({ orders: rows, pagination: { total: count, limit, offset } });
    } catch (error) {
        sendServerError(res, error, 'GET /api/orders/accounter');
    }
});

module.exports = router;
