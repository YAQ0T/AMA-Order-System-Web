const express = require('express');
const { Order, OrderItem, OrderLog, Notification, sequelize } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { buildOrderIncludes, sanitizeItems } = require('./order_helpers');
const { logActivity } = require('../utils/activityLogger');
const { logOrderEvent } = require('../utils/orderRequestLogger');
const { sendServerError, isBadInput } = require('../utils/serverError');

const router = express.Router();

const VALID_STATUSES = new Set([null, 'collected', 'unavailable']);

// Takers cannot see orders in these states (order_helpers.js hides them), so
// they should not be able to change them either.
const LOCKED_FOR_TAKERS = new Set(['completed', 'entered_erp']);

// Items are added and re-quantified only while the order is being worked on.
// A finished order is changed by the maker, through the edit window, which
// sends it back to its takers (routes/orders.js).
const WORKABLE = new Set(['pending', 'in-progress']);

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/**
 * Every change to an order's items goes through here first: lock the order
 * row (the same lock PUT /api/orders/:id and the claims take, so changes to
 * one order run one after another instead of interleaving), then check the
 * caller may touch it - the admin, the order's maker, or a taker on it.
 */
async function lockOrderForItems(orderId, user, transaction, { workableOnly = false } = {}) {
    const order = await Order.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!order) throw new HttpError(404, 'Order not found');

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
    if ((workableOnly && !WORKABLE.has(order.status)) || (!isAdmin && !isMaker && LOCKED_FOR_TAKERS.has(order.status))) {
        throw new HttpError(409, `Order is ${order.status} and can no longer be changed`);
    }
    return order;
}

/** Validate one item the way an order's items are validated; bad input is a 400. */
function cleanOne(item) {
    if (typeof item.name !== 'string' || !item.name.trim()) throw new HttpError(400, 'Item name is required');
    try {
        return sanitizeItems([item])[0];
    } catch (err) {
        if (isBadInput(err)) throw new HttpError(400, err.message);
        throw err;
    }
}

// Match names exactly in JS rather than with WHERE name = ?. The database
// collation (utf8mb4_unicode_ci) is case- and accent-insensitive for Latin
// text, so SQL equality would treat "Sugar" and "sugar" as the same item.
async function findItem(order, itemName, transaction) {
    const items = await OrderItem.findAll({ where: { orderId: order.id }, transaction });
    const item = items.find((i) => i.name === itemName);
    if (!item) throw new HttpError(404, `Item "${itemName}" not found in this order`);
    return { item, items };
}

/** A taker changed the items: the maker sees it in the app (the same message PUT used to send). */
const tellMaker = (order, user, transaction) => (user.role === 'taker'
    ? Notification.create({
        userId: order.makerId,
        message: `Order #${order.id} details updated by ${user.username}`,
        type: 'info',
        orderId: order.id
    }, { transaction })
    : null);

/**
 * Set the status of exactly ONE item in an order.
 *
 * Why this exists: PUT /api/orders/:id replaces the order's whole item list
 * with whatever the client sends. When two takers work the same order, each
 * sends the list as they last saw it, and the second write silently undoes the
 * first - verified against MySQL with two takers ticking different items at the
 * same moment. A single-row UPDATE cannot clobber an item it does not touch.
 * It also does not rotate item ids the way PUT's destroy + bulkCreate does.
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
        const order = await lockOrderForItems(orderId, user, transaction);
        const { item } = await findItem(order, itemName, transaction);

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

/**
 * Change the quantity of exactly ONE item. The taker's "edit quantity" used
 * to go through PUT with the whole item list as the taker's screen last showed
 * it - so a second quick edit, or another taker's edit at the same time, sent
 * an old quantity back and undid a newer one. This changes one row only.
 */
