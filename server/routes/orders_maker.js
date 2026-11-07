const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { fetchOrdersForRole } = require('./order_helpers');
const { sendServerError } = require('../utils/serverError');

const router = express.Router();

router.get('/maker', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'maker') {
            return res.status(403).json({ error: 'Only makers can view their orders' });
        }
        const { rows, count, limit, offset } = await fetchOrdersForRole(req, 'maker');
        res.json({
            orders: rows,
            pagination: { total: count, limit, offset }
        });
    } catch (error) {
        sendServerError(res, error, 'GET /api/orders/maker');
    }
});

module.exports = router;
