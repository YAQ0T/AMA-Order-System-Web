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
        // UNUSED: the system no longer sends email, and nothing reads or
        // writes this. It stays in the model on purpose - remove it and a
        // single run with DB_ALTER=true would have Sequelize DROP the column,
        // destroying whatever addresses are stored in it.
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

    // Only hashes on create. Code that changes a password hashes it itself
    // (routes/auth.js, routes/admin.js).
    //
    // There used to be an "auto-approve admins" rule here too. Combined with a
    // sign-up form that accepted any role, it let anyone make themselves an
    // admin. The only admin is now the one seedAdmin creates, approved there.
    User.beforeCreate(async (user) => {
        if (user.password) {
            user.password = await bcrypt.hash(user.password, 10);
        }
    });

    return User;
};
