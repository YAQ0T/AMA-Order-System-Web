const { authenticateToken } = require('./auth');

/**
 * Middleware to require admin role
 */
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }
    next();
};

module.exports = { requireAdmin };
