const express = require('express');
const { Order, User, OrderItem, OrderLog, Notification, sequelize } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { sendPushNotification } = require('../utils/push');
const telegram = require('../utils/telegram');
const { logActivity } = require('../utils/activityLogger');
const { logOrderEvent } = require('../utils/orderRequestLogger');
const { Op } = require('sequelize');
const { sanitizeItems, buildOrderIncludes, fetchOrdersForRole, isOpenOrder, assertTakerIds, escapeLike, orderFieldsProblem, mergeItemEdits, parseBaseItems, accountingOfferMessage, retireAccountingOffers, sameNumber, PRICE_LOG_MARK, priceLogText } = require('./order_helpers');
const { sendServerError, isBadInput } = require('../utils/serverError');

const router = express.Router();

// req.ip already holds the visitor's real address behind the tunnel
// ('trust proxy' in index.js). Reading X-Forwarded-For directly, as this used
// to, let anyone on the network write whatever address they liked into the log.
const getClientIp = (req) => req.ip;

const buildActorInfo = (req) => ({
    userId: req.user?.id ?? null,
    username: req.user?.username ?? null,
    role: req.user?.role ?? null,
    ip: getClientIp(req)
});

const summarizeItemsForLog = (items, limit = 10) => {
    if (!Array.isArray(items)) {
        return { count: 0, sample: [] };
    }

    return {
        count: items.length,
        sample: items.slice(0, limit).map((item) => ({
            id: item?.id ?? null,
            name: item?.name ?? null,
            quantity: item?.quantity ?? null,
            price: item?.price ?? null,
            status: item?.status ?? null
        }))
    };
};

const summarizeOrderForLog = (order) => ({
    orderId: order?.id ?? null,
    customerName: order?.title ?? null,
    description: order?.description ?? null,
    city: order?.city ?? null,
    status: order?.status ?? null,
    makerId: order?.makerId ?? null,
    accounterId: order?.accounterId ?? null,
    assignedTakerIds: Array.isArray(order?.AssignedTakers) ? order.AssignedTakers.map((t) => t.id) : [],
    itemCount: Array.isArray(order?.Items) ? order.Items.length : 0,
    items: summarizeItemsForLog(order?.Items || []).sample
});

const summarizeUpdateRequestForLog = (body = {}) => ({
    title: body.title,
    description: body.description,
    city: body.city,
    status: body.status,
    assignedTakerIds: body.assignedTakerIds,
    accounterId: body.accounterId,
    notifyMaker: body.notifyMaker,
    notifyAccounter: body.notifyAccounter,
    items: summarizeItemsForLog(body.items)
});

const buildItemsDiffForLog = (oldItems = [], newItems = []) => {
    const oldMap = new Map();
    const newMap = new Map();

    oldItems.forEach((item) => {
        const key = (item?.name || '').trim().toLowerCase();
        if (key) oldMap.set(key, item);
    });

    newItems.forEach((item) => {
        const key = (item?.name || '').trim().toLowerCase();
        if (key) newMap.set(key, item);
    });

    let added = 0;
    let removed = 0;
    let quantityChanged = 0;
    let statusChanged = 0;
    const changedQuantityItems = [];
    const changedStatusItems = [];

    for (const [name, oldItem] of oldMap.entries()) {
        if (!newMap.has(name)) {
            removed += 1;
            continue;
        }

        const newItem = newMap.get(name);
        const oldQty = Number(oldItem?.quantity);
        const newQty = Number(newItem?.quantity);
        if (oldQty !== newQty) {
            quantityChanged += 1;
            changedQuantityItems.push({
                name: newItem?.name || oldItem?.name || name,
                from: oldQty,
                to: newQty
            });
        }

        const oldStatus = oldItem?.status ?? null;
        const newStatus = newItem?.status ?? null;
        if (oldStatus !== newStatus) {
            statusChanged += 1;
            changedStatusItems.push({
                name: newItem?.name || oldItem?.name || name,
                from: oldStatus,
                to: newStatus
            });
        }
    }

    for (const name of newMap.keys()) {
        if (!oldMap.has(name)) added += 1;
    }

    return {
        oldCount: oldItems.length,
        newCount: newItems.length,
        added,
        removed,
        quantityChanged,
        statusChanged,
        quantityChangesSample: changedQuantityItems.slice(0, 10),
        statusChangesSample: changedStatusItems.slice(0, 10)
    };
};

