const { ActivityLog } = require('../db');

/**
 * Log an activity to the database
 * @param {number} userId - ID of the user performing the action
 * @param {string} action - Action type (e.g., 'user_registered', 'order_created')
 * @param {string} targetType - Type of target entity ('user', 'order', 'system')
 * @param {number} targetId - ID of the target entity
 * @param {object} details - Additional details about the action
 * @param {string} ipAddress - IP address of the request
 */
async function logActivity(userId, action, targetType = null, targetId = null, details = null, ipAddress = null) {
    try {
        await ActivityLog.create({
            userId,
            action,
            targetType,
            targetId,
            details,
            ipAddress
        });
    } catch (error) {
        console.error('Failed to log activity:', error);
        // Don't throw - logging failures shouldn't break the app
    }
}

module.exports = { logActivity };
