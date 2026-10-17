const { Op } = require('sequelize');
const { Order, OrderLog } = require('../db');

const getItemAttributesForRole = (role) => {
    const baseAttributes = ['id', 'name', 'quantity', 'status', 'createdAt', 'updatedAt'];
    if (['maker', 'admin', 'accounter'].includes(role)) {
        return [...baseAttributes, 'price'];
    }
    return baseAttributes;
};

const sanitizeItems = (items, { allowEmpty = false } = {}) => {
    if (!Array.isArray(items)) return null;

    const cleaned = [];
    const seenNames = new Set();
    const numericPattern = /^(?:\d+\.?\d*|\.\d+)$/;

    for (const [index, rawItem] of items.entries()) {
        const name = (rawItem.name || '').trim();
        const priceRaw = typeof rawItem.price === 'string' ? rawItem.price.trim() : rawItem.price;
        const quantityRaw = typeof rawItem.quantity === 'string' ? rawItem.quantity.trim() : rawItem.quantity;

        // Skip completely empty rows the UI might send
        if (!name && (quantityRaw === undefined || quantityRaw === null || quantityRaw === '')) {
            continue;
        }

        if (!name) {
            throw new Error(`Item ${index + 1} is missing a name`);
        }

        if (typeof quantityRaw === 'string' && !numericPattern.test(quantityRaw)) {
            throw new Error(`Invalid quantity for "${name}"`);
        }
        const quantityNum = Number(quantityRaw);
        const hasPrice = priceRaw !== '' && priceRaw !== undefined && priceRaw !== null;
        let priceNum = null;
        if (hasPrice) {
            if (typeof priceRaw === 'string' && !numericPattern.test(priceRaw)) {
                throw new Error(`Invalid price for "${name}"`);
            }
            const priceNumRaw = Number(priceRaw);
            if (!Number.isFinite(priceNumRaw)) {
                throw new Error(`Invalid price for "${name}"`);
            }
            priceNum = priceNumRaw;
        }
        const normalizedQuantity = Number.isFinite(quantityNum)
            ? Math.round(quantityNum * 1000) / 1000
            : quantityNum;

        if (!Number.isFinite(quantityNum) || quantityNum <= 0) {
            throw new Error(`Invalid quantity for "${name}"`);
        }

        const normalizedName = name.toLowerCase();
        if (seenNames.has(normalizedName)) {
            throw new Error(`Duplicate item "${name}"`);
        }
        seenNames.add(normalizedName);

        const status = rawItem.status === '' || rawItem.status === undefined ? null : rawItem.status ?? null;

        cleaned.push({
            name,
            quantity: normalizedQuantity,
            price: priceNum,
            status
        });
    }

    if (!allowEmpty && cleaned.length === 0) {
        throw new Error('Order must have at least one item');
    }

    return cleaned;
};

const buildOrderIncludes = (role, options = {}) => {
    const { includeHistory = false, includeEmails = false, makerAttrs, assignedTakerAttrs, historyLimit } = options;

    const makerAttributes = makerAttrs || (includeEmails ? ['id', 'username', 'role', 'email'] : ['id', 'username', 'role']);
    const assignedAttributes = assignedTakerAttrs || (includeEmails ? ['id', 'username', 'email'] : ['id', 'username']);
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
            order: [['createdAt', 'DESC']]
        });
    }

    return includes;
};

const getPaginationParams = (req) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 20);
    const offset = parseInt(req.query.offset, 10) || 0;
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
        where[Op.or] = [
            { title: { [Op.like]: `%${search}%` } },
            { description: { [Op.like]: `%${search}%` } },
            { city: { [Op.like]: `%${search}%` } }
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
            order: [['createdAt', 'DESC']],
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
            order: [['createdAt', 'DESC']],
            limit,
            offset,
            distinct: true
        });
    } else if (effectiveRole === 'admin') {
        result = await Order.findAndCountAll({
            where,
            include: includeOptions,
            order: [['createdAt', 'DESC']],
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
            order: [['createdAt', 'DESC']],
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

module.exports = {
    getItemAttributesForRole,
    sanitizeItems,
    buildOrderIncludes,
    getPaginationParams,
    buildSearchWhere,
    fetchOrdersForRole
};
