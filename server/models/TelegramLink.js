const { DataTypes } = require('sequelize');

/**
 * Links an app user to a Telegram chat so the bot can message them.
 *
 * A separate table rather than columns on Users on purpose: `sequelize.sync()`
 * creates missing TABLES but never adds columns to an existing one, so a new
 * table works on an already-running database with no migration step.
 *
 * Lifecycle:
 *   1. user taps "link Telegram"  -> row with linkCode + linkCodeExpiresAt
 *   2. user taps Start in Telegram -> bot receives "/start <linkCode>",
 *      stores chatId, clears the code (single use)
 *   3. user unlinks, or blocks the bot -> chatId cleared; they are prompted
 *      to link again (there is no email fallback)
 */
module.exports = (sequelize) => {
    const TelegramLink = sequelize.define('TelegramLink', {
        userId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            unique: true
        },
        // Telegram chat ids can exceed 32 bits, and mysql2 returns BIGINT as a
        // string anyway, so store it as a string from the start.
        chatId: {
            type: DataTypes.STRING(32),
            allowNull: true
        },
        telegramUsername: {
            type: DataTypes.STRING(64),
            allowNull: true
        },
        linkCode: {
            type: DataTypes.STRING(64),
            allowNull: true,
            unique: true
        },
        linkCodeExpiresAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        linkedAt: {
            type: DataTypes.DATE,
            allowNull: true
        }
    }, {
        indexes: [{ fields: ['chatId'] }]
    });

    return TelegramLink;
};
