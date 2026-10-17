const fs = require('fs');
const path = require('path');

/**
 * Order event log: one JSON line per create / update / delete / claim, in
 * server/logs/order-events-YYYY-MM-DD.jsonl. The full detail (request,
 * before/after, item diff) goes to the file; the console gets one short line.
 *
 * The console used to receive every event as coloured, pretty-printed JSON.
 * Since "Start AMA" sends the console to .ama_runtime/server.log, that would
 * have grown the log by megabytes a day. Files older than ORDER_LOG_KEEP_DAYS
 * (default 90) are deleted, at start and then daily. The files hold usernames
 * and IP addresses, which is another reason not to keep them forever.
 */
// ORDER_LOG_DIR lets the integration tests keep their events out of the real log.
const LOG_DIR = process.env.ORDER_LOG_DIR ? path.resolve(process.env.ORDER_LOG_DIR) : path.join(__dirname, '..', 'logs');
const FILE_RE = /^order-events-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const color = process.stdout.isTTY;

const keepDays = () => {
    const n = parseInt(process.env.ORDER_LOG_KEEP_DAYS, 10);
    return Number.isInteger(n) && n > 0 ? n : 90;
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

const paint = (event, text) => {
    if (!color) return text;
    const code = event.includes('ERROR') ? 31 : event.includes('SUCCESS') ? 32 : event.includes('START') ? 34 : 36;
    return `\x1b[${code}m${text}\x1b[0m`;
};

/** The one console line for an event, e.g. "[order] ORDER_UPDATE_SUCCESS #12 by maker1 (34ms)". */
function summary(entry) {
    const id = entry.orderId ?? entry.order?.orderId ?? entry.deletedOrder?.orderId;
    const who = entry.actor?.username;
    const parts = [`[order] ${entry.event}`];
    if (id != null) parts.push(`#${id}`);
    if (who) parts.push(`by ${who}`);
    if (entry.durationMs != null) parts.push(`(${entry.durationMs}ms)`);
    if (entry.error?.message) parts.push(`- ${entry.error.message}`);
    return parts.join(' ');
}

const logOrderEvent = async (event, payload = {}) => {
    const entry = {
        timestamp: new Date().toISOString(),
        event,
        ...payload
    };

    // START events are noise on the console; the file still has them.
    if (!event.endsWith('_START')) console.log(paint(event, summary(entry)));

    try {
        await fs.promises.mkdir(LOG_DIR, { recursive: true });
        await fs.promises.appendFile(getLogFilePath(), `${safeStringify(entry)}\n`, 'utf8');
    } catch (error) {
        console.error('Failed to write order request log file:', error.message);
    }
};

/** Delete order event files older than ORDER_LOG_KEEP_DAYS. */
function pruneOrderLogs(now = new Date()) {
    let names = [];
    try {
        names = fs.readdirSync(LOG_DIR);
    } catch {
        return 0;
    }
    const cutoff = new Date(now.getTime() - keepDays() * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    let removed = 0;
    for (const name of names) {
        const m = FILE_RE.exec(name);
        if (m && m[1] < cutoff) {
            try {
                fs.unlinkSync(path.join(LOG_DIR, name));
                removed += 1;
            } catch {
                /* in use or already gone */
            }
        }
    }
    return removed;
}

let pruneTimer = null;
function startOrderLogPruning() {
    if (pruneTimer) return;
    const run = () => {
        const removed = pruneOrderLogs();
        if (removed) console.log(`[order] removed ${removed} order log file(s) older than ${keepDays()} days`);
    };
    run();
    pruneTimer = setInterval(run, 24 * 60 * 60 * 1000);
    pruneTimer.unref();
}

module.exports = { logOrderEvent, pruneOrderLogs, startOrderLogPruning };
