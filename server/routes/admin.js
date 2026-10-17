const express = require('express');
const { User, Order, OrderItem, OrderLog, ActivityLog } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { logActivity } = require('../utils/activityLogger');
const { Op } = require('sequelize');

const router = express.Router();

// All routes require authentication and admin role
router.use(authenticateToken, requireAdmin);

// ============ USER MANAGEMENT ============

// Get all users with optional filters
router.get('/users', async (req, res) => {
    try {
        const { role, isApproved, search } = req.query;

        const where = {};
        if (role) where.role = role;
        if (isApproved !== undefined) where.isApproved = isApproved === 'true';
        const trimmedSearch = search?.trim();
        if (trimmedSearch) {
            // Use prefix matching to keep the query index-friendly
            where.username = { [Op.like]: `${trimmedSearch}%` };
        }

        const users = await User.findAll({
            where,
            attributes: ['id', 'username', 'email', 'role', 'isApproved', 'approvedBy', 'approvedAt', 'createdAt'],
            include: [{
                model: User,
                as: 'Approver',
                attributes: ['id', 'username']
            }],
            order: [['createdAt', 'DESC']]
        });

        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get pending approval users
router.get('/users/pending', async (req, res) => {
    try {
        const users = await User.findAll({
            where: {
                isApproved: false,
                role: { [Op.ne]: 'admin' } // Exclude admin from pending
            },
            attributes: ['id', 'username', 'role', 'createdAt'],
            order: [['createdAt', 'ASC']]
        });

        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Approve a user
router.put('/users/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.user.id;

        const user = await User.findByPk(id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.isApproved) {
            return res.status(400).json({ error: 'User is already approved' });
        }

        user.isApproved = true;
        user.approvedBy = adminId;
        user.approvedAt = new Date();
        await user.save();

        // Log the approval
        await logActivity(adminId, 'user_approved', 'user', user.id, {
            approvedUser: user.username,
            approvedRole: user.role
        }, req.ip);

        res.json({
            message: 'User approved successfully',
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                isApproved: user.isApproved
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update user email
router.put('/users/:id/email', async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.body;

        const user = await User.findByPk(id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Validate email format if provided
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        user.email = email || null;
        await user.save();

        await logActivity(req.user.id, 'user_email_updated', 'user', user.id, {
            username: user.username,
            newEmail: email
        }, req.ip);

        res.json({
            message: 'Email updated successfully',
            user: {
                id: user.id,
                username: user.username,
                email: user.email
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a user
router.delete('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.user.id;

        // Prevent admin from deleting themselves
        if (parseInt(id) === adminId) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        const user = await User.findByPk(id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const deletedUserInfo = {
            username: user.username,
            role: user.role
        };

        // 1. Remove from OrderAssignments (Taker)
        const assignedOrders = await user.getAssignedOrders();
        if (assignedOrders.length > 0) {
            await user.setAssignedOrders([]);
        }

        // 2. Delete PushSubscriptions
        const { PushSubscription, Notification } = require('../db');
        await PushSubscription.destroy({ where: { userId: id } });

        // 3. Delete Notifications
        await Notification.destroy({ where: { userId: id } });

        // 4. Delete ActivityLogs
        await ActivityLog.destroy({ where: { userId: id } });

        // 5. Update OrderLogs (set changedBy to null)
        // If schema doesn't allow null, we might need to delete them, but try update first
        try {
            await OrderLog.update({ changedBy: null }, { where: { changedBy: id } });
        } catch (err) {
            console.warn('Could not set OrderLog.changedBy to null, deleting logs instead:', err.message);
            await OrderLog.destroy({ where: { changedBy: id } });
        }

        // 6. Update Approved Users (set approvedBy to null)
        await User.update({ approvedBy: null }, { where: { approvedBy: id } });

        // 7. Delete Created Orders (Maker)
        // We need to delete items and logs for these orders first
        const createdOrders = await Order.findAll({ where: { makerId: id } });
        for (const order of createdOrders) {
            await OrderItem.destroy({ where: { orderId: order.id } });
            await OrderLog.destroy({ where: { orderId: order.id } });
            await order.setAssignedTakers([]); // Clear assignments
            await order.destroy();
        }

        // 8. Finally delete the user
        await user.destroy();

        // Log the deletion
        await logActivity(adminId, 'user_deleted', 'user', id, deletedUserInfo, req.ip);

        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============ ORDER MANAGEMENT ============

// Get all orders
router.get('/orders', async (req, res) => {
    try {
        const { status, makerId } = req.query;

        const where = {};
        if (status) where.status = status;
        if (makerId) where.makerId = makerId;

        const orders = await Order.findAll({
            where,
            include: [
                {
                    model: User,
                    as: 'Maker',
                    attributes: ['id', 'username', 'role']
                },
                {
                    model: User,
                    as: 'AssignedTakers',
                    attributes: ['id', 'username'],
                    through: { attributes: [] }
                },
                {
                    model: OrderItem,
                    as: 'Items'
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get specific order details
router.get('/orders/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const order = await Order.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'Maker',
                    attributes: ['id', 'username', 'role']
                },
                {
                    model: User,
                    as: 'AssignedTakers',
                    attributes: ['id', 'username'],
                    through: { attributes: [] }
                },
                {
                    model: OrderItem,
                    as: 'Items'
                }
            ]
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json(order);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get change logs for a specific order
router.get('/orders/:id/logs', async (req, res) => {
    try {
        const { id } = req.params;

        const logs = await OrderLog.findAll({
            where: { orderId: id },
            include: [{ model: User, as: 'Editor', attributes: ['id', 'username'] }],
            order: [['createdAt', 'DESC']]
        });

        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete any order
router.delete('/orders/:id', async (req, res) => {
    try {
        const adminId = req.user.id;
        const { id } = req.params;

        const order = await Order.findByPk(id, {
            include: [
                { model: OrderItem, as: 'Items' },
                { model: OrderLog, as: 'History' },
                { model: User, as: 'AssignedTakers' }
            ]
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Remove related records first
        await OrderItem.destroy({ where: { orderId: order.id } });
        await OrderLog.destroy({ where: { orderId: order.id } });
        await order.setAssignedTakers([]);

        await order.destroy();

        await logActivity(adminId, 'order_deleted', 'order', id, {
            title: order.title,
            makerId: order.makerId,
            totalItems: order.Items?.length || 0
        }, req.ip);

        res.json({ message: 'Order deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ ACTIVITY LOGS ============

// Get activity logs with filters
router.get('/logs', async (req, res) => {
    try {
        const { action, userId, startDate, endDate, limit = 100 } = req.query;

        const where = {};
        if (action) where.action = action;
        if (userId) where.userId = userId;
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt[Op.gte] = new Date(startDate);
            if (endDate) where.createdAt[Op.lte] = new Date(endDate);
        }

        const logs = await ActivityLog.findAll({
            where,
            include: [{
                model: User,
                as: 'User',
                attributes: ['id', 'username', 'role']
            }],
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit)
        });

        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Unified audit log (activity + order changes + errors)
router.get('/logs/all', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);

        const [activity, orderChanges] = await Promise.all([
            ActivityLog.findAll({
                include: [{ model: User, as: 'User', attributes: ['id', 'username', 'role'] }],
                order: [['createdAt', 'DESC']],
                limit
            }),
            OrderLog.findAll({
                include: [
                    { model: User, as: 'Editor', attributes: ['id', 'username'] },
                    { model: Order, attributes: ['id', 'title', 'status', 'city'] }
                ],
                order: [['createdAt', 'DESC']],
                limit
            })
        ]);

        const formatActivityDescription = (log) => {
            if (log.action === 'order_created') {
                const itemCount = log.details?.items?.length ?? log.details?.itemCount;
                const takers = (log.details?.assignedTakerNames || []).join(', ');
                const takerText = takers ? `, to: ${takers}` : '';
                return `Order created${log.targetId ? ` #${log.targetId}` : ''} (${itemCount || 0} items${log.details?.status ? `, status: ${log.details.status}` : ''}${takerText})`;
            }
            if (log.action === 'order_updated') {
                const changes = Array.isArray(log.details?.changes) ? log.details.changes.join(', ') : 'fields';
                return `Order updated${log.targetId ? ` #${log.targetId}` : ''}: ${changes}`;
            }
            if (log.action === 'order_error') {
                return `Order error${log.targetId ? ` #${log.targetId}` : ''}: ${log.details?.message || 'Unknown error'}`;
            }
            return log.details?.message || log.action.replace(/_/g, ' ');
        };

        const combined = [
            ...activity.map(log => ({
                type: 'activity',
                createdAt: log.createdAt,
                user: log.User,
                action: log.action,
                targetType: log.targetType,
                targetId: log.targetId,
                details: log.details,
                description: formatActivityDescription(log)
            })),
            ...orderChanges.map(log => ({
                type: 'order_change',
                createdAt: log.createdAt,
                user: log.Editor,
                action: 'order_change',
                targetType: 'order',
                targetId: log.orderId,
                details: {
                    new: log.newDescription,
                    old: log.previousDescription,
                    order: log.Order
                },
                description: `${log.Order ? `#${log.Order.id} ${log.Order.title || 'Order'}` : `Order ${log.orderId}`}: ${log.newDescription}`
            }))
        ]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, limit);

        res.json(combined);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ DASHBOARD STATISTICS ============

// Get dashboard stats
router.get('/stats', async (req, res) => {
    try {
        const [
            totalUsers,
            pendingApprovals,
            totalOrders,
            activeOrders,
            recentActivity
        ] = await Promise.all([
            User.count({ where: { role: { [Op.ne]: 'admin' } } }),
            User.count({ where: { isApproved: false, role: { [Op.ne]: 'admin' } } }),
            Order.count(),
            Order.count({ where: { status: { [Op.in]: ['pending', 'in-progress'] } } }),
            ActivityLog.findAll({
                limit: 10,
                order: [['createdAt', 'DESC']],
                include: [{
                    model: User,
                    as: 'User',
                    attributes: ['username']
                }]
            })
        ]);

        const usersByRole = await User.findAll({
            where: { role: { [Op.ne]: 'admin' } },
            attributes: [
                'role',
                [require('sequelize').fn('COUNT', 'id'), 'count']
            ],
            group: ['role']
        });

        res.json({
            totalUsers,
            pendingApprovals,
            totalOrders,
            activeOrders,
            usersByRole: usersByRole.reduce((acc, item) => {
                acc[item.role] = parseInt(item.get('count'));
                return acc;
            }, {}),
            recentActivity
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
