const express = require('express');
const { Order, User, OrderItem, OrderLog, Notification, sequelize } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { sendPushNotification } = require('../utils/push');
const telegram = require('../utils/telegram');
const { logActivity } = require('../utils/activityLogger');
const { logOrderEvent } = require('../utils/orderRequestLogger');
const { Op } = require('sequelize');
const { sanitizeItems, buildOrderIncludes, fetchOrdersForRole, isOpenOrder, assertTakerIds, escapeLike, orderFieldsProblem } = require('./order_helpers');

const router = express.Router();

const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip;
};

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

        let defaultDesc = 'New Order';
        if (sanitizedItems && sanitizedItems.length > 0) {
            defaultDesc = 'Order with ' + sanitizedItems.length + ' items';
        }

        const orderStatus = status === 'archived' ? 'archived' : 'pending';
        const normalizedAccounterId = accounterId === '' ? null : accounterId;
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
            if (normalizedAccounterId === undefined || normalizedAccounterId === null) {
                return res.status(400).json({ error: 'Active orders require an accounter' });
            }
            if (hasTakers) {
                try {
                    assignedTakerIds = await assertTakerIds(assignedTakerIds);
                } catch (err) {
                    return res.status(err.status || 400).json({ error: err.message });
                }
            }
        }

        if (normalizedAccounterId !== undefined && normalizedAccounterId !== null) {
            const accounter = await User.findByPk(normalizedAccounterId);
            if (!accounter || accounter.role !== 'accounter') {
                return res.status(400).json({ error: 'Invalid accounter selection' });
            }
        }

        transaction = await sequelize.transaction();

        const order = await Order.create({
            title,
            description: description || defaultDesc,
            makerId: req.user.id,
            status: orderStatus,
            city,
            accounterId: normalizedAccounterId
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
        console.error('Error creating order:', error);
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
        const isValidationError = [
            'Order must have',
            'Invalid quantity',
            'Invalid price',
            'Duplicate item',
            'missing a name',
            'too long'
        ].some(marker => (error.message || '').includes(marker)) || error.name === 'SequelizeValidationError';

        res.status(isValidationError ? 400 : 500).json({ error: error.message });
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
        console.error('Error fetching orders:', error);
        res.status(500).json({ error: error.message });
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

        const sentTakers = Array.isArray(assignedTakerIds) && assignedTakerIds.length > 0;
        if (wantsOpen && sentTakers) {
            return res.status(400).json({ error: 'An open order cannot also be assigned to takers' });
        }
        if (sentTakers) {
            try {
                assignedTakerIds = await assertTakerIds(assignedTakerIds);
            } catch (err) {
                return res.status(err.status || 400).json({ error: err.message });
            }
        }
        // openToAll means "nobody in particular": it clears the takers.
        const takerUpdate = wantsOpen ? [] : assignedTakerIds;

        const isUnarchiving = order.status === 'archived' && status && status !== 'archived';
        if (isUnarchiving) {
            if (!sentTakers && !wantsOpen) {
                return res.status(400).json({ error: 'Select at least one taker before activating an archived order' });
            }
            if (accounterId === undefined || accounterId === null || accounterId === '') {
                return res.status(400).json({ error: 'Select an accounter before activating an archived order' });
            }
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

        // Open orders: check the state this request would leave the order in,
        // against the row as it is NOW (read under the lock - a taker may have
        // just taken it).
        const wasOpen = isOpenOrder(order);
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

            // Log City Change
            if (req.body.city !== undefined && req.body.city !== order.city) {
                await OrderLog.create({
                    orderId: order.id,
                    previousDescription: order.city || 'None',
                    newDescription: `City: ${order.city || 'None'} -> ${req.body.city}`,
                    changedBy: req.user.id
                }, { transaction });
                order.city = req.body.city;
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

            // Log Description Change
            if (description && description !== order.description) {
                await OrderLog.create({
                    orderId: order.id,
                    previousDescription: order.description || 'None',
                    newDescription: `Desc: ${order.description || 'None'} -> ${description}`,
                    changedBy: req.user.id
                }, { transaction });
                order.description = description;
                changeSummary.push('description');
            }

            // Handle Items Update
            if (Array.isArray(items)) {
                const oldItems = order.Items || [];
                const newItems = sanitizedItems || [];

                const oldItemsMap = new Map(oldItems.map(i => [i.name, Number(i.quantity)]));
                const newItemsMap = new Map(newItems.map(i => [i.name, Number(i.quantity)]));

                // Track which items are updates vs additions
                const isUpdate = new Map();

                // Check for Updates and Additions
                for (const [name, newQty] of newItemsMap) {
                    if (oldItemsMap.has(name)) {
                        const oldQty = oldItemsMap.get(name);
                        isUpdate.set(name, true); // Mark as existing item
                        if (oldQty !== newQty) {
                            itemsChangedForTakers = true;
                            await OrderLog.create({
                                orderId: order.id,
                                previousDescription: String(oldQty),
                                newDescription: `Updated ${name}: Qty ${oldQty} -> ${newQty}`,
                                changedBy: req.user.id
                            }, { transaction });
                        }
                        oldItemsMap.delete(name); // processed
                    } else {
                        isUpdate.set(name, false); // Mark as new item
                        itemsChangedForTakers = true;
                        await OrderLog.create({
                            orderId: order.id,
                            previousDescription: 'None',
                            newDescription: `Added: ${name} (Qty: ${newQty})`,
                            changedBy: req.user.id
                        }, { transaction });
                    }
                }

                // Check for Removals (remaining items in oldItemsMap)
                for (const [name, oldQty] of oldItemsMap) {
                    itemsChangedForTakers = true;
                    await OrderLog.create({
                        orderId: order.id,
                        previousDescription: `${name} (${oldQty})`,
                        newDescription: `Removed: ${name}`,
                        changedBy: req.user.id
                    }, { transaction });
                }

                // Preserve status when not explicitly provided, but allow updates when sent
                const existingItemsStatus = new Map(
                    oldItems.map(item => [item.name, item.status ?? null])
                );
                const isTaker = req.user.role === 'taker';
                const existingItemsPriceByName = new Map();
                const existingItemsPriceById = new Map();
                if (isTaker) {
                    const pricedItems = await OrderItem.findAll({
                        where: { orderId: order.id },
                        attributes: ['id', 'name', 'price'],
                        transaction
                    });
                    pricedItems.forEach((item) => {
                        if (item.name) {
                            existingItemsPriceByName.set(item.name.toLowerCase(), item.price ?? null);
                        }
                        existingItemsPriceById.set(item.id, item.price ?? null);
                    });
                }

                // Remove old items and create new ones, keeping status changes sent from the client
                await OrderItem.destroy({ where: { orderId: order.id }, transaction });
                const orderItems = [];

                for (const item of newItems) {
                    const previouslyExisting = isUpdate.get(item.name);
                    const previousStatus = previouslyExisting ? (existingItemsStatus.get(item.name) ?? null) : null;
                    const nameKey = item.name.toLowerCase();
                    const statusProvided = statusProvidedByName.get(nameKey) ?? false;
                    const nextStatus = (previouslyExisting && !statusProvided)
                        ? previousStatus
                        : (item.status ?? null);
                    let nextPrice = item.price;
                    if (isTaker) {
                        const itemId = itemIdByName.get(nameKey);
                        if (itemId != null && existingItemsPriceById.has(itemId)) {
                            nextPrice = existingItemsPriceById.get(itemId);
                        } else if (existingItemsPriceByName.has(nameKey)) {
                            nextPrice = existingItemsPriceByName.get(nameKey);
                        } else {
                            nextPrice = null;
                        }
                    }

                    // Log status changes for existing items
                    if (previouslyExisting && previousStatus !== nextStatus) {
                        await OrderLog.create({
                            orderId: order.id,
                            previousDescription: `${item.name}: ${previousStatus || 'none'}`,
                            newDescription: `${item.name}: ${nextStatus || 'none'}`,
                            changedBy: req.user.id
                        }, { transaction });
                    }

                    orderItems.push({
                        ...item,
                        orderId: order.id,
                        status: nextStatus,
                        price: nextPrice
                    });
                }
                await OrderItem.bulkCreate(orderItems, { transaction });
                changeSummary.push('items');
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

        // Handle Status Update
        if (status) {
            // Validate entered_erp status can only be set by accounters, admins, or makers
            if (status === 'entered_erp' && !['accounter', 'admin', 'maker'].includes(req.user.role)) {
                if (transaction) {
                    await transaction.rollback();
                    transaction = null;
                }
                return res.status(403).json({ error: 'Only accounters, makers, or admins can set status to "Entered into ERP"' });
            }

            const oldStatus = order.status;
            order.status = status;
            if (oldStatus !== status) {
                changeSummary.push('status');
            }

            // If changing from 'archived' to 'pending' (Sending the order), notify takers
            if (oldStatus === 'archived' && status === 'pending') {
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
                    message: `Order #${order.id} status updated to '${status}' by ${req.user.username}`,
                    type: 'info',
                    orderId: order.id
                }, { transaction });
            }

            // If status changes to 'completed' and there's an assigned accounter, notify them
            if (status === 'completed' && oldStatus !== 'completed' && order.accounterId) {
                await Notification.create({
                    userId: order.accounterId,
                    message: `New completed order ready for review: Order #${order.id} - ${order.title || 'Untitled Order'}`,
                    type: 'alert',
                    orderId: order.id
                }, { transaction });

                accounterToNotify = order.accounterId;
            }
        }

        await order.save({ transaction });

        // Did anything a taker can see change? Prices are not visible to them,
        // and a save that changed nothing should not ping anyone's phone.
        const changedForTakers = itemsChangedForTakers ||
            changeSummary.some(c => c === 'title' || c === 'city' || c === 'description');

        // General Notification for Edits (Title/Description/Items)
        // If the maker (or an admin) edits, notify the takers who were already on the order
        // (newly added ones were just told they are assigned).
        if (editorIsManager && changedForTakers && order.status !== 'archived') {
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

        // There is no email. Makers and accountants are told through the
        // in-app notifications created inside the transaction above.
        //
        // When the MAKER (or an admin) changes an order, its takers are
        // messaged on Telegram (unless it is archived or already entered into
        // ERP). Whoever is new to the order - every taker, when an archived
        // order is sent out - gets "new order"; the others get "order updated",
        // and only if something they can see changed. One message each, never
        // both. Takers who have not linked Telegram see it in the app.
        const liveForTakers = !['archived', 'entered_erp'].includes(updatedOrder.status);
        if (editorIsManager && liveForTakers && updatedOrder.AssignedTakers && updatedOrder.AssignedTakers.length > 0) {
            const isSendOut = takersToNotifyOnResend.length > 0;
            const isNew = (t) => isSendOut || addedTakerIds.includes(t.id);
            const newcomers = updatedOrder.AssignedTakers.filter(isNew);
            const others = changedForTakers ? updatedOrder.AssignedTakers.filter(t => !isNew(t)) : [];

            if (newcomers.length || others.length) {
                const editor = await User.findByPk(req.user.id, { attributes: ['id', 'username'] });
                telegram.deliverTo(newcomers, () => telegram.orderAssignedMessage(updatedOrder, editor))
                    .catch(err => console.error('Error notifying newly assigned takers:', err));
                telegram.deliverTo(others, () => telegram.orderUpdatedMessage(updatedOrder, editor))
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
        console.error('Error updating order:', error);
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
        const isValidationError = [
            'Order must have',
            'Invalid quantity',
            'Invalid price',
            'Duplicate item',
            'missing a name',
            'too long'
        ].some(marker => (error.message || '').includes(marker)) || error.name === 'SequelizeValidationError';

        res.status(isValidationError ? 400 : 500).json({ error: error.message });
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
        console.error('Error fetching title suggestions:', error);
        res.status(500).json({ error: error.message });
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
        if (req.user.role !== 'maker') {
            return res.status(403).json({ error: 'Only makers can delete orders' });
        }

        const order = await Order.findByPk(req.params.id, {
            include: buildOrderIncludes(req.user.role, { includeHistory: false })
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.makerId !== req.user.id) {
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

        await logOrderEvent('ORDER_DELETE_SUCCESS', {
            actor: actorInfo,
            durationMs: Date.now() - deleteStartAt,
            orderId: Number(req.params.id),
            deletedOrder: summarizeOrderForLog(order)
        });

        res.json({ message: 'Order deleted successfully' });
    } catch (error) {
        console.error('Error deleting order:', error);
        await logOrderEvent('ORDER_DELETE_ERROR', {
            actor: actorInfo,
            durationMs: Date.now() - deleteStartAt,
            orderId: Number(req.params.id),
            error: {
                message: error.message,
                stack: error.stack
            }
        });
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
