const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const OrderLog = sequelize.define('OrderLog', {
        previousDescription: {
            type: DataTypes.TEXT,
            allowNull: false
        },
        newDescription: {
            type: DataTypes.TEXT,
            allowNull: false
        },
        changedBy: {
            type: DataTypes.INTEGER, // User ID
            allowNull: false
        }
    });

    return OrderLog;
};