async function setItemQuantity({ orderId, itemName, quantity, user }) {
    const clean = cleanOne({ name: itemName, quantity });
    const transaction = await sequelize.transaction();
    try {
        const order = await lockOrderForItems(orderId, user, transaction, { workableOnly: true });
        const { item } = await findItem(order, itemName, transaction);

        const previous = Number(item.quantity);
        const changed = previous !== clean.quantity;
        if (changed) {
            await item.update({ quantity: clean.quantity }, { transaction });
            await OrderLog.create({
                orderId: order.id,
                previousDescription: String(previous),
                newDescription: `Updated ${item.name}: Qty ${previous} -> ${clean.quantity}`,
                changedBy: user.id
            }, { transaction });
            await tellMaker(order, user, transaction);
        }

        await transaction.commit();
        return { order, item, previous, changed };
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

/** Add ONE item to an order. Takers add without a price (they never see prices). */
async function addOrderItem({ orderId, name, quantity, price, user }) {
    const clean = cleanOne({ name, quantity, price: user.role === 'taker' ? null : price });
    const transaction = await sequelize.transaction();
    try {
        const order = await lockOrderForItems(orderId, user, transaction, { workableOnly: true });
        const items = await OrderItem.findAll({ where: { orderId: order.id }, transaction });
        if (items.some((i) => i.name.toLowerCase() === clean.name.toLowerCase())) {
            throw new HttpError(400, `Duplicate item "${clean.name}"`);
        }

        const item = await OrderItem.create({
            orderId: order.id,
            name: clean.name,
            quantity: clean.quantity,
            price: clean.price,
            status: null
        }, { transaction });
        await OrderLog.create({
            orderId: order.id,
            previousDescription: 'None',
            newDescription: `Added: ${clean.name} (Qty: ${clean.quantity})`,
            changedBy: user.id
        }, { transaction });
        await tellMaker(order, user, transaction);

        await transaction.commit();
        return { order, item };
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

const actorOf = (req) => ({ userId: req.user.id, username: req.user.username, role: req.user.role, ip: req.ip });

// Same shape the list endpoints return, so the client can drop it straight
// into its cache. Prices are stripped for takers as usual.
const reload = (orderId, role) => Order.findByPk(orderId, { include: buildOrderIncludes(role, { includeHistory: true }) });

function answerError(res, error, context) {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    sendServerError(res, error, context);
}

// PATCH /api/orders/:id/items/status   body: { name, status }
//
// Deliberately creates no in-app notification: a taker ticks every item, so
// it would fire once per item. The maker is told when the ORDER status
// changes (start / finish), which goes through PUT.
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
            await logOrderEvent('ORDER_ITEM_STATUS', { actor: actorOf(req), orderId: order.id, item: item.name, from: previous, to: body.status });
        }
        res.json(await reload(order.id, req.user.role));
    } catch (error) {
        answerError(res, error, 'PATCH /api/orders/:id/items/status');
    }
});

// PATCH /api/orders/:id/items/quantity   body: { name, quantity }
router.patch('/:id/items/quantity', authenticateToken, async (req, res) => {
    try {
        const body = req.body || {};
        const { order, item, previous, changed } = await setItemQuantity({
            orderId: req.params.id,
            itemName: body.name,
            quantity: body.quantity,
            user: req.user
        });
        if (changed) {
            await logActivity(req.user.id, 'order_item_quantity_changed', 'order', order.id, {
                item: item.name,
                from: previous,
                to: Number(item.quantity)
            }, req.ip);
            await logOrderEvent('ORDER_ITEM_QUANTITY', { actor: actorOf(req), orderId: order.id, item: item.name, from: previous, to: Number(item.quantity) });
        }
        res.json(await reload(order.id, req.user.role));
    } catch (error) {
        answerError(res, error, 'PATCH /api/orders/:id/items/quantity');
    }
});

// POST /api/orders/:id/items   body: { name, quantity, price? }
router.post('/:id/items', authenticateToken, async (req, res) => {
    try {
        const body = req.body || {};
        const { order, item } = await addOrderItem({
            orderId: req.params.id,
            name: body.name,
            quantity: body.quantity,
            price: body.price,
            user: req.user
        });
        await logActivity(req.user.id, 'order_item_added', 'order', order.id, { item: item.name, quantity: Number(item.quantity) }, req.ip);
        await logOrderEvent('ORDER_ITEM_ADDED', { actor: actorOf(req), orderId: order.id, item: item.name, quantity: Number(item.quantity) });
        res.status(201).json(await reload(order.id, req.user.role));
    } catch (error) {
        answerError(res, error, 'POST /api/orders/:id/items');
    }
});

module.exports = { router, setItemStatus, setItemQuantity, addOrderItem, HttpError };
