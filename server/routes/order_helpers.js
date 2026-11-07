const { Op } = require('sequelize');
const { Order, OrderLog, User, sequelize } = require('../db');
const { badRequest } = require('../utils/serverError');

/**
 * An "open" order is active (pending) with no taker assigned: any taker may
 * take it, first come first served (POST /api/orders/:id/claim). There is no
 * column for this - it is derived from the status and the assignments, so an
 * order can never be both "open" and assigned to someone.
 */
const isOpenOrder = (order) =>
    order?.status === 'pending' && (order.AssignedTakers || []).length === 0;

/**
 * Throws a 400-style error unless every id belongs to an approved taker. Without
 * this, any user id - a maker, an accountant, a deleted account - could be
 * "assigned" to an order and the order would silently reach nobody.
 */
const assertTakerIds = async (ids, { transaction } = {}) => {
    if (!Array.isArray(ids)) throw badRequest('assignedTakerIds must be a list');
    // Only whole numbers or their text: Number(true) is 1, which would quietly
    // pick user #1.
    if (ids.some((id) => typeof id !== 'number' && typeof id !== 'string')) {
        throw badRequest('Invalid taker selection');
    }
    const unique = [...new Set(ids.map(Number))];
    if (unique.some((id) => !Number.isInteger(id) || id <= 0)) throw badRequest('Invalid taker selection');
    if (unique.length === 0) return unique;
    const found = await User.count({
        where: { id: unique, role: 'taker', isApproved: true },
        transaction
    });
    if (found !== unique.length) throw badRequest('Invalid taker selection');
    return unique;
};

const getItemAttributesForRole = (role) => {
    const baseAttributes = ['id', 'name', 'quantity', 'status', 'createdAt', 'updatedAt'];
    if (['maker', 'admin', 'accounter'].includes(role)) {
        return [...baseAttributes, 'price'];
    }
    return baseAttributes;
};

// The values OrderItems.status (an ENUM) accepts; null is "not marked yet".
const ITEM_STATUSES = new Set(['collected', 'unavailable']);

/**
 * Checks and tidies the items of an order. Anything wrong is thrown as a 400
 * (badRequest) saying which item and what - the route sends that message on.
 * Malformed input (a row that is not an object, a name that is a list...)
 * must be refused the same way: it used to crash here and come back as a 500.
 */
const sanitizeItems = (items, { allowEmpty = false } = {}) => {
    if (!Array.isArray(items)) throw badRequest('Items must be a list');

    const cleaned = [];
    const seenNames = new Set();
    const numericPattern = /^(?:\d+\.?\d*|\.\d+)$/;
    // A quantity or price is typed as text in the form, or sent as a number.
    const isNumberLike = (v) => v === undefined || v === null || typeof v === 'string' || typeof v === 'number';

    for (const [index, rawItem] of items.entries()) {
        if (rawItem === null || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
            throw badRequest(`Item ${index + 1} is invalid`);
        }
        const rawName = typeof rawItem.name === 'number' ? String(rawItem.name) : rawItem.name;
        if (rawName != null && typeof rawName !== 'string') {
            throw badRequest(`Item ${index + 1} is invalid`);
        }
        if (!isNumberLike(rawItem.quantity) || !isNumberLike(rawItem.price)) {
            throw badRequest(`Item ${index + 1} is invalid`);
        }

        const name = (rawName || '').trim();
        const priceRaw = typeof rawItem.price === 'string' ? rawItem.price.trim() : rawItem.price;
        const quantityRaw = typeof rawItem.quantity === 'string' ? rawItem.quantity.trim() : rawItem.quantity;

        // Skip completely empty rows the UI might send
        if (!name && (quantityRaw === undefined || quantityRaw === null || quantityRaw === '')) {
            continue;
        }

        if (!name) {
            throw badRequest(`Item ${index + 1} is missing a name`);
        }
        // OrderItems.name is VARCHAR(255). MySQL refuses longer values outright,
        // which used to surface as a bare 500.
        if (name.length > 255) {
            throw badRequest(`Item name is too long (max 255 characters): "${name.slice(0, 40)}..."`);
        }

        if (typeof quantityRaw === 'string' && !numericPattern.test(quantityRaw)) {
            throw badRequest(`Invalid quantity for "${name}"`);
        }
        const quantityNum = Number(quantityRaw);
        const hasPrice = priceRaw !== '' && priceRaw !== undefined && priceRaw !== null;
        let priceNum = null;
        if (hasPrice) {
            if (typeof priceRaw === 'string' && !numericPattern.test(priceRaw)) {
                throw badRequest(`Invalid price for "${name}"`);
            }
            const priceNumRaw = Number(priceRaw);
            // DECIMAL(10,2): at most 99,999,999.99.
            if (!Number.isFinite(priceNumRaw) || priceNumRaw < 0 || priceNumRaw >= 1e8) {
                throw badRequest(`Invalid price for "${name}"`);
            }
            priceNum = priceNumRaw;
        }
        const normalizedQuantity = Number.isFinite(quantityNum)
            ? Math.round(quantityNum * 1000) / 1000
            : quantityNum;

        // DECIMAL(10,3): at most 9,999,999.999. Checked after rounding to 3
        // places, so 0.0004 (stored as 0) is refused too.
        if (!Number.isFinite(quantityNum) || normalizedQuantity <= 0 || quantityNum >= 1e7) {
            throw badRequest(`Invalid quantity for "${name}"`);
        }

        const normalizedName = name.toLowerCase();
        if (seenNames.has(normalizedName)) {
            throw badRequest(`Duplicate item "${name}"`);
        }
        seenNames.add(normalizedName);

        const status = rawItem.status === '' || rawItem.status === undefined ? null : rawItem.status ?? null;
        if (status !== null && !ITEM_STATUSES.has(status)) {
            throw badRequest(`Item ${index + 1} is invalid`);
        }

        cleaned.push({
            name,
            quantity: normalizedQuantity,
            price: priceNum,
            status
        });
    }

    if (!allowEmpty && cleaned.length === 0) {
        throw badRequest('Order must have at least one item');
    }

    return cleaned;
};

