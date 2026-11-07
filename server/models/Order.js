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
        },
        // An order that came in online (marked by its maker). Shown in its own
        // colour everywhere the order appears.
        isOnline: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        // Urgent: every order an admin creates. Shown in red, and first in the
        // takers' lists. Only an admin can change it.
        isUrgent: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
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
