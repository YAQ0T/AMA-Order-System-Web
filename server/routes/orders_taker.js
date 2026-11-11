const express = require('express');
const { Order, OrderLog, Notification, OrderAssignments, User, sequelize } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { fetchOrdersForRole, fetchOpenOrders, buildOrderIncludes, assertTakerIds } = require('./order_helpers');
const { logActivity } = require('../utils/activityLogger');
const { logOrderEvent } = require('../utils/orderRequestLogger');
const telegram = require('../utils/telegram');
const { sendServerError, isBadInput } = require('../utils/serverError');

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
        sendServerError(res, error, 'GET /api/orders/taker');
    }
});

// GET /api/orders/open - orders left open to any taker (see isOpenOrder).
router.get('/open', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'taker') {
            return res.status(403).json({ error: 'Only takers can view open orders' });
        }
        const { rows, count, limit, offset } = await fetchOpenOrders(req);
        res.json({
            orders: rows,
            pagination: { total: count, limit, offset }
        });
    } catch (error) {
        sendServerError(res, error, 'GET /api/orders/open');
    }
});

/**
 * POST /api/orders/:id/claim - a taker takes an open order.
 *
 * First come, first served, and it must stay that way when two takers tap at
 * the same moment. The order row is locked FOR UPDATE before anything is read,
 * so concurrent claims on one order run strictly one after another. The second
 * one then reads the assignment the first one committed (its first plain read
 * happens after it got the lock, so its snapshot includes that commit) and gets
 * 409. The PUT handler takes the same lock, so a maker assigning the order at
 * the same moment cannot interleave with a claim either.
 */
router.post('/:id/claim', authenticateToken, async (req, res) => {
    if (req.user.role !== 'taker') {
        return res.status(403).json({ error: 'Only takers can take open orders' });
    }
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(404).json({ error: 'Order not found' });
    }

    let transaction;
    try {
        transaction = await sequelize.transaction();
        const order = await Order.findByPk(orderId, {
            transaction,
            lock: transaction.LOCK.UPDATE
        });
        if (!order) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Order not found' });
        }

        const assigned = await OrderAssignments.findAll({
            where: { orderId },
            attributes: ['userId'],
            transaction
        });

        const alreadyMine = assigned.some((a) => a.userId === req.user.id);
        if (!alreadyMine) {
            if (order.status !== 'pending' || assigned.length > 0) {
                await transaction.rollback();
                return res.status(409).json({
                    error: 'This order has already been taken',
                    code: 'ORDER_TAKEN'
                });
            }

            await OrderAssignments.create({ userId: req.user.id, orderId }, { transaction });
            await OrderLog.create({
                orderId,
                previousDescription: 'Open order',
                newDescription: `Taken by ${req.user.username}`,
                changedBy: req.user.id
            }, { transaction });
            await Notification.create({
                userId: order.makerId,
                // English like every stored notification; the app translates
                // it for display (client/src/lib/historyText.js).
                message: `Order #${orderId} was taken by ${req.user.username}: ${order.title || 'Untitled'}`,
                type: 'info',
                orderId
            }, { transaction });
        }

        await transaction.commit();
        transaction = null;

        if (!alreadyMine) {
            // Edit the "open order" messages other takers got, so nobody goes
            // looking for an order that is already gone.
            telegram.closeOpenOrder(orderId, { id: req.user.id, username: req.user.username })
                .catch((err) => console.error('Error updating open-order messages:', err));

            await logActivity(req.user.id, 'order_claimed', 'order', orderId, {
                title: order.title,
                city: order.city
            }, req.ip);
            await logOrderEvent('ORDER_CLAIM', {
                actor: { userId: req.user.id, username: req.user.username, role: req.user.role, ip: req.ip },
                orderId
            });
        }

        const claimed = await Order.findByPk(orderId, {
            include: buildOrderIncludes(req.user.role, { includeHistory: true })
        });
        res.json(claimed);
    } catch (error) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackErr) {
                console.error('Rollback failed after claim error:', rollbackErr);
            }
        }
        console.error('Error claiming order:', error);
        res.status(500).json({ error: 'Failed to take the order' });
    }
});