const buildOrderIncludes = (role, options = {}) => {
    const { includeHistory = false, makerAttrs, assignedTakerAttrs, historyLimit } = options;

    // Email addresses are never included: nothing sends email any more, and
    // these objects are returned to every client that loads an order.
    const makerAttributes = makerAttrs || ['id', 'username', 'role'];
    const assignedAttributes = assignedTakerAttrs || ['id', 'username'];
    const accounterAttributes = ['id', 'username', 'role'];

    const includes = [
        { association: Order.associations.Maker, attributes: makerAttributes },
        { association: Order.associations.AssignedTakers, attributes: assignedAttributes, through: { attributes: [] } },
        { association: Order.associations.Accounter, attributes: accounterAttributes },
        { association: Order.associations.Items, attributes: getItemAttributesForRole(role), separate: true, order: [['id', 'ASC']] }
    ];

    if (includeHistory) {
        includes.push({
            association: Order.associations.History,
            attributes: ['id', 'previousDescription', 'newDescription', 'createdAt', 'changedBy'],
            include: [{ association: OrderLog.associations.Editor, attributes: ['id', 'username'] }],
            separate: true,
            limit: historyLimit,
            order: [['createdAt', 'DESC'], ['id', 'DESC']]
        });
    }

    return includes;
};

// createdAt is stored to the second, and sending out a batch of archived orders
// stamps them all with the same second. Without a tie-breaker MySQL may order
// those ties differently on each query, so paging could skip or repeat orders.
const NEWEST_FIRST = [['createdAt', 'DESC'], ['id', 'DESC']];

/**
 * Make user text match literally inside LIKE: without this, searching for
 * "50%" or "a_b" treats % and _ as wildcards (a lone "%" matched everything).
 * Backslash is MySQL's default LIKE escape character.
 */
const escapeLike = (text) => String(text).replace(/[\\%_]/g, (c) => `\\${c}`);

/** Field checks shared by create and edit, so bad input is a 400, not a database error. */
const ORDER_TITLE_MAX = 255;
const ORDER_DESCRIPTION_MAX = 5000;
const orderFieldsProblem = ({ title, description, city }) => {
    if (title != null && (typeof title !== 'string' || title.length > ORDER_TITLE_MAX)) {
        return `Customer name is too long (max ${ORDER_TITLE_MAX} characters)`;
    }
    if (description != null && (typeof description !== 'string' || description.length > ORDER_DESCRIPTION_MAX)) {
        return `Description is too long (max ${ORDER_DESCRIPTION_MAX} characters)`;
    }
    if (city != null && city !== '') {
        const allowed = Order.rawAttributes.city?.validate?.isIn?.[0] || [];
        if (!allowed.includes(city)) return 'Invalid city';
    }
    return null;
};

// A negative LIMIT or OFFSET is an SQL syntax error, so clamp rather than pass it on.
const getPaginationParams = (req) => {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 20, 20));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    return { limit, offset };
};

const buildSearchWhere = (req, { forceActiveStatuses = false } = {}) => {
    const where = {};
    const requestedStatus = req.query.status;

    if (forceActiveStatuses) {
        // Server-enforced active-only filter (taker)
        where.status = { [Op.notIn]: ['completed', 'entered_erp'] };
    } else if (requestedStatus && requestedStatus !== 'all') {
        if (requestedStatus === 'active') {
            where.status = {
                [Op.notIn]: ['archived', 'completed', 'entered_erp']
            };
        } else {
            where.status = requestedStatus;
        }
    } else if (!requestedStatus) {
        // Default to active set when no explicit status is provided
        where.status = {
            [Op.notIn]: ['archived', 'completed', 'entered_erp']
        };
    }

    if (req.query.city) {
        where.city = req.query.city;
    }

    const search = (req.query.search || '').trim();
    if (search) {
        const pattern = `%${escapeLike(search)}%`;
        where[Op.or] = [
            { title: { [Op.like]: pattern } },
            { description: { [Op.like]: pattern } },
            { city: { [Op.like]: pattern } }
        ];
    }

    return { where, search };
};

