/**
 * One answer for "something unexpected went wrong" (HTTP 500).
 *
 * The real error - SQL text, table names, file paths, the stack - goes to the
 * server console, where whoever looks after the system can read it. The person
 * using the app gets a fixed message instead: those details are no use to
 * them, and they are exactly what someone probing the system from outside
 * hopes to see. The web client shows it in Arabic (client/src/lib/serverErrors.js).
 */
const SERVER_ERROR = 'Server error';

/**
 * @param {import('express').Response} res
 * @param {unknown} error   what was caught; logged, never sent
 * @param {string} context  where it happened, for the log, e.g. "GET /api/orders"
 */
function sendServerError(res, error, context) {
    console.error(`[${context}]`, error);
    if (!res.headersSent) res.status(500).json({ error: SERVER_ERROR });
}

/**
 * An error the person sending the request can fix (bad input). Thrown by the
 * input checks so the route answers 400 with this message, not a 500.
 */
function badRequest(message) {
    return Object.assign(new Error(message), { status: 400 });
}

/**
 * True for an error whose message is meant for the sender: one made by
 * badRequest(), or Sequelize refusing a value its model rules do not allow.
 */
function isBadInput(error) {
    return error?.status === 400 || error?.name === 'SequelizeValidationError';
}

module.exports = { sendServerError, badRequest, isBadInput, SERVER_ERROR };
