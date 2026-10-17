const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const OrderAssignments = sequelize.define('OrderAssignments', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        userId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'Users',
                key: 'id'
            },
            unique: false // Explicitly set to false
        },
        orderId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'Orders',
                key: 'id'
            },
            unique: false // Explicitly set to false
        }
    }, {
        indexes: [
            {
                unique: true,
                fields: ['userId', 'orderId'] // Composite unique constraint
            }
        ]
    });

    return OrderAssignments;
};