const fetchOrdersForRole = async (req, effectiveRole, options = {}) => {
    const { limit, offset } = getPaginationParams(req);
    const includeHistory = req.query.includeHistory !== 'false';
    const forceActiveStatuses = effectiveRole === 'taker';
    const { where } = buildSearchWhere(req, { forceActiveStatuses });
    const includeOptions = buildOrderIncludes(effectiveRole, { includeHistory });

    let result;

    if (effectiveRole === 'maker') {
        result = await Order.findAndCountAll({
            where: { ...where, makerId: req.user.id },
            include: includeOptions,
            order: NEWEST_FIRST,
            limit,
            offset,
            distinct: true
        });
    } else if (effectiveRole === 'accounter') {
        const allowedStatuses = ['completed', 'entered_erp'];
        let statusFilter;

        if (req.query.status && allowedStatuses.includes(req.query.status)) {
            statusFilter = req.query.status;
        } else {
            // Default: show both completed and entered_erp
            statusFilter = { [Op.in]: allowedStatuses };
        }

        // Remove status from where to avoid conflicts
        const { status, ...whereWithoutStatus } = where;
        const accounterId = options.accounterId ?? req.user.id;

        const accounterWhere = {
            ...whereWithoutStatus,
            accounterId,
            status: statusFilter
        };

        result = await Order.findAndCountAll({
            where: accounterWhere,
            include: includeOptions,
            order: NEWEST_FIRST,
            limit,
            offset,
            distinct: true
        });
    } else if (effectiveRole === 'admin') {
        result = await Order.findAndCountAll({
            where,
            include: includeOptions,
            order: NEWEST_FIRST,
            limit,
            offset,
            distinct: true
        });
    } else {
        // Taker branch: always exclude completed/ERP-entered and only assigned orders
        const { OrderAssignments } = require('../db');
        const assignedOrderIds = await OrderAssignments.findAll({
            where: { userId: req.user.id },
            attributes: ['orderId'],
            raw: true
        });

        const orderIds = assignedOrderIds.map(a => a.orderId);

        if (orderIds.length === 0) {
            return {
                rows: [],
                count: 0,
                limit,
                offset
            };
        }

        const takerWhere = {
            ...where,
            id: { [Op.in]: orderIds }
        };

        // Always hide completed and ERP-entered orders from takers on the server
        const andConditions = [{ status: { [Op.notIn]: ['completed', 'entered_erp'] } }];

        if (takerWhere.status) {
            andConditions.push({ status: takerWhere.status });
            delete takerWhere.status;
        }

        if (andConditions.length > 0) {
            takerWhere[Op.and] = (takerWhere[Op.and] || []).concat(andConditions);
        }

        result = await Order.findAndCountAll({
            where: takerWhere,
            include: includeOptions,
            // A taker's list is a work queue: urgent (admin) orders on top.
            order: [['isUrgent', 'DESC'], ...NEWEST_FIRST],
            limit,
            offset,
            distinct: true
        });
    }

    return {
        rows: result.rows,
        count: result.count,
        limit,
        offset
    };
};

/**
 * Open orders, for takers to pick from: pending with no assignment at all.
 * Urgent ones first; then oldest first, so the customer who has waited
 * longest is served first.
 */
const fetchOpenOrders = async (req) => {
    const { limit, offset } = getPaginationParams(req);
    const { where } = buildSearchWhere(req, {});
    const { OrderAssignments } = require('../db');
    const qi = sequelize.getQueryInterface();
    const assignments = qi.quoteIdentifier(String(OrderAssignments.getTableName()));
    const orderIdCol = qi.quoteIdentifier('orderId');

    const result = await Order.findAndCountAll({
        where: {
            ...where,
            status: 'pending',
            // orderId is NOT NULL, so NOT IN has none of its NULL surprises.
            id: { [Op.notIn]: sequelize.literal(`(SELECT ${orderIdCol} FROM ${assignments})`) }
        },
        include: buildOrderIncludes('taker', { includeHistory: false }),
        order: [['isUrgent', 'DESC'], ['createdAt', 'ASC'], ['id', 'ASC']],
        limit,
        offset,
        distinct: true
    });

    return { rows: result.rows, count: result.count, limit, offset };
};

module.exports = {
    getItemAttributesForRole,
    sanitizeItems,
    buildOrderIncludes,
    getPaginationParams,
    buildSearchWhere,
    fetchOrdersForRole,
    fetchOpenOrders,
    isOpenOrder,
    assertTakerIds,
    escapeLike,
    orderFieldsProblem
};