// Create Order (Maker only)
router.post('/', authenticateToken, async (req, res) => {
    let transaction;
    const createStartAt = Date.now();
    const actorInfo = buildActorInfo(req);
    try {
        if (!['maker', 'admin'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Only makers or admins can create orders' });
        }

        const { title, description, items, city, status, accounterId, openToAll } = req.body;
        let { assignedTakerIds } = req.body;
        await logOrderEvent('ORDER_CREATE_START', {
            actor: actorInfo,
            request: summarizeUpdateRequestForLog(req.body)
        });

        const fieldsProblem = orderFieldsProblem({ title, description, city });
        if (fieldsProblem) return res.status(400).json({ error: fieldsProblem });

        const sanitizedItems = sanitizeItems(items || []);

        const orderStatus = status === 'archived' ? 'archived' : 'pending';
        // Nobody picks the accountant any more: the order is offered to every
        // accountant once it is completed (routes/orders_accounter.js). An
        // accounterId sent anyway (older clients) is still honoured.
        const normalizedAccounterId = accounterId === '' || accounterId === undefined ? null : accounterId;
        // An order that goes out needs its city - takers sort their work by
        // it. (A draft may still lack one; it is checked when sent out.)
        if (orderStatus !== 'archived' && !(typeof city === 'string' && city.trim())) {
            return res.status(400).json({ error: 'Choose a city' });
        }
        // An open order goes to no one in particular: the first taker to take
        // it gets it (POST /api/orders/:id/claim). It has to be asked for
        // explicitly, so a maker who simply forgot to pick a taker is still
        // stopped by the check below instead of creating an open order.
        const isOpen = orderStatus !== 'archived' && openToAll === true;

        if (orderStatus !== 'archived') {
            const hasTakers = Array.isArray(assignedTakerIds) && assignedTakerIds.length > 0;
            if (isOpen && hasTakers) {
                return res.status(400).json({ error: 'An open order cannot also be assigned to takers' });
            }
            if (!isOpen && !hasTakers) {
                return res.status(400).json({ error: 'Active orders require at least one taker' });
            }
            if (hasTakers) {
                try {
                    assignedTakerIds = await assertTakerIds(assignedTakerIds);
                } catch (err) {
                    // A database fault is not the sender's mistake: let the outer catch answer.
                    if (!isBadInput(err)) throw err;
                    return res.status(400).json({ error: err.message });
                }
            }
        }

        if (normalizedAccounterId !== null) {
            const accounter = await User.findByPk(normalizedAccounterId);
            if (!accounter || accounter.role !== 'accounter') {
                return res.status(400).json({ error: 'Invalid accounter selection' });
            }
        }

        transaction = await sequelize.transaction();

        const order = await Order.create({
            title,
            // No description is stored as none. It used to become an English
            // "Order with 3 items", which every screen and Telegram message showed.
            description: (typeof description === 'string' && description.trim()) || null,
            makerId: req.user.id,
            status: orderStatus,
            // No city is stored as none ('' is not one of the cities).
            city: (typeof city === 'string' && city.trim()) || null,
            accounterId: normalizedAccounterId,
            isOnline: req.body.isOnline === true,
            // Every order an admin creates is urgent; nobody else can ask for it.
            isUrgent: req.user.role === 'admin'
        }, { transaction });

        // Only assign takers if NOT archived
        if (orderStatus !== 'archived' && assignedTakerIds && assignedTakerIds.length > 0) {
            await order.setAssignedTakers(assignedTakerIds, { transaction });
        }

        if (sanitizedItems && sanitizedItems.length > 0) {
            const orderItems = sanitizedItems.map(item => ({
                ...item,
                orderId: order.id
            }));
            await OrderItem.bulkCreate(orderItems, { transaction });
        }

        await transaction.commit();

        // Fetch complete order with associations for response
        const completeOrder = await Order.findByPk(order.id, {
            include: buildOrderIncludes(req.user.role, {
                makerAttrs: ['id', 'username']
            })
        });

        // Notify takers after successful commit
        if (orderStatus !== 'archived' && assignedTakerIds && assignedTakerIds.length > 0) {
            const notifications = assignedTakerIds.map(id => ({
                userId: id,
                message: 'New Order Assigned: ' + (order.title || 'Untitled Order'),
                type: 'alert',
                orderId: order.id
            }));
            await Notification.bulkCreate(notifications);

            // Send Push Notifications
            assignedTakerIds.forEach(id => {
                sendPushNotification(id, {
                    title: 'New Order Assigned',
                    body: `You have been assigned to order #${order.id}: ${order.title || 'Untitled Order'}`,
                    url: `/`
                });
            });
        }

        // Message the assigned takers on Telegram. Anyone who has not linked it
        // still has the in-app notification created just above.
        if (completeOrder.AssignedTakers && completeOrder.AssignedTakers.length > 0) {
            const maker = await User.findByPk(req.user.id, { attributes: ['id', 'username'] });
            telegram.deliverTo(completeOrder.AssignedTakers, () => telegram.orderAssignedMessage(completeOrder, maker))
                .catch(err => {
                    console.error('Error notifying takers of new order:', err);
                });
        }

        // An open order is offered to every linked taker at once. Takers who
        // have not linked Telegram see it in the app's "open orders" tab.
        if (isOpen) {
            const maker = await User.findByPk(req.user.id, { attributes: ['id', 'username'] });
            telegram.broadcastOpenOrder(completeOrder, maker).catch(err => {
                console.error('Error announcing open order:', err);
            });
        }

        await logActivity(req.user.id, 'order_created', 'order', order.id, {
            status: orderStatus,
            openToAll: isOpen,
            isOnline: order.isOnline,
            isUrgent: order.isUrgent,
            city,
            itemCount: sanitizedItems?.length || 0,
            assignedTakers: assignedTakerIds || [],
            assignedTakerNames: assignedTakerIds && assignedTakerIds.length > 0 ? await Promise.all(assignedTakerIds.map(async id => {
                const u = await User.findByPk(id, { attributes: ['username'] });
                return u ? u.username : id;
            })) : [],
            items: sanitizedItems
        }, req.ip);

        await logOrderEvent('ORDER_CREATE_SUCCESS', {
            actor: actorInfo,
            durationMs: Date.now() - createStartAt,
            order: summarizeOrderForLog(completeOrder)
        });

        res.status(201).json(completeOrder);
    } catch (error) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackErr) {
                console.error('Rollback failed after create error:', rollbackErr);
            }
        }
        await logOrderEvent('ORDER_CREATE_ERROR', {
            actor: actorInfo,
            durationMs: Date.now() - createStartAt,
            request: summarizeUpdateRequestForLog(req.body),
            error: {
                message: error.message,
                stack: error.stack
            }
        });
        await logActivity(req.user?.id, 'order_error', 'order', null, { message: error.message, phase: 'create' }, req.ip);

        // Bad input (an item without a name, a duplicate, a price that is not
        // a number) is the sender's to fix: say what is wrong. Anything else
        // is a fault here, and its details stay in the log.
        if (isBadInput(error)) return res.status(400).json({ error: error.message });
        sendServerError(res, error, 'POST /api/orders');
    }
});

// Get Orders (For current user)
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { rows, count, limit, offset } = await fetchOrdersForRole(req, req.user.role);
        res.json({
            orders: rows,
            pagination: {
                total: count,
                limit,
                offset
            }
        });
    } catch (error) {
        sendServerError(res, error, 'GET /api/orders');
    }
});

