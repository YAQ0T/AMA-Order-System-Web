const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const SEPARATOR = '-'.repeat(110);

const ANSI = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    blue: '\x1b[34m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    cyan: '\x1b[36m'
};

const safeStringify = (value) => {
    try {
        return JSON.stringify(value);
    } catch (error) {
        return JSON.stringify({
            timestamp: new Date().toISOString(),
            event: 'LOG_SERIALIZATION_ERROR',
            message: error.message
        });
    }
};

const getLogFilePath = (date = new Date()) => {
    const day = date.toISOString().slice(0, 10);
    return path.join(LOG_DIR, `order-events-${day}.jsonl`);
};

const getEventColor = (event) => {
    if (event.includes('ERROR')) return ANSI.red;
    if (event.includes('SUCCESS')) return ANSI.green;
    if (event.includes('START')) return ANSI.blue;
    return ANSI.cyan;
};

const toPrettyJson = (value) => {
    try {
        return JSON.stringify(value, null, 2);
    } catch (error) {
        return JSON.stringify({
            timestamp: new Date().toISOString(),
            event: 'LOG_PRETTY_SERIALIZATION_ERROR',
            message: error.message
        }, null, 2);
    }
};

const logOrderEvent = async (event, payload = {}) => {
    const entry = {
        timestamp: new Date().toISOString(),
        event,
        ...payload
    };

    const line = safeStringify(entry);
    const color = getEventColor(event);
    console.log(`${ANSI.dim}${SEPARATOR}${ANSI.reset}`);
    console.log(`${color}[ORDER_EVENT] ${entry.timestamp} | ${event}${ANSI.reset}`);
    console.log(`${color}${toPrettyJson(entry)}${ANSI.reset}`);

    try {
        await fs.promises.mkdir(LOG_DIR, { recursive: true });
        await fs.promises.appendFile(getLogFilePath(), `${line}\n`, 'utf8');
    } catch (error) {
        console.error('Failed to write order request log file:', error.message);
    }
};

module.exports = { logOrderEvent };
