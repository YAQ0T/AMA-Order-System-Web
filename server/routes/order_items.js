const express = require('express');
const { Order, OrderItem, OrderLog, sequelize } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { buildOrderIncludes } = require('./order_helpers');
const { logActivity } = require('../utils/activityLogger');
const { logOrderEvent } = require('../utils/orderRequestLogger');

const router = express.Router();

const VALID_STATUSES = new Set([null, 'collected', 'unavailable']);

// Takers cannot see orders in these states (order_helpers.js hides them), so
// they should not be able to change them either.
const LOCKED_FOR_TAKERS = new Set(['completed', 'entered_erp']);

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/**
 * Set the status of exactly ONE item in an order.
 *
 * Why this exists: PUT /api/orders/:id replaces the order's whole item list
 * with whatever the client sends. When two takers work the same order, each
 * sends the list as they last saw it, and the second write silently undoes the
 * first - verified against MySQL with two takers ticking different items at the
 * same moment. A single-row UPDATE cannot clobber an item it does not touch, so
 * two takers ticking different items can no longer lose each other's work.
 *
 * It also does not rotate item ids the way PUT's destroy + bulkCreate does.
 *
 * Takes the same row lock on the order that the PUT handler takes, so a status
 * change and a full order edit on the same order run one after the other
 * instead of interleaving.
 */
async function setItemStatus({ orderId, itemName, status, user }) {
    if (!VALID_STATUSES.has(status)) {
        throw new HttpError(400, 'Invalid status value. Must be null, "collected", or "unavailable"');
    }
    if (typeof itemName !== 'string' || !itemName.trim()) {
        throw new HttpError(400, 'Item name is required');
    }

    const transaction = await sequelize.transaction();
    try {
        const order = await Order.findByPk(orderId, {
            transaction,
            lock: transaction.LOCK.UPDATE
        });
        if (!order) throw new HttpError(404, 'Order not found');

        // Same rule as the PUT handler: admin, the order's own maker, or a
        // taker assigned to it.
        const isAdmin = user.role === 'admin';
        const isMaker = order.makerId === user.id;
        let isAssigned = false;
        if (!isAdmin && !isMaker) {
            const takers = await order.getAssignedTakers({ attributes: ['id'], transaction });
            isAssigned = takers.some((t) => t.id === user.id);
        }
        if (!isAdmin && !isMaker && !isAssigned) {
            throw new HttpError(403, 'Not authorized to edit this order');
        }
        if (!isAdmin && !isMaker && LOCKED_FOR_TAKERS.has(order.status)) {
            throw new HttpError(409, `Order is ${order.status} and can no longer be changed`);
        }

        // Match the name exactly in JS rather than with WHERE name = ?. The
        // database collation (utf8mb4_unicode_ci) is case- and
        // accent-insensitive for Latin text, so SQL equality would treat
        // "Sugar" and "sugar", or "cafe" and "café", as the same item.
        // (Arabic letter variants such as أ/ا and ة/ه do stay distinct.)
        const items = await OrderItem.findAll({ where: { orderId: order.id }, transaction });
        const item = items.find((i) => i.name === itemName);
        if (!item) throw new HttpError(404, `Item "${itemName}" not found in this order`);

        const previous = item.status ?? null;
        const changed = previous !== status;

        if (changed) {
            await item.update({ status }, { transaction });
            // Same wording as the PUT handler's status log, so the order
            // history reads consistently whichever route made the change.
            await OrderLog.create({
                orderId: order.id,
                previousDescription: `${item.name}: ${previous || 'none'}`,
                newDescription: `${item.name}: ${status || 'none'}`,
                changedBy: user.id
            }, { transaction });
        }

        await transaction.commit();
        return { order, item, previous, changed };
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// PATCH /api/orders/:id/items/status   body: { name, status }
//
// Deliberately sends no email and creates no in-app notification: a taker
// ticks every item, so either would fire once per item. The maker is told when
// the ORDER status changes (start / finish), which still goes through PUT.
router.patch('/:id/items/status', authenticateToken, async (req, res) => {
    try {
        const body = req.body || {};
        if (!Object.prototype.hasOwnProperty.call(body, 'status')) {
            // Require the key so a malformed request can never silently clear
            // a status by omission.
            return res.status(400).json({ error: 'status is required (use null to clear it)' });
        }

        const { order, item, previous, changed } = await setItemStatus({
            orderId: req.params.id,
            itemName: body.name,
            status: body.status,
            user: req.user
        });

        if (changed) {
            await logActivity(req.user.id, 'order_item_status_changed', 'order', order.id, {
                item: item.name,
                from: previous,
                to: body.status
            }, req.ip);

            await logOrderEvent('ORDER_ITEM_STATUS', {
                actor: { userId: req.user.id, username: req.user.username, role: req.user.role, ip: req.ip },
                orderId: order.id,
                item: item.name,
                from: previous,
                to: body.status
            });
        }

        // Same shape the list endpoints return, so the client can drop it
        // straight into its cache. Prices are stripped for takers as usual.
        const updated = await Order.findByPk(order.id, {
            include: buildOrderIncludes(req.user.role, { includeHistory: true })
        });
        res.json(updated);
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        console.error('Error updating item status:', error);
        res.status(500).json({ error: 'Failed to update item status' });
    }
});

module.exports = { router, setItemStatus, HttpError };
