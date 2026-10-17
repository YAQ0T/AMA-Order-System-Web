const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

module.exports = (sequelize) => {
    const User = sequelize.define('User', {
        username: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        password: {
            type: DataTypes.STRING,
            allowNull: false
        },
        role: {
            type: DataTypes.ENUM('maker', 'taker', 'admin', 'accounter'),
            allowNull: false
        },
        isApproved: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            allowNull: false
        },
        email: {
            type: DataTypes.STRING,
            allowNull: true,
            validate: {
                isEmail: true
            }
        },
        prefersDark: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        approvedBy: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'Users',
                key: 'id'
            }
        },
        approvedAt: {
            type: DataTypes.DATE,
            allowNull: true
        }
    }, {
        indexes: [
            {
                fields: ['role']
            },
            {
                fields: ['isApproved']
            },
            {
                unique: true,
                fields: ['username']
            }
        ]
    });

    User.beforeCreate(async (user) => {
        if (user.password) {
            user.password = await bcrypt.hash(user.password, 10);
        }
        // Auto-approve admin users
        if (user.role === 'admin') {
            user.isApproved = true;
        }
    });

    return User;
};
