const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Notification = sequelize.define('Notification', {
        message: {
            type: DataTypes.STRING,
            allowNull: false,
            // Messages quote the customer name, which can itself be up to 255
            // characters. MySQL refuses an over-long value outright, and these
            // rows are often written after the order is already saved, so an
            // error here would report a saved order as failed. Shorten instead.
            set(value) {
                const text = value == null ? value : String(value);
                this.setDataValue('message', text && text.length > 255 ? `${text.slice(0, 254)}…` : text);
            }
        },
        isRead: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        type: {
            type: DataTypes.ENUM('info', 'alert', 'success'),
            defaultValue: 'info'
        },
        orderId: {
            type: DataTypes.INTEGER,
            allowNull: true
        }
    }, {
        indexes: [
            {
                fields: ['userId']
            },
            {
                fields: ['isRead']
            },
            {
                fields: ['createdAt']
            }
        ]
    });

    return Notification;
};
