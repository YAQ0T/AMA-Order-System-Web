const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { fetchOrdersForRole } = require('./order_helpers');
const { sendServerError } = require('../utils/serverError');

const router = express.Router();

router.get('/admin', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admins can view all orders' });
        }
        const { rows, count, limit, offset } = await fetchOrdersForRole(req, 'admin');
        res.json({
            orders: rows,
            pagination: { total: count, limit, offset }
        });
    } catch (error) {
        sendServerError(res, error, 'GET /api/orders/admin');
    }
});

module.exports = router;
