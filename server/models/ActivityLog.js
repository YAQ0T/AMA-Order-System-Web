const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const ActivityLog = sequelize.define('ActivityLog', {
        userId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'Users',
                key: 'id'
            }
        },
        action: {
            type: DataTypes.STRING,
            allowNull: false,
            // Examples: 'user_registered', 'user_approved', 'user_deleted', 
            // 'order_created', 'order_updated', 'order_status_changed', etc.
        },
        targetType: {
            type: DataTypes.STRING,
            allowNull: true,
            // Examples: 'user', 'order', 'system'
        },
        targetId: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        details: {
            type: DataTypes.JSON,
            allowNull: true,
            // Additional context about the action
        },
        ipAddress: {
            type: DataTypes.STRING,
            allowNull: true
        }
    }, {
        timestamps: true,
        updatedAt: false, // Only track creation time
        indexes: [
            { fields: ['userId'] },
            { fields: ['action'] },
            { fields: ['createdAt'] },
            { fields: ['action', 'createdAt'] }
        ]
    });

    return ActivityLog;
};
