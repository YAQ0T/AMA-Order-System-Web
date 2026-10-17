const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const OrderItem = sequelize.define('OrderItem', {
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        quantity: {
            // Allow fractional quantities (e.g. 0.5, 1.25)
            type: DataTypes.DECIMAL(10, 3),
            allowNull: false,
            defaultValue: 1,
            get() {
                const raw = this.getDataValue('quantity');
                return raw === null ? null : Number(raw);
            }
        },
        status: {
            type: DataTypes.ENUM('collected', 'unavailable'),
            allowNull: true,
            defaultValue: null
        },
        price: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            defaultValue: null
        }
    });

    return OrderItem;
};
