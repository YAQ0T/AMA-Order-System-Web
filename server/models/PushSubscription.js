const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const PushSubscription = sequelize.define('PushSubscription', {
        endpoint: {
            // MySQL/InnoDB cannot put a UNIQUE index on a TEXT column without
            // a prefix length - `sync()` fails outright with "BLOB/TEXT column
            // used in key specification without a key length". So this is a
            // bounded STRING. 512 chars of utf8mb4 is 2048 bytes, inside
            // InnoDB's 3072-byte index limit; real push endpoint URLs are far
            // shorter.
            type: DataTypes.STRING(512),
            allowNull: false,
            unique: true
        },
        p256dh: {
            type: DataTypes.STRING,
            allowNull: false
        },
        auth: {
            type: DataTypes.STRING,
            allowNull: false
        },
        userId: {
            type: DataTypes.INTEGER,
            allowNull: false
        }
    });

    return PushSubscription;
};