/**
 * POST /api/orders/:id/helpers   body: { takerIds: [...] }
 *
 * A taker on an order brings other takers in to help. Helpers become takers of
 * the order like any other: they see it under «طلباتي» and can tick items,
 * change quantities, add items, bring in more helpers and finish it. Only
 * adding - taking someone off an order stays the maker's (or admin's) call,
 * through the order's edit window.
 */
router.post('/:id/helpers', authenticateToken, async (req, res) => {
    if (req.user.role !== 'taker') {
        return res.status(403).json({ error: 'Only takers can add helpers' });
    }
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(404).json({ error: 'Order not found' });
    }

    let transaction;
    try {
        transaction = await sequelize.transaction();
        // The same row lock as claims and edits: two takers adding helpers at
        // once, or a maker re-assigning meanwhile, run one after the other.
        const order = await Order.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
        const refuse = async (status, error) => {
            await transaction.rollback();
            transaction = null;
            return res.status(status).json({ error });
        };
        if (!order) return refuse(404, 'Order not found');

        const assigned = (await OrderAssignments.findAll({ where: { orderId }, attributes: ['userId'], transaction }))
            .map((a) => a.userId);
        if (!assigned.includes(req.user.id)) return refuse(403, 'Not authorized to edit this order');
        if (!['pending', 'in-progress'].includes(order.status)) {
            return refuse(409, `Order is ${order.status} and can no longer be changed`);
        }

        let ids;
        try {
            ids = await assertTakerIds(req.body?.takerIds, { transaction });
        } catch (err) {
            if (!isBadInput(err)) throw err;
            return refuse(400, err.message);
        }
        const addedIds = ids.filter((id) => !assigned.includes(id));
        let added = [];
        if (addedIds.length) {
            await OrderAssignments.bulkCreate(addedIds.map((userId) => ({ userId, orderId })), { transaction });
            added = await User.findAll({ where: { id: addedIds }, attributes: ['id', 'username'], transaction });
            const names = added.map((u) => u.username).sort().join(', ');
            await OrderLog.create({
                orderId,
                previousDescription: 'Takers',
                newDescription: `Added takers: ${names}`,
                changedBy: req.user.id
            }, { transaction });
            // English like every stored notification; the app translates them
            // (client/src/lib/historyText.js).
            await Notification.bulkCreate(addedIds.map((userId) => ({
                userId,
                message: `${req.user.username} added you to order #${orderId}: ${order.title || 'Untitled'}`,
                type: 'alert',
                orderId
            })), { transaction });
            await Notification.create({
                userId: order.makerId,
                message: `Order #${orderId}: ${req.user.username} added ${names} to help`,
                type: 'info',
                orderId
            }, { transaction });
        }

        await transaction.commit();
        transaction = null;

        const updated = await Order.findByPk(orderId, {
            include: buildOrderIncludes(req.user.role, { includeHistory: true })
        });
        if (added.length) {
            telegram.deliverTo(added, () => telegram.orderHelperMessage(updated, req.user))
                .catch((err) => console.error('Error telling the helpers on Telegram:', err));
            await logActivity(req.user.id, 'order_helpers_added', 'order', orderId, { added: added.map((u) => u.username) }, req.ip);
            await logOrderEvent('ORDER_HELPERS_ADDED', {
                actor: { userId: req.user.id, username: req.user.username, role: req.user.role, ip: req.ip },
                orderId,
                added: added.map((u) => u.username)
            });
        }
        res.json(updated);
    } catch (error) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackErr) {
                console.error('Rollback failed after adding helpers:', rollbackErr);
            }
        }
        sendServerError(res, error, 'POST /api/orders/:id/helpers');
    }
});

module.exports = router;
