const express = require('express');
const router = express.Router();
const { OrderItem, sequelize } = require('../db');
const { Op } = require('sequelize');
const { authenticateToken } = require('../middleware/auth');
const { setItemStatus, HttpError } = require('./order_items');

// GET /api/items/suggestions?q=query
router.get('/suggestions', authenticateToken, async (req, res) => {
    try {
        const { q } = req.query;
        const whereClause = {};

        if (q) {
            whereClause.name = {
                [Op.like]: `%${q}%`
            };
        }

        // Fetch distinct product names
        // Using Sequelize aggregate to get distinct names is a bit tricky, 
        // so we'll use a simple findAll with attributes and group
        const items = await OrderItem.findAll({
            attributes: [
                [sequelize.fn('DISTINCT', sequelize.col('name')), 'name']
            ],
            where: whereClause,
            limit: 6,
            order: [['name', 'ASC']]
        });

        const suggestions = items.map(item => item.name);
        res.json(suggestions);
    } catch (error) {
        console.error('Error fetching item suggestions:', error);
        res.status(500).json({ error: 'Failed to fetch suggestions' });
    }
});

// PATCH /api/items/:itemId/status
//
// Legacy endpoint, kept for older clients. It used to let ANY logged-in user
// change ANY item on ANY order. It now goes through the same authorization,
// row lock and order-history logging as PATCH /api/orders/:id/items/status.
//
// Prefer the order-scoped endpoint: item ids rotate every time an order is
// saved through PUT (destroy + bulkCreate), so an id held by a client goes
// stale, whereas the item name is stable.
router.patch('/:itemId/status', authenticateToken, async (req, res) => {
    try {
        const item = await OrderItem.findByPk(req.params.itemId);
        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const result = await setItemStatus({
            orderId: item.orderId,
            itemName: item.name,
            status: req.body?.status,
            user: req.user
        });
        res.json(result.item);
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        console.error('Error updating item status:', error);
        res.status(500).json({ error: 'Failed to update item status' });
    }
});

module.exports = router;