// Update Order Status, Title, Description, Items, Assigned Takers
router.put('/:id', authenticateToken, async (req, res) => {
    let transaction;
    const updateStartAt = Date.now();
    const actorInfo = buildActorInfo(req);
    let beforeOrderSnapshot = null;
    let beforeItemsSnapshot = [];
    try {
        await logOrderEvent('ORDER_UPDATE_START', {
            actor: actorInfo,
            orderId: Number(req.params.id),
            request: summarizeUpdateRequestForLog(req.body)
        });

        const { status, title, description, items, accounterId, openToAll } = req.body;
        let { assignedTakerIds } = req.body;
        const wantsOpen = openToAll === true;
        const editorIsManager = req.user.role === 'maker' || req.user.role === 'admin';

        // Track which incoming items explicitly included a status field (even if null)
        const statusProvidedByName = new Map();
        const itemIdByName = new Map();
        if (Array.isArray(items)) {
            for (const rawItem of items) {
                const rawName = (rawItem.name || '').trim();
                if (!rawName) continue;
                statusProvidedByName.set(rawName.toLowerCase(), Object.prototype.hasOwnProperty.call(rawItem, 'status'));
                const rawId = rawItem.id;
                if (rawId !== undefined && rawId !== null && rawId !== '') {
                    const parsedId = Number(rawId);
                    if (Number.isFinite(parsedId)) {
                        itemIdByName.set(rawName.toLowerCase(), parsedId);
                    }
                }
            }
        }

        const fieldsProblem = orderFieldsProblem({ title, description, city: req.body.city });
        if (fieldsProblem) return res.status(400).json({ error: fieldsProblem });

        const sanitizedItems = Array.isArray(items) ? sanitizeItems(items) : null;
        let takersToNotifyOnResend = [];
        let accounterToNotify = null;
        const changeSummary = [];

        let order = await Order.findByPk(req.params.id, {
            include: buildOrderIncludes(req.user.role, {
                makerAttrs: ['id', 'username', 'role'],
                assignedTakerAttrs: ['id', 'username']
            })
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        beforeOrderSnapshot = summarizeOrderForLog(order);
        beforeItemsSnapshot = Array.isArray(order.Items)
            ? order.Items.map((item) => ({
                id: item.id,
                name: item.name,
                quantity: Number(item.quantity),
                status: item.status ?? null
            }))
            : [];

        if (req.user.role === 'accounter') {
            if (order.accounterId !== req.user.id) {
                return res.status(403).json({ error: 'Not authorized to process this order' });
            }

            if (status !== 'entered_erp') {
                return res.status(400).json({ error: 'Accounter can only mark orders as entered to ERP' });
            }

            if (!['completed', 'entered_erp'].includes(order.status)) {
                return res.status(400).json({ error: 'Order must be completed before entering ERP' });
            }

            transaction = await sequelize.transaction();
            const lockedOrder = await Order.findByPk(req.params.id, {
                transaction,
                lock: transaction.LOCK.UPDATE
            });

            if (!lockedOrder) {
                await transaction.rollback();
                transaction = null;
                return res.status(404).json({ error: 'Order not found' });
            }
            order = await Order.findByPk(req.params.id, {
                include: buildOrderIncludes(req.user.role, {
                    makerAttrs: ['id', 'username', 'role'],
                    assignedTakerAttrs: ['id', 'username']
                }),
                transaction
            });

            const previousStatus = order.status;

            if (order.status !== 'entered_erp') {
                await OrderLog.create({
                    orderId: order.id,
                    previousDescription: order.status,
                    newDescription: `Status: ${order.status} -> entered_erp`,
                    changedBy: req.user.id
                }, { transaction });
            }

            order.status = 'entered_erp';
            await order.save({ transaction });

            await transaction.commit();
            transaction = null;

            const updatedOrder = await Order.findByPk(order.id, {
                include: buildOrderIncludes(req.user.role, {})
            });

            await logActivity(req.user.id, 'order_status_changed', 'order', order.id, {
                from: previousStatus,
                to: 'entered_erp'
            }, req.ip);

            await logOrderEvent('ORDER_UPDATE_SUCCESS', {
                actor: actorInfo,
                durationMs: Date.now() - updateStartAt,
                orderId: order.id,
                changedFields: ['status'],
                statusChange: {
                    from: previousStatus,
                    to: 'entered_erp'
                },
                request: summarizeUpdateRequestForLog(req.body),
                before: beforeOrderSnapshot,
                after: summarizeOrderForLog(updatedOrder),
                itemsDiff: buildItemsDiffForLog(beforeItemsSnapshot, updatedOrder.Items || [])
            });

            return res.json(updatedOrder);
        }

        const isAdmin = req.user.role === 'admin';
        const isMaker = order.makerId === req.user.id;
        const isAssigned = (order.AssignedTakers || []).some(taker => taker.id === req.user.id);

        if (!isAdmin && !isMaker && !isAssigned) {
            return res.status(403).json({ error: 'Not authorized to edit this order' });
        }

        // The maker who created an order can always change it, also after it
        // was entered into ERP (and the admin can change any order). Every
        // change goes into the order's history; after ERP the history says so
        // too, and the accountant who entered it is told (see below). Takers
        // are done with it by then.
        if (order.status === 'entered_erp' && !isAdmin && !isMaker) {
            return res.status(409).json({ error: 'Order is entered_erp and can no longer be changed' });
        }
        const isTakerEdit = !isMaker && !isAdmin;
        // A finished order is no longer the takers' to change: if it needs
        // changes, the maker sends it back to them (the "reopen" below).
        if (isTakerEdit && order.status === 'completed') {
            return res.status(409).json({ error: 'Order is completed and can no longer be changed' });
        }
        // Takers only move an order forward: start it, finish it.
        if (isTakerEdit && status && status !== order.status) {
            const forward = { pending: ['in-progress', 'completed'], 'in-progress': ['completed'] };
            if (!(forward[order.status] || []).includes(status)) {
                return res.status(400).json({ error: 'This status change is not allowed' });
            }
        }

        // Who works on an order is the maker's decision: a taker must not be
        // able to hand an order to someone else, or drop it.
        if (!isMaker && !isAdmin && (openToAll !== undefined || assignedTakerIds !== undefined)) {
            const currentIds = (order.AssignedTakers || []).map(t => t.id).sort().join(',');
            const sentIds = Array.isArray(assignedTakerIds) ? [...assignedTakerIds].map(Number).sort().join(',') : null;
            if (openToAll !== undefined || sentIds !== currentIds) {
                return res.status(403).json({ error: 'Only makers or admins can assign takers' });
            }
            assignedTakerIds = undefined; // unchanged - nothing to do
        }

        // The order's marks: "online" is the maker's to set, "urgent" the admin's.
        if (req.body.isOnline !== undefined && !isMaker && !isAdmin) {
            return res.status(403).json({ error: 'Only makers or admins can change the online mark' });
        }
        if (req.body.isUrgent !== undefined && !isAdmin) {
            return res.status(403).json({ error: 'Only an admin can change the urgent mark' });
        }
        // A taker works on the items (adds one, changes a quantity, ticks them
        // off) and moves the status on. The customer, description and city are
        // the maker's; the app never offers a taker to change them.
        if (!isMaker && !isAdmin && (title !== undefined || description !== undefined || req.body.city !== undefined)) {
            return res.status(403).json({ error: 'Only makers or admins can change the order details' });
        }

        const sentTakers = Array.isArray(assignedTakerIds) && assignedTakerIds.length > 0;
        if (wantsOpen && sentTakers) {
            return res.status(400).json({ error: 'An open order cannot also be assigned to takers' });
        }
        if (sentTakers) {
            try {
                assignedTakerIds = await assertTakerIds(assignedTakerIds);
            } catch (err) {
                // A database fault is not the sender's mistake: let the outer catch answer.
                if (!isBadInput(err)) throw err;
                return res.status(400).json({ error: err.message });
            }
        }
        // openToAll means "nobody in particular": it clears the takers.
        const takerUpdate = wantsOpen ? [] : assignedTakerIds;

        const isUnarchiving = order.status === 'archived' && status && status !== 'archived';
        if (isUnarchiving) {
            if (!sentTakers && !wantsOpen) {
                return res.status(400).json({ error: 'Select at least one taker before activating an archived order' });
            }
        }
        // An order that is out (or being sent out) keeps a city. The maker
        // cannot clear it, and a draft without one cannot be sent out.
        const cityAfter = req.body.city !== undefined ? req.body.city : order.city;
        const hasCityAfter = typeof cityAfter === 'string' && cityAfter.trim() !== '';
        const staysDraft = status ? status === 'archived' : order.status === 'archived';
        if (!hasCityAfter && !staysDraft && (isUnarchiving || req.body.city !== undefined)) {
            return res.status(400).json({ error: 'Choose a city' });
        }

        transaction = await sequelize.transaction();
        const lockedOrder = await Order.findByPk(req.params.id, {
            transaction,
            lock: transaction.LOCK.UPDATE
        });

        if (!lockedOrder) {
            await transaction.rollback();
            transaction = null;
            return res.status(404).json({ error: 'Order not found' });
        }
        order = await Order.findByPk(req.params.id, {
            include: buildOrderIncludes(req.user.role, {
                makerAttrs: ['id', 'username', 'role'],
                assignedTakerAttrs: ['id', 'username']
            }),
            transaction
        });

        // The status and accountant as they are NOW (read under the lock), before this save.
        const statusBefore = order.status;
        const accounterBefore = order.accounterId;
        // Open orders: check the state this request would leave the order in,
        // against the row as it is NOW (read under the lock - a taker may have
        // just taken it).
        const wasOpen = isOpenOrder(order);
        // Likewise for accountants: completed and not taken by any of them yet.
        const offeredBefore = order.status === 'completed' && !order.accounterId;
        const currentTakerIds = (order.AssignedTakers || []).map(t => t.id);
        const nextTakerIds = takerUpdate !== undefined ? (takerUpdate || []) : currentTakerIds;
        const nextStatus = status || order.status;
        let releaseToOpen = false;
        if ((nextStatus === 'pending' || nextStatus === 'in-progress') && nextTakerIds.length === 0) {
            let refusal = null;
            if (!status && order.status === 'in-progress' && wantsOpen) {
                // The maker takes an order away from whoever was working on
                // it and puts it back up for anyone: it starts over as pending.
                releaseToOpen = true;
            } else if (nextStatus === 'in-progress') {
                refusal = 'An order in progress needs a taker';
            } else if (!wantsOpen && !wasOpen) {
                refusal = isUnarchiving
                    ? 'Select at least one taker before activating an archived order'
                    : 'Active orders require at least one taker';
            }
            if (refusal) {
                await transaction.rollback();
                transaction = null;
                return res.status(400).json({ error: refusal });
            }
        }
        let addedTakerIds = [];
        let itemsChangedForTakers = false;

        // Handle Details Update (Title, Description, Items, City)
        if (title !== undefined || description !== undefined || items !== undefined || takerUpdate !== undefined || req.body.city !== undefined) {
            // Log Title Change
            if (title && title !== order.title) {
                await OrderLog.create({
                    orderId: order.id,
                    previousDescription: order.title || 'None',
                    newDescription: `Title: ${order.title || 'None'} -> ${title}`,
                    changedBy: req.user.id
                }, { transaction });
                order.title = title;
                changeSummary.push('title');
            }

            // Log City Change ('' or null = no city; only a draft may have none, see above)
            const cityValue = req.body.city === undefined ? undefined : ((typeof req.body.city === 'string' && req.body.city.trim()) || null);
            if (cityValue !== undefined && cityValue !== (order.city || null)) {
                await OrderLog.create({
                    orderId: order.id,
                    previousDescription: order.city || 'None',
                    newDescription: `City: ${order.city || 'None'} -> ${cityValue || 'None'}`,
                    changedBy: req.user.id
                }, { transaction });
                order.city = cityValue;
                changeSummary.push('city');
            }

            // Handle Accounter assignment (Maker/Admin only)
            if (req.body.accounterId !== undefined) {
                if (!isMaker && !isAdmin) {
                    if (transaction) {
                        await transaction.rollback();
                        transaction = null;
                    }
                    return res.status(403).json({ error: 'Only makers or admins can assign an accounter' });
                }

                if (req.body.accounterId === null || req.body.accounterId === '') {
                    order.accounterId = null;
                } else {
                    const newAccounter = await User.findByPk(req.body.accounterId);
                    if (!newAccounter || newAccounter.role !== 'accounter') {
                        if (transaction) {
                            await transaction.rollback();
                            transaction = null;
                        }
                        return res.status(400).json({ error: 'Invalid accounter selected' });
                    }
                    order.accounterId = req.body.accounterId;
                }
                changeSummary.push('accounter');
            }

            // Log Description Change. An emptied box (null or '') clears the
            // description - it used to be ignored, so the old text came back.
            // Leaving the field out keeps it.
            const newDescription = description === undefined ? undefined : ((description || '').trim() || null);
            if (newDescription !== undefined && newDescription !== (order.description || null)) {
                await OrderLog.create({
                    orderId: order.id,
                    previousDescription: order.description || 'None',
                    newDescription: `Desc: ${order.description || 'None'} -> ${newDescription || 'None'}`,
                    changedBy: req.user.id
                }, { transaction });
                order.description = newDescription;
                changeSummary.push('description');
            }

            // Handle Items Update
            if (Array.isArray(items)) {
                const oldItems = order.Items || []; // read under the lock
                const newItems = sanitizedItems || [];
                const isTaker = req.user.role === 'taker';
                const oldByName = new Map(oldItems.map((i) => [i.name, i]));

                // What the items become. The app's edit window also sends the
                // items it STARTED from (baseItems): only what the maker
                // actually changed is applied, so whatever takers changed in
                // the meantime - a quantity, a newly added item - is kept
                // instead of being written over with the window's old copy.
                let finalItems;
                if (editorIsManager && Array.isArray(req.body.baseItems)) {
                    finalItems = mergeItemEdits({ current: oldItems, base: parseBaseItems(req.body.baseItems), next: newItems });
                } else {
                    // The whole list as sent (older clients, scripts).
                    let storedPrices = null;
                    if (isTaker) {
                        // Takers never receive prices: keep the stored ones.
                        const priced = await OrderItem.findAll({ where: { orderId: order.id }, attributes: ['id', 'name', 'price'], transaction });
                        storedPrices = { byId: new Map(priced.map((i) => [i.id, i.price ?? null])), byName: new Map(priced.map((i) => [i.name.toLowerCase(), i.price ?? null])) };
                    }
                    finalItems = newItems.map((item) => {
                        const before = oldByName.get(item.name);
                        const key = item.name.toLowerCase();
                        let status = before && !(statusProvidedByName.get(key) ?? false) ? (before.status ?? null) : (item.status ?? null);
                        // The maker changed the quantity: the item needs checking again.
                        if (editorIsManager && before && !(statusProvidedByName.get(key) ?? false) && Number(before.quantity) !== item.quantity) status = null;
                        let price = item.price;
                        if (storedPrices) {
                            const id = itemIdByName.get(key);
                            price = id != null && storedPrices.byId.has(id) ? storedPrices.byId.get(id) : (storedPrices.byName.get(key) ?? null);
                        }
                        return { name: item.name, quantity: item.quantity, price, status };
                    });
                }

                // The order's history: what was added, removed, re-quantified,
                // re-priced, (un)ticked. Prices only for the maker / admin: a
                // taker's copy of the order has none to compare (and takers
                // cannot change them - their stored prices are kept above).
                const log = (previousDescription, newDescription) => OrderLog.create({ orderId: order.id, previousDescription, newDescription, changedBy: req.user.id }, { transaction });
                let itemsChanged = false;
                const finalNames = new Set(finalItems.map((i) => i.name));
                for (const item of finalItems) {
                    const before = oldByName.get(item.name);
                    if (!before) {
                        itemsChangedForTakers = true;
                        itemsChanged = true;
                        await log('None', `Added: ${item.name} (Qty: ${item.quantity})`);
                        if (editorIsManager && item.price != null) await log(PRICE_LOG_MARK, priceLogText(item.name, null, item.price));
                        continue;
                    }
                    const oldQty = Number(before.quantity);
                    if (oldQty !== item.quantity) {
                        itemsChangedForTakers = true;
                        itemsChanged = true;
                        await log(String(oldQty), `Updated ${item.name}: Qty ${oldQty} -> ${item.quantity}`);
                    }
                    if (editorIsManager && !sameNumber(before.price, item.price)) {
                        itemsChanged = true;
                        await log(PRICE_LOG_MARK, priceLogText(item.name, before.price, item.price));
                    }
                    if ((before.status ?? null) !== (item.status ?? null)) {
                        itemsChanged = true;
                        await log(`${item.name}: ${before.status || 'none'}`, `${item.name}: ${item.status || 'none'}`);
                    }
                }
                for (const before of oldItems) {
                    if (finalNames.has(before.name)) continue;
                    itemsChangedForTakers = true;
                    itemsChanged = true;
                    await log(`${before.name} (${Number(before.quantity)})`, `Removed: ${before.name}`);
                }

                await OrderItem.destroy({ where: { orderId: order.id }, transaction });
                await OrderItem.bulkCreate(finalItems.map((item) => ({ ...item, orderId: order.id })), { transaction });
                if (itemsChanged) changeSummary.push('items');
            }

            // Handle Assigned Takers Update
            if (takerUpdate !== undefined) {
                const newTakerIds = nextTakerIds;

                const isDifferent =
                    currentTakerIds.length !== newTakerIds.length ||
                    !currentTakerIds.every(id => newTakerIds.includes(id));

                if (isDifferent) {
                    await order.setAssignedTakers(newTakerIds, { transaction });

                    // Log the change
                    await OrderLog.create({
                        orderId: order.id,
                        previousDescription: 'Takers Updated',
                        newDescription: newTakerIds.length === 0 ? 'Opened to any taker' : 'Updated Assigned Takers',
                        changedBy: req.user.id
                    }, { transaction });

                    // Notify New Takers
                    addedTakerIds = newTakerIds.filter(id => !currentTakerIds.includes(id));
                    if (addedTakerIds.length > 0 && order.status !== 'archived') {
                        await Notification.bulkCreate(
                            addedTakerIds.map(id => ({
                                userId: id,
                                message: `You have been assigned to order #${order.id}: ${order.title || 'Untitled'}`,
                                type: 'alert',
                                orderId: order.id
                            })),
                            { transaction }
                        );
                    }

                    changeSummary.push('assignedTakers');
                }
            }
        }

        for (const [field, markedText, clearedText] of [
            ['isOnline', 'Marked online', 'Online mark removed'],
            ['isUrgent', 'Marked urgent', 'Urgent mark removed']
        ]) {
            const next = req.body[field];
            if (typeof next === 'boolean' && next !== Boolean(order[field])) {
                await OrderLog.create({
                    orderId: order.id,
                    previousDescription: String(Boolean(order[field])),
                    newDescription: next ? markedText : clearedText,
                    changedBy: req.user.id
                }, { transaction });
                order[field] = next;
                changeSummary.push(field);
            }
        }

        if (releaseToOpen) {
            await OrderLog.create({
                orderId: order.id,
                previousDescription: order.status,
                newDescription: `Status: ${order.status} -> pending`,
                changedBy: req.user.id
            }, { transaction });
            order.status = 'pending';
            changeSummary.push('status');
        }

        // Sending a finished order back. When the maker (or admin) changes the
        // items of a completed order - or one already entered into ERP - or
        // sets it back to pending / in progress, it goes back to the same
        // takers, shows up in their lists again, and whatever changed has lost
        // its tick (see the items above). If an accountant had taken it, it
        // returns to that accountant once done (to enter into ERP again).
        const wasDone = statusBefore === 'completed' || statusBefore === 'entered_erp';
        const reopened = wasDone && editorIsManager && (
            (status ? ['pending', 'in-progress'].includes(status) : itemsChangedForTakers)
        );
        let targetStatus = status;
        if (reopened && !status) targetStatus = nextTakerIds.length ? 'in-progress' : 'pending';
        // Ready for an accountant and nobody has taken it: offered to them all.
        let offerToAccountants = false;
        let accountantsToTell = [];

        // Handle Status Update
        if (targetStatus) {
            // Validate entered_erp status can only be set by accounters, admins, or makers
            if (targetStatus === 'entered_erp' && !['accounter', 'admin', 'maker'].includes(req.user.role)) {
                if (transaction) {
                    await transaction.rollback();
                    transaction = null;
                }
                return res.status(403).json({ error: 'Only accounters, makers, or admins can set status to "Entered into ERP"' });
            }

            const oldStatus = order.status;
            order.status = targetStatus;
            if (oldStatus !== targetStatus) {
                changeSummary.push('status');
                await OrderLog.create({
                    orderId: order.id,
                    previousDescription: oldStatus,
                    newDescription: `Status: ${oldStatus} -> ${targetStatus}`,
                    changedBy: req.user.id
                }, { transaction });
            }
            if (reopened) {
                await OrderLog.create({
                    orderId: order.id,
                    previousDescription: statusBefore,
                    newDescription: 'Sent back to the takers',
                    changedBy: req.user.id
                }, { transaction });
            }
            // If changing from 'archived' to 'pending' (Sending the order), notify takers
            if (oldStatus === 'archived' && targetStatus === 'pending') {
                // Refresh the sent timestamp when an archived order is re-sent
                order.createdAt = new Date();

                const currentTakers = await order.getAssignedTakers({ transaction });
                if (currentTakers.length > 0) {
                    await Notification.bulkCreate(
                        currentTakers.map(t => ({
                            userId: t.id,
                            message: `New Order Assigned: ${order.title || 'Untitled Order'}`,
                            type: 'alert',
                            orderId: order.id
                        })),
                        { transaction }
                    );

                    takersToNotifyOnResend = currentTakers.map(t => t.id);
                }
            }

            // If Taker updates status, notify Maker
            if (req.user.role === 'taker') {
                await Notification.create({
                    userId: order.makerId,
                    message: `Order #${order.id} status updated to '${targetStatus}' by ${req.user.username}`,
                    type: 'info',
                    orderId: order.id
                }, { transaction });
            }

            // Just completed. If an accountant already has it (they took it
            // before the order was sent back, or an older order), it goes to
            // them; otherwise it is offered to every accountant.
            if (targetStatus === 'completed' && oldStatus !== 'completed') {
                if (order.accounterId) {
                    await Notification.create({
                        userId: order.accounterId,
                        message: `New completed order ready for review: Order #${order.id} - ${order.title || 'Untitled Order'}`,
                        type: 'alert',
                        orderId: order.id
                    }, { transaction });
                    accounterToNotify = order.accounterId;
                } else {
                    offerToAccountants = true;
                    const accountants = await User.findAll({ where: { role: 'accounter', isApproved: true }, attributes: ['id'], transaction });
                    if (accountants.length) {
                        await Notification.bulkCreate(accountants.map((a) => ({
                            userId: a.id,
                            message: accountingOfferMessage(order),
                            type: 'alert',
                            orderId: order.id
                        })), { transaction });
                    }
                }
            }

            if (reopened) {
                const takers = await order.getAssignedTakers({ attributes: ['id'], transaction });
                if (takers.length) {
                    await Notification.bulkCreate(takers.map((t) => ({
                        userId: t.id,
                        message: `Order #${order.id} was sent back to you for changes by ${req.user.username}`,
                        type: 'alert',
                        orderId: order.id
                    })), { transaction });
                }
                if (order.accounterId) {
                    accountantsToTell = [order.accounterId];
                    await Notification.create({
                        userId: order.accounterId,
                        message: `Order #${order.id} was sent back to the takers by ${req.user.username}; it returns to you when completed`,
                        type: 'info',
                        orderId: order.id
                    }, { transaction });
                }
            }
        }

        // Changed after it was entered into ERP. The history says so (written
        // last, so it heads this save's entries), and the accountant who
        // entered it is told: ERP may need the same change. When it went back
        // to the takers, or back to "completed", they were told above already.
        let accountantToTellOfErpEdit = null;
        if (statusBefore === 'entered_erp' && changeSummary.length > 0) {
            await OrderLog.create({
                orderId: order.id,
                previousDescription: 'entered_erp',
                newDescription: 'Changed after it was entered into ERP',
                changedBy: req.user.id
            }, { transaction });
            const toldAlready = reopened || order.status === 'completed';
            if (!toldAlready && accounterBefore && accounterBefore !== req.user.id) {
                accountantToTellOfErpEdit = accounterBefore;
                await Notification.create({
                    userId: accounterBefore,
                    message: `Order #${order.id} was changed by ${req.user.username} after it was entered into ERP`,
                    type: 'alert',
                    orderId: order.id
                }, { transaction });
            }
        }

        await order.save({ transaction });

        // Did anything a taker can see change? Prices are not visible to them,
        // and a save that changed nothing should not ping anyone's phone.
        const changedForTakers = itemsChangedForTakers ||
            changeSummary.some(c => ['title', 'city', 'description', 'isOnline', 'isUrgent'].includes(c));
        // Only while the order is theirs to work on: once it is finished (or
        // a draft), a new customer name or city is no news to its takers.
        const liveForTakersNow = order.status === 'pending' || order.status === 'in-progress';

        // General Notification for Edits (Title/Description/Items)
        // If the maker (or an admin) edits, notify the takers who were already on the order
        // (newly added ones were just told they are assigned; a sent-back order
        // already told its takers above).
        if (editorIsManager && changedForTakers && !reopened && liveForTakersNow) {
            const currentTakers = await order.getAssignedTakers({ transaction });
            const toTell = currentTakers.filter(t => !addedTakerIds.includes(t.id));
            if (toTell.length > 0) {
                await Notification.bulkCreate(
                    toTell.map(t => ({
                        userId: t.id,
                        message: `Order #${order.id} was updated by Maker`,
                        type: 'info',
                        orderId: order.id
                    })),
                    { transaction }
                );
            }
        }

        // If Taker edits details, notify Maker
        if (
            req.user.role === 'taker' &&
            (req.body.title || req.body.description || req.body.items || req.body.assignedTakerIds || req.body.city)
        ) {
            await Notification.create({
                userId: order.makerId,
                message: `Order #${order.id} details updated by ${req.user.username}`,
                type: 'info',
                orderId: order.id
            }, { transaction });
        }

        await transaction.commit();
        transaction = null;

        // Reload to get full data including recent logs
        const updatedOrder = await Order.findByPk(order.id, {
            include: buildOrderIncludes(req.user.role, { includeHistory: true, historyLimit: 5 })
        });

        await logActivity(req.user.id, 'order_updated', 'order', order.id, {
            changes: changeSummary,
            status: updatedOrder.status,
            itemCount: updatedOrder.Items?.length || 0,
            city: updatedOrder.city
        }, req.ip);

        await logOrderEvent('ORDER_UPDATE_SUCCESS', {
            actor: actorInfo,
            durationMs: Date.now() - updateStartAt,
            orderId: order.id,
            changedFields: changeSummary,
            statusChange: {
                from: beforeOrderSnapshot?.status ?? null,
                to: updatedOrder.status ?? null
            },
            request: summarizeUpdateRequestForLog(req.body),
            before: beforeOrderSnapshot,
            after: summarizeOrderForLog(updatedOrder),
            itemsDiff: buildItemsDiffForLog(beforeItemsSnapshot, updatedOrder.Items || [])
        });

        // Send push notifications after successful commit
        if (takersToNotifyOnResend.length > 0) {
            takersToNotifyOnResend.forEach(id => {
                sendPushNotification(id, {
                    title: 'New Order Assigned',
                    body: `You have been assigned to order #${order.id}: ${order.title || 'Untitled Order'}`,
                    url: `/`
                });
            });
        }

        // The order just became completed: tell its accountant on Telegram that
        // it is ready to enter into ERP (if they have linked Telegram - the
        // in-app notification was created inside the transaction either way).
        if (accounterToNotify) {
            sendPushNotification(accounterToNotify, {
                title: 'New Completed Order',
                body: `Order #${order.id}: ${order.title || 'Untitled Order'} is ready for review`,
                url: `/`
            });

            const accounter = await User.findByPk(accounterToNotify, { attributes: ['id', 'username'] });
            if (accounter) {
                telegram.deliverTo([accounter], () => telegram.orderReadyForErpMessage(updatedOrder), { path: '/accounter' })
                    .catch(err => {
                        console.error('Error notifying accountant of completed order:', err);
                    });
            }
        }

        // Completed with no accountant yet: offer it to every accountant.
        if (offerToAccountants) {
            telegram.broadcastReadyForAccounting(updatedOrder)
                .catch(err => console.error('Error offering the order to accountants:', err));
        }
        // It was on offer and is not any more (sent back, archived, entered
        // into ERP, given an accountant): edit the messages that offered it.
        const offeredNow = updatedOrder.status === 'completed' && !updatedOrder.accounterId;
        if (offeredBefore && !offeredNow) {
            telegram.closeReadyForAccounting(order.id, null, { reopened })
                .catch(err => console.error('Error updating ready-for-accounting messages:', err));
            await retireAccountingOffers(order.id);
        }
        // Sent back while an accountant had it: tell them it comes back later.
        if (accountantsToTell.length) {
            const editor = { id: req.user.id, username: req.user.username };
            const accountants = await User.findAll({ where: { id: accountantsToTell }, attributes: ['id', 'username'] });
            telegram.deliverTo(accountants, () => telegram.orderReopenedForAccountantMessage(updatedOrder, editor), { path: '/accounter' })
                .catch(err => console.error('Error telling the accountant the order was sent back:', err));
        }
        // Changed after it was entered into ERP: tell the accountant who entered it.
        if (accountantToTellOfErpEdit) {
            const editor = { id: req.user.id, username: req.user.username };
            const accountant = await User.findByPk(accountantToTellOfErpEdit, { attributes: ['id', 'username'] });
            if (accountant) {
                telegram.deliverTo([accountant], () => telegram.orderChangedAfterErpMessage(updatedOrder, editor), { path: '/accounter/erp' })
                    .catch(err => console.error('Error telling the accountant of a change after ERP:', err));
            }
        }

        // There is no email. Makers and accountants are told through the
        // in-app notifications created inside the transaction above.
        //
        // When the MAKER (or an admin) changes an order, its takers are
        // messaged on Telegram - while it is theirs to work on (pending or in
        // progress: not a draft, and not once it is finished). Whoever is new
        // to the order - every taker, when an archived order is sent out -
        // gets "new order"; the others get "order updated", and only if
        // something they can see changed. One message each, never both.
        // Takers who have not linked Telegram see it in the app.
        const liveForTakers = ['pending', 'in-progress'].includes(updatedOrder.status);
        if (editorIsManager && liveForTakers && updatedOrder.AssignedTakers && updatedOrder.AssignedTakers.length > 0) {
            const isSendOut = takersToNotifyOnResend.length > 0;
            const isNew = (t) => isSendOut || addedTakerIds.includes(t.id);
            const newcomers = updatedOrder.AssignedTakers.filter(isNew);
            // A sent-back order always tells its takers, even when only the
            // status changed; otherwise only if something they see changed.
            const others = changedForTakers || reopened ? updatedOrder.AssignedTakers.filter(t => !isNew(t)) : [];

            if (newcomers.length || others.length) {
                const editor = await User.findByPk(req.user.id, { attributes: ['id', 'username'] });
                telegram.deliverTo(newcomers, () => telegram.orderAssignedMessage(updatedOrder, editor))
                    .catch(err => console.error('Error notifying newly assigned takers:', err));
                telegram.deliverTo(others, () => (reopened
                    ? telegram.orderReopenedMessage(updatedOrder, editor)
                    : telegram.orderUpdatedMessage(updatedOrder, editor)))
                    .catch(err => console.error('Error notifying takers of order update:', err));
            }
        }

        // The order just became open (created archived and sent out open, or
        // released by the maker): offer it to every linked taker. Or it just
        // stopped being open (the maker assigned it or archived it): update
        // the messages that offered it.
        const isOpenNow = isOpenOrder(updatedOrder);
        if (!wasOpen && isOpenNow) {
            const editor = await User.findByPk(req.user.id, { attributes: ['id', 'username'] });
            telegram.broadcastOpenOrder(updatedOrder, editor)
                .catch(err => console.error('Error announcing open order:', err));
        } else if (wasOpen && !isOpenNow) {
            telegram.closeOpenOrder(order.id, null)
                .catch(err => console.error('Error updating open-order messages:', err));
        }

        res.json(updatedOrder);
    } catch (error) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackErr) {
                console.error('Rollback failed after update error:', rollbackErr);
            }
        }
        await logOrderEvent('ORDER_UPDATE_ERROR', {
            actor: actorInfo,
            durationMs: Date.now() - updateStartAt,
            orderId: Number(req.params.id),
            request: summarizeUpdateRequestForLog(req.body),
            error: {
                message: error.message,
                stack: error.stack
            }
        });
        await logActivity(req.user?.id, 'order_error', 'order', req.params.id, { message: error.message, phase: 'update' }, req.ip);

        if (isBadInput(error)) return res.status(400).json({ error: error.message });
        sendServerError(res, error, 'PUT /api/orders/:id');
    }
});

