const express = require('express');
const router = express.Router();
const { OrderItem, sequelize } = require('../db');
const { Op } = require('sequelize');
const { authenticateToken } = require('../middleware/auth');

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
router.patch('/:itemId/status', authenticateToken, async (req, res) => {
    try {
        const { itemId } = req.params;
        const { status } = req.body;

        // Validate status value
        if (status !== null && status !== 'collected' && status !== 'unavailable') {
            return res.status(400).json({ error: 'Invalid status value. Must be null, "collected", or "unavailable"' });
        }

        const item = await OrderItem.findByPk(itemId);
        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        await item.update({ status });
        res.json(item);
    } catch (error) {
        console.error('Error updating item status:', error);
        res.status(500).json({ error: 'Failed to update item status' });
    }
});

module.exports = router;
