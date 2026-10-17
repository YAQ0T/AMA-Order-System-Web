const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { fetchOrdersForRole } = require('./order_helpers');

const router = express.Router();

router.get('/taker', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'taker') {
            return res.status(403).json({ error: 'Only takers can view their orders' });
        }
        const { rows, count, limit, offset } = await fetchOrdersForRole(req, 'taker');
        res.json({
            orders: rows,
            pagination: { total: count, limit, offset }
        });
    } catch (error) {
        console.error('Error fetching taker orders:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