// GET /api/orders/suggestions - Get order title suggestions
router.get('/suggestions', authenticateToken, async (req, res) => {
    try {
        const { q } = req.query;

        if (!q) {
            return res.json([]);
        }

        const suggestions = await Order.findAll({
            attributes: [[sequelize.fn('DISTINCT', sequelize.col('title')), 'title']],
            where: {
                makerId: req.user.id,
                title: {
                    [Op.like]: `%${escapeLike(q)}%`
                }
            },
            limit: 6,
            raw: true
        });

        res.json(suggestions.map(s => s.title));
    } catch (error) {
        sendServerError(res, error, 'GET /api/orders/suggestions');
    }
});

// DELETE /api/orders/:id - Delete an order
router.delete('/:id', authenticateToken, async (req, res) => {
    const deleteStartAt = Date.now();
    const actorInfo = buildActorInfo(req);
    try {
        await logOrderEvent('ORDER_DELETE_START', {
            actor: actorInfo,
            orderId: Number(req.params.id)
        });
        // A maker deletes their own orders; the admin any order. (The admin
        // screen's delete button calls this route, which used to refuse admins.)
        const isAdmin = req.user.role === 'admin';
        if (req.user.role !== 'maker' && !isAdmin) {
            return res.status(403).json({ error: 'Only makers or admins can delete orders' });
        }

        const order = await Order.findByPk(req.params.id, {
            include: buildOrderIncludes(req.user.role, { includeHistory: false })
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (!isAdmin && order.makerId !== req.user.id) {
            return res.status(403).json({ error: 'You can only delete your own orders' });
        }

        const wasOpen = isOpenOrder(order);

        // Delete associated items and logs first (manual cascade), all or
        // nothing: a failure half-way must not leave an order without items.
        await sequelize.transaction(async (transaction) => {
            await OrderItem.destroy({ where: { orderId: order.id }, transaction });
            await OrderLog.destroy({ where: { orderId: order.id }, transaction });
            await order.destroy({ transaction });
        });

        if (wasOpen) {
            telegram.closeOpenOrder(order.id, null)
                .catch(err => console.error('Error updating open-order messages:', err));
        }
        if (order.status === 'completed' && !order.accounterId) {
            telegram.closeReadyForAccounting(order.id, null)
                .catch(err => console.error('Error updating ready-for-accounting messages:', err));
            await retireAccountingOffers(order.id);
        }

        await logOrderEvent('ORDER_DELETE_SUCCESS', {
            actor: actorInfo,
            durationMs: Date.now() - deleteStartAt,
            orderId: Number(req.params.id),
            deletedOrder: summarizeOrderForLog(order)
        });

        res.json({ message: 'Order deleted successfully' });
    } catch (error) {
        await logOrderEvent('ORDER_DELETE_ERROR', {
            actor: actorInfo,
            durationMs: Date.now() - deleteStartAt,
            orderId: Number(req.params.id),
            error: {
                message: error.message,
                stack: error.stack
            }
        });
        sendServerError(res, error, 'DELETE /api/orders/:id');
    }
});

module.exports = router;
