const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Order = sequelize.define('Order', {
        title: {
            type: DataTypes.STRING,
            allowNull: true
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        status: {
            type: DataTypes.ENUM('pending', 'in-progress', 'completed', 'archived', 'entered_erp'),
            defaultValue: 'pending'
        },
        city: {
            type: DataTypes.STRING,
            allowNull: true,
            validate: {
                isIn: [['نابلس', 'الخليل', 'جنين', 'طولكرم', 'بديا', 'قلقيليا', 'رامالله', 'بيت لحم', 'الداخل']]
            }
        },
        accounterId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'Users',
                key: 'id'
            }
        }
    }, {
        indexes: [
            {
                fields: ['status']
            },
            {
                fields: ['city']
            },
            {
                fields: ['makerId']
            },
            {
                fields: ['accounterId']
            },
            {
                fields: ['createdAt']
            },
            {
                fields: ['title']
            }
        ]
    });

    return Order;
};
