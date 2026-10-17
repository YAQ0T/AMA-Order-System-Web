const express = require('express');
const bcrypt = require('bcryptjs');
const { User, Order, OrderItem, OrderLog, ActivityLog, sequelize } = require('../db');
const { authenticateToken, forgetUser } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { logActivity } = require('../utils/activityLogger');
const { escapeLike } = require('./order_helpers');
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
            where.username = { [Op.like]: `${escapeLike(trimmedSearch)}%` };
        }

        const users = await User.findAll({
            where,
            attributes: ['id', 'username', 'role', 'isApproved', 'approvedBy', 'approvedAt', 'createdAt'],
            include: [{
                model: User,
                as: 'Approver',
                attributes: ['id', 'username']
            }],
            order: [['createdAt', 'DESC'], ['id', 'DESC']]
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
                // approvedAt is only ever set by an approval, so a user who has
                // it but is not approved was deactivated - not waiting.
                approvedAt: null,
                role: { [Op.ne]: 'admin' } // Exclude admin from pending
            },
            attributes: ['id', 'username', 'role', 'createdAt'],
            order: [['createdAt', 'ASC'], ['id', 'ASC']]
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
        forgetUser(user.id);

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

// Deactivate a user: they can no longer log in, and any session they have open
// stops working within seconds (authenticateToken re-checks). Everything they
// did - orders, ticks, history - stays. This is how to "remove" someone who
// has worked in the system. Undo with the approve route.
router.put('/users/:id/deactivate', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (id === req.user.id) {
            return res.status(400).json({ error: 'Cannot deactivate your own account' });
        }
        const user = await User.findByPk(id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.role === 'admin') {
            return res.status(400).json({ error: 'An admin account cannot be deactivated' });
        }
        if (!user.isApproved) {
            return res.status(400).json({ error: 'User is not active' });
        }

        // approvedAt stays set: that is what tells "deactivated" apart from
        // "never approved" (see /users/pending and the login route).
        user.isApproved = false;
        if (!user.approvedAt) user.approvedAt = new Date();
        await user.save();
        forgetUser(user.id);

        // Orders still waiting on this person should be handed to someone else.
        const { OrderAssignments } = require('../db');
        const assigned = await OrderAssignments.findAll({ where: { userId: id }, attributes: ['orderId'], raw: true });
        const activeAssignments = assigned.length
            ? await Order.count({ where: { id: assigned.map(a => a.orderId), status: ['pending', 'in-progress'] } })
            : 0;

        await logActivity(req.user.id, 'user_deactivated', 'user', user.id, { username: user.username, role: user.role }, req.ip);
        res.json({ message: 'User deactivated', activeAssignments });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Set a new password for someone who forgot theirs. Their open sessions end.
router.put('/users/:id/password', async (req, res) => {
    try {
        const { newPassword } = req.body || {};
        if (typeof newPassword !== 'string' || newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        if (newPassword.length > 100) return res.status(400).json({ error: 'Password is too long' });

        const user = await User.findByPk(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        forgetUser(user.id);

        await logActivity(req.user.id, 'user_password_reset', 'user', user.id, { username: user.username }, req.ip);
        res.json({ message: 'Password changed' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a user - only one who never did anything (a mistaken or duplicate
// sign-up). Deleting used to wipe every order a maker had created, completed
// and ERP-entered ones included, and the history entries of anyone else.
// Someone who has worked in the system is deactivated instead.
router.delete('/users/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const adminId = req.user.id;

        if (id === adminId) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        const user = await User.findByPk(id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.role === 'admin') {
            return res.status(400).json({ error: 'An admin account cannot be deleted' });
        }

        const { OrderAssignments, PushSubscription, Notification, TelegramLink } = require('../db');
        const [made, accounted, assigned, edits] = await Promise.all([
            Order.count({ where: { makerId: id } }),
            Order.count({ where: { accounterId: id } }),
            OrderAssignments.count({ where: { userId: id } }),
            OrderLog.count({ where: { changedBy: id } })
        ]);
        if (made + accounted + assigned + edits > 0) {
            return res.status(409).json({
                error: 'This user has orders or history, so deleting them would erase it. Deactivate the account instead.',
                code: 'USER_HAS_HISTORY',
                counts: { made, accounted, assigned, edits }
            });
        }

        const deletedUserInfo = { username: user.username, role: user.role };
        await sequelize.transaction(async (transaction) => {
            await PushSubscription.destroy({ where: { userId: id }, transaction });
            await TelegramLink.destroy({ where: { userId: id }, transaction });
            await Notification.destroy({ where: { userId: id }, transaction });
            // Their activity entries stay, anonymised (ActivityLogs.userId is ON DELETE SET NULL).
            await User.update({ approvedBy: null }, { where: { approvedBy: id }, transaction });
            await user.destroy({ transaction });
        });
        forgetUser(id);

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
            order: [['createdAt', 'DESC'], ['id', 'DESC']]
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
            order: [['createdAt', 'DESC'], ['id', 'DESC']]
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

        const wasOpen = order.status === 'pending' && (order.AssignedTakers || []).length === 0;

        // Remove related records first - all or nothing.
        await sequelize.transaction(async (transaction) => {
            await OrderItem.destroy({ where: { orderId: order.id }, transaction });
            await OrderLog.destroy({ where: { orderId: order.id }, transaction });
            await order.setAssignedTakers([], { transaction });
            await order.destroy({ transaction });
        });

        if (wasOpen) {
            require('../utils/telegram').closeOpenOrder(order.id, null)
                .catch(err => console.error('Error updating open-order messages:', err));
        }

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
            order: [['createdAt', 'DESC'], ['id', 'DESC']],
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
                order: [['createdAt', 'DESC'], ['id', 'DESC']],
                limit
            }),
            OrderLog.findAll({
                include: [
                    { model: User, as: 'Editor', attributes: ['id', 'username'] },
                    { model: Order, attributes: ['id', 'title', 'status', 'city'] }
                ],
                order: [['createdAt', 'DESC'], ['id', 'DESC']],
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
                order: [['createdAt', 'DESC'], ['id', 'DESC']],
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
