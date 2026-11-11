const express = require('express');
const { Order, OrderLog, sequelize } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { fetchOrdersForRole, fetchAvailableForAccounting, buildOrderIncludes, retireAccountingOffers } = require('./order_helpers');
const { logActivity } = require('../utils/activityLogger');
const { logOrderEvent } = require('../utils/orderRequestLogger');
const telegram = require('../utils/telegram');
const { sendServerError } = require('../utils/serverError');

const router = express.Router();

// How orders reach accountants: nobody picks an accountant when creating an
// order. Once its takers finish it (status "completed"), it is offered to
// every accountant (GET /accounter/available, plus a Telegram message). The
// first to take it (POST /:id/accounting-claim) gets it; it then sits in their
// own list (GET /accounter) until they enter it into ERP.

// An accountant's own orders (taken by them): completed + entered into ERP.
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

// Completed orders no accountant has taken yet.
router.get('/accounter/available', authenticateToken, async (req, res) => {
    try {
        if (!['accounter', 'admin'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Only accounters or admins can view ERP-entered orders' });
        }
        const { rows, count, limit, offset } = await fetchAvailableForAccounting(req);
        res.json({ orders: rows, pagination: { total: count, limit, offset } });
    } catch (error) {
        sendServerError(res, error, 'GET /api/orders/accounter/available');
    }
});

/**
 * POST /api/orders/:id/accounting-claim - an accountant takes a completed order.
 *
 * First come, first served, also when two accountants tap at the same moment:
 * the order row is locked FOR UPDATE before anything is read, so the second
 * one reads the first one's accountant and gets 409 (the same scheme as a
 * taker taking an open order, routes/orders_taker.js).
 */
router.post('/:id/accounting-claim', authenticateToken, async (req, res) => {
    if (req.user.role !== 'accounter') {
        return res.status(403).json({ error: 'Only accountants can take orders for accounting' });
    }
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(404).json({ error: 'Order not found' });
    }

    let transaction;
    try {
        transaction = await sequelize.transaction();
        const order = await Order.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
        const refuse = async (status, body) => {
            await transaction.rollback();
            transaction = null;
            return res.status(status).json(body);
        };
        if (!order) return refuse(404, { error: 'Order not found' });

        const alreadyMine = order.accounterId === req.user.id;
        if (!alreadyMine) {
            if (order.accounterId) {
                return refuse(409, { error: 'This order has already been taken by another accountant', code: 'ORDER_TAKEN' });
            }
            if (order.status !== 'completed') {
                return refuse(409, { error: 'This order is not ready for the accountant yet' });
            }
            order.accounterId = req.user.id;
            await order.save({ transaction });
            await OrderLog.create({
                orderId,
                previousDescription: 'Ready for accounting',
                newDescription: `Taken for accounting by ${req.user.username}`,
                changedBy: req.user.id
            }, { transaction });
        }

        await transaction.commit();
        transaction = null;

        if (!alreadyMine) {
            // Edit the "ready" messages the other accountants got.
            telegram.closeReadyForAccounting(orderId, { id: req.user.id, username: req.user.username })
                .catch((err) => console.error('Error updating ready-for-accounting messages:', err));
            // ...and the in-app offers, so their bells stop counting it.
            await retireAccountingOffers(orderId);
            await logActivity(req.user.id, 'order_accounting_claimed', 'order', orderId, { title: order.title }, req.ip);
            await logOrderEvent('ORDER_ACCOUNTING_CLAIM', {
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
                console.error('Rollback failed after accounting claim:', rollbackErr);
            }
        }
        sendServerError(res, error, 'POST /api/orders/:id/accounting-claim');
    }
});

module.exports = router;
