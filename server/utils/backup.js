/**
 * Database backups: a full logical dump of every table, written by Node.
 *
 * Why not mysqldump: it lives in MySQL's bin folder, which is rarely on PATH
 * (on Windows it is under "C:\Program Files\MySQL\MySQL Server 26.7\bin"), and
 * on a Mac it depends on how MySQL was installed. A dumper using the same
 * driver as the app works wherever the app works.
 *
 * Each backup is one gzip-compressed SQL file (.sql.gz). Restore it with
 * `npm run db:restore` in server/ (see restore-db.js), or by hand with any MySQL
 * client:  gunzip -c <file> | mysql -u root -p ama_order_system
 *
 * The dump runs inside one REPEATABLE READ transaction with a consistent
 * snapshot, so every table is copied as of the same instant and nobody using
 * the system is blocked while it runs.
 *
 * Backups hold everything, including password hashes: keep the folder private.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream');
const readline = require('readline');
const mysql = require('mysql2');

const MAGIC = '-- AMA Order System backup';
const COMPLETE = '-- Backup complete';
const NAME_RE = /^ama-backup-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:-([a-z0-9-]{1,40}))?\.sql\.gz$/;
const ROWS_PER_INSERT = 200;
const MAX_INSERT_CHARS = 512 * 1024;

// ---------------------------------------------------------------------------
// Settings (server/.env)

const backupDir = () => path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups'));
const copyDir = () => {
    const dir = (process.env.BACKUP_COPY_DIR || '').trim();
    return dir ? path.resolve(dir) : null;
};
const keepDays = () => {
    const n = parseInt(process.env.BACKUP_KEEP_DAYS, 10);
    return Number.isInteger(n) && n > 0 ? n : 30;
};
const autoEnabled = () => (process.env.BACKUP_AUTO || '').trim().toLowerCase() !== 'off';

const dbConfigFromEnv = () => ({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// ---------------------------------------------------------------------------
// Names and listing

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

const isBackupName = (name) => typeof name === 'string' && NAME_RE.test(name);

/** When the backup was taken, from its name (local time), or null. */
function dateFromName(name) {
    const m = NAME_RE.exec(name);
    if (!m) return null;
    const [, y, mo, d, h, mi, s] = m.map(Number);
    return new Date(y, mo - 1, d, h, mi, s);
}

const labelFromName = (name) => NAME_RE.exec(name)?.[7] || null;

/** Backups in `dir`, newest first. Files that do not match the naming pattern are ignored. */
function listBackups(dir = backupDir()) {
    let names;
    try {
        names = fs.readdirSync(dir);
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
    return names
        .filter(isBackupName)
        .map((name) => {
            const stat = fs.statSync(path.join(dir, name));
            return { name, size: stat.size, createdAt: dateFromName(name) || stat.mtime, label: labelFromName(name) };
        })
        .sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));
}

/**
 * Absolute path of a backup in `dir`, or null if the name is not a backup name
 * or the file does not exist. The strict name check is what keeps a download
 * request from reading anything else on the disk.
 */
function resolveBackup(name, dir = backupDir()) {
    if (!isBackupName(name)) return null;
    const full = path.join(dir, name);
    if (path.dirname(full) !== path.resolve(dir)) return null;
    return fs.existsSync(full) ? full : null;
}

// ---------------------------------------------------------------------------
// Retention

/**
 * Which backups to delete. Kept:
 *   - the 5 newest, whatever their age
 *   - the newest of each day, for the last `days` days
 *   - the newest of each month, for the last 12 months
 *   - safety copies made before a restore, for `days` days
 * Everything else goes. With the defaults that is roughly 30 + 12 files.
 */
function backupsToDelete(backups, { days = keepDays(), now = new Date() } = {}) {
    const keep = new Set();
    const newestFirst = [...backups].sort((a, b) => b.createdAt - a.createdAt);
    newestFirst.slice(0, 5).forEach((b) => keep.add(b.name));

    const dayCutoff = new Date(now);
    dayCutoff.setHours(0, 0, 0, 0);
    dayCutoff.setDate(dayCutoff.getDate() - (days - 1));
    const monthCutoff = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const seenDays = new Set();
    const seenMonths = new Set();
    for (const b of newestFirst) {
        const d = b.createdAt;
        const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
        if (d >= dayCutoff && !seenDays.has(dayKey)) {
            seenDays.add(dayKey);
            keep.add(b.name);
        }
        if (d >= monthCutoff && !seenMonths.has(monthKey)) {
            seenMonths.add(monthKey);
            keep.add(b.name);
        }
        if (b.label === 'before-restore' && d >= dayCutoff) keep.add(b.name);
    }
    return backups.filter((b) => !keep.has(b.name));
}

function prune(dir) {
    const doomed = backupsToDelete(listBackups(dir));
    for (const b of doomed) {
        try {
            fs.unlinkSync(path.join(dir, b.name));
        } catch (err) {
            console.warn(`[backup] could not delete old backup ${b.name}: ${err.message}`);
        }
    }
    return doomed.length;
}

// ---------------------------------------------------------------------------
// Dumping

function connect(cfg, extra = {}) {
    if (!cfg || !cfg.database) throw new Error('No database name given');
    const conn = mysql.createConnection({
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password: cfg.password,
        database: cfg.database,
        charset: 'utf8mb4',
        // Every value comes back exactly as MySQL stores it: dates as text
        // (no time zone shifts), DECIMAL and BIGINT as exact strings, JSON as
        // its text. Each is written back verbatim.
        dateStrings: true,
        decimalNumbers: false,
        supportBigNumbers: true,
        bigNumberStrings: true,
        jsonStrings: true,
        ...extra,
    });
    // Errors reach the caller through each query's callback. Without a
    // listener, a dropped connection between queries would be an unhandled
    // 'error' event - which would take the whole server down with it.
    conn.on('error', () => {});
    return conn;
}

const run = (conn, sql, params) =>
    new Promise((resolve, reject) => conn.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

const end = (conn) => new Promise((resolve) => conn.end(() => resolve()));

/**
 * Write to a stream, waiting when its buffer is full. Rejects if the stream
 * fails - including while waiting, so a full disk ends the backup with an
 * error instead of leaving it waiting forever.
 */
function writer(stream) {
    let failure = null;
    stream.on('error', (err) => { failure = err; });
    return (text) => new Promise((resolve, reject) => {
        if (failure) return reject(failure);
        if (stream.write(text)) return resolve();
        const onDrain = () => { stream.off('error', onError); resolve(); };
        const onError = (err) => { stream.off('drain', onDrain); reject(err); };
        stream.once('drain', onDrain);
        stream.once('error', onError);
    });
}

async function dumpTable(conn, table, write) {
    const id = mysql.escapeId(table);
    const [create] = await run(conn, `SHOW CREATE TABLE ${id}`);
    await write(`\n--\n-- Table ${id}\n--\nDROP TABLE IF EXISTS ${id};\n${create['Create Table']};\n`);

    const columns = (await run(conn, `SHOW COLUMNS FROM ${id}`)).map((c) => mysql.escapeId(c.Field));
    const insertHead = `INSERT INTO ${id} (${columns.join(', ')}) VALUES\n`;

    let rows = 0;
    let batch = [];
    let batchChars = 0;
    const flush = async () => {
        if (!batch.length) return;
        await write(`${insertHead}${batch.join(',\n')};\n`);
        batch = [];
        batchChars = 0;
    };

    await new Promise((resolve, reject) => {
        const stream = conn.query({ sql: `SELECT * FROM ${id}`, rowsAsArray: true }).stream({ highWaterMark: 250 });
        stream.on('error', reject);
        stream.on('end', resolve);
        stream.on('data', (row) => {
            stream.pause();
            // mysql.escape quotes and escapes every value, so a value can never
            // contain a raw line break: each row stays on one line, which is
            // what lets the restore split statements safely.
            const tuple = `(${row.map((v) => mysql.escape(v)).join(',')})`;
            batch.push(tuple);
            batchChars += tuple.length;
            rows += 1;
            const full = batch.length >= ROWS_PER_INSERT || batchChars >= MAX_INSERT_CHARS;
            (full ? flush() : Promise.resolve()).then(() => stream.resume(), (err) => {
                stream.destroy(err);
                reject(err);
            });
        });
    });
    await flush();
    return rows;
}

/**
 * Dump the whole database into `file` (gzip). Writes to a temporary name first
 * and renames at the end, so a crash can never leave a half-written file that
 * looks like a good backup.
 */
async function dumpDatabase(cfg, file) {
    const conn = connect(cfg);
    const partial = `${file}.partial`;
    const gzip = zlib.createGzip({ level: 6 });
    const out = fs.createWriteStream(partial);
    // pipeline() tears the gzip stream down if the file write fails (disk
    // full, folder removed), which makes the next write() reject.
    const written = new Promise((resolve, reject) => pipeline(gzip, out, (err) => (err ? reject(err) : resolve())));
    written.catch(() => { /* handled where it is awaited, or by the catch below */ });
    const write = writer(gzip);
    const tables = {};

    try {
        await run(conn, "SET SESSION time_zone = '+00:00'");
        await run(conn, 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await run(conn, 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');

        const [{ version }] = await run(conn, 'SELECT VERSION() AS version');
        const names = (await run(conn, "SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")).map((r) => Object.values(r)[0]);

        await write([
            MAGIC,
            `-- Database: ${cfg.database}`,
            `-- Created: ${new Date().toISOString()}`,
            `-- MySQL: ${version}`,
            '-- Restore with "npm run db:restore" in server/, or: gunzip -c <file> | mysql -u <user> -p <database>',
            '',
            'SET NAMES utf8mb4;',
            "SET time_zone = '+00:00';",
            "SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO';",
            'SET FOREIGN_KEY_CHECKS = 0;',
            'SET UNIQUE_CHECKS = 0;',
            '',
        ].join('\n'));

        for (const table of names) {
            tables[table] = await dumpTable(conn, table, write);
        }

        await run(conn, 'COMMIT');

        const summary = Object.entries(tables).map(([t, n]) => `${t}=${n}`).join(', ');
        await write(`\nSET FOREIGN_KEY_CHECKS = 1;\nSET UNIQUE_CHECKS = 1;\n\n-- Rows: ${summary}\n${COMPLETE}\n`);

        gzip.end();
        await written;
        fs.renameSync(partial, file);
    } catch (err) {
        gzip.destroy();
        await written.catch(() => {});
        try { fs.unlinkSync(partial); } catch { /* already gone */ }
        // destroy, not end: a row stream may still be paused mid-table, and a
        // polite end() would wait for it forever.
        conn.destroy();
        throw err;
    }
    await end(conn);
    return { tables };
}

// ---------------------------------------------------------------------------
// Reading and restoring

/** Lines of a backup, decompressed. */
function readLines(file) {
    const input = fs.createReadStream(file).pipe(zlib.createGunzip());
    return readline.createInterface({ input, crlfDelay: Infinity });
}

/**
 * Read a backup end to end WITHOUT touching any database: checks that it is an
 * AMA backup and that it is complete (a cut-off file fails the gzip check or
 * lacks the final marker). Returns what it contains.
 */
async function inspectBackup(file) {
    let first = null;
    let last = null;
    let database = null;
    let createdAt = null;
    let rows = null;
    try {
        for await (const line of readLines(file)) {
            if (first === null) first = line;
            if (line.startsWith('-- Database: ')) database = database ?? line.slice(13).trim();
            else if (line.startsWith('-- Created: ')) createdAt = createdAt ?? new Date(line.slice(12).trim());
            else if (line.startsWith('-- Rows: ')) rows = line.slice(9).trim();
            if (line.trim()) last = line;
        }
    } catch (err) {
        return { ok: false, reason: `the file is damaged or incomplete (${err.code || err.message})` };
    }
    if (first !== MAGIC) return { ok: false, reason: 'this is not an AMA backup file' };
    if (last !== COMPLETE) return { ok: false, reason: 'the backup is incomplete (it was cut off while being written)' };

    const tables = {};
    for (const pair of (rows || '').split(',').map((s) => s.trim()).filter(Boolean)) {
        const [name, count] = pair.split('=');
        tables[name] = Number(count);
    }
    return { ok: true, database, createdAt, tables };
}

/**
 * Replace the contents of `cfg.database` with the backup in `file`. Every
 * table in the backup is dropped and recreated. The database name must be
 * given explicitly - it is never taken from the environment here.
 *
 * Not atomic: MySQL commits each CREATE TABLE on its own. That is why
 * restore-db.js takes a safety backup first.
 */
async function restoreDatabase(cfg, file) {
    const check = await inspectBackup(file);
    if (!check.ok) throw new Error(`Refusing to restore: ${check.reason}.`);

    const conn = connect(cfg);
    let statements = 0;
    try {
        let current = '';
        for await (const line of readLines(file)) {
            if (!current && (line.startsWith('--') || !line.trim())) continue;
            current += current ? `\n${line}` : line;
            // Every statement in a backup ends at the end of a line with ";".
            // Values never contain raw line breaks (see dumpTable), so this
            // cannot cut a statement in the middle of a value.
            if (line.endsWith(';')) {
                await run(conn, current);
                statements += 1;
                current = '';
            }
        }
        if (current.trim()) throw new Error('The backup ended in the middle of a statement.');
        return { statements, tables: check.tables };
    } finally {
        await end(conn);
    }
}

// ---------------------------------------------------------------------------
// Taking backups (used by the server and by restore-db.js)

const status = {
    running: false,
    lastSuccess: null, // { name, at, size, tables }
    lastError: null, // { message, at }
    lastCopyError: null, // { message, at }
};
let inFlight = null;

/**
 * Take a backup now. Concurrent calls share the same run instead of dumping
 * twice. `label` ends up in the file name: "manual", "before-restore", or none
 * for automatic backups.
 */
function createBackup({ label = null, cfg = dbConfigFromEnv(), dir = backupDir() } = {}) {
    if (inFlight) return inFlight;
    inFlight = (async () => {
        status.running = true;
        try {
            fs.mkdirSync(dir, { recursive: true });
            const name = `ama-backup-${stamp(new Date())}${label ? `-${label}` : ''}.sql.gz`;
            const file = path.join(dir, name);
            const { tables } = await dumpDatabase(cfg, file);
            const size = fs.statSync(file).size;

            const copyTo = copyDir();
            if (copyTo && path.resolve(copyTo) !== path.resolve(dir)) {
                try {
                    fs.mkdirSync(copyTo, { recursive: true });
                    fs.copyFileSync(file, path.join(copyTo, name));
                    prune(copyTo);
                    status.lastCopyError = null;
                } catch (err) {
                    status.lastCopyError = { message: err.message, at: new Date() };
                    console.error(`[backup] saved, but copying it to ${copyTo} failed: ${err.message}`);
                }
            }

            const removed = prune(dir);
            const result = { name, file, size, tables, createdAt: dateFromName(name) };
            status.lastSuccess = { name, at: new Date(), size, tables };
            status.lastError = null;
            const rows = Object.values(tables).reduce((a, b) => a + b, 0);
            console.log(`[backup] ${name} (${(size / 1024).toFixed(0)} KB, ${rows} rows)${removed ? ` - removed ${removed} old` : ''}`);
            return result;
        } catch (err) {
            status.lastError = { message: err.message, at: new Date() };
            console.error(`[backup] FAILED: ${err.message}`);
            throw err;
        } finally {
            status.running = false;
            inFlight = null;
        }
    })();
    return inFlight;
}

// ---------------------------------------------------------------------------
// Automatic backups

const CHECK_EVERY_MS = 60 * 60 * 1000; // look hourly...
const MIN_GAP_MS = 6 * 60 * 60 * 1000; // ...back up at most every 6 hours, and only if the data changed
const FINGERPRINT_FILE = '.last-backup-fingerprint';
let timer = null;

/**
 * A cheap signature of the data: row count and newest updatedAt per table.
 * Used so an idle system does not pile up identical backups.
 */
async function fingerprint(cfg = dbConfigFromEnv()) {
    const conn = connect(cfg);
    try {
        const names = (await run(conn, "SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")).map((r) => Object.values(r)[0]);
        const parts = [];
        for (const t of names) {
            const cols = (await run(conn, `SHOW COLUMNS FROM ${mysql.escapeId(t)}`)).map((c) => c.Field);
            const sql = cols.includes('updatedAt')
                ? `SELECT COUNT(*) AS n, MAX(updatedAt) AS u FROM ${mysql.escapeId(t)}`
                : `SELECT COUNT(*) AS n, NULL AS u FROM ${mysql.escapeId(t)}`;
            const [{ n, u }] = await run(conn, sql);
            parts.push(`${t}:${n}:${u}`);
        }
        return parts.join('|');
    } finally {
        await end(conn);
    }
}

/**
 * Hourly: take a backup if the newest one is at least 6 hours old AND the data
 * changed since it was taken. A working day therefore gets one or two backups,
 * a closed weekend gets none, and the first start of the day backs up whatever
 * happened after the last backup the evening before.
 */
async function autoCheck() {
    if (inFlight) return;
    const dir = backupDir();
    const fingerprintFile = path.join(dir, FINGERPRINT_FILE);
    try {
        const latest = listBackups(dir)[0];
        const age = latest ? Date.now() - latest.createdAt.getTime() : Infinity;
        if (age < MIN_GAP_MS) return;

        const current = await fingerprint();
        let previous = null;
        try { previous = fs.readFileSync(fingerprintFile, 'utf8'); } catch { /* none yet */ }
        if (latest && current === previous) return;

        await createBackup();
        fs.writeFileSync(fingerprintFile, current);
    } catch (err) {
        if (!status.lastError) console.error(`[backup] automatic check failed: ${err.message}`);
        /* try again next hour */
    }
}

/** Remove .partial files left behind by a crash during a backup. */
function cleanupPartials(dir = backupDir()) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
        if (name.startsWith('ama-backup-') && name.endsWith('.partial')) {
            try { fs.unlinkSync(path.join(dir, name)); } catch { /* in use */ }
        }
    }
}

function startAutoBackup({ firstCheckAfterMs = 30_000 } = {}) {
    if (!autoEnabled()) {
        console.log('[backup] automatic backups are OFF (BACKUP_AUTO=off)');
        return;
    }
    if (timer) return;
    cleanupPartials();
    console.log(`[backup] automatic backups on - folder: ${backupDir()}${copyDir() ? `, copied to: ${copyDir()}` : ''}`);
    setTimeout(autoCheck, firstCheckAfterMs).unref();
    timer = setInterval(autoCheck, CHECK_EVERY_MS);
    timer.unref();
}

function stopAutoBackup() {
    if (timer) clearInterval(timer);
    timer = null;
}

function getStatus() {
    return {
        auto: autoEnabled(),
        dir: backupDir(),
        copyDir: copyDir(),
        keepDays: keepDays(),
        running: status.running,
        lastSuccess: status.lastSuccess,
        lastError: status.lastError,
        lastCopyError: status.lastCopyError,
    };
}

module.exports = {
    backupDir,
    copyDir,
    dbConfigFromEnv,
    isBackupName,
    listBackups,
    resolveBackup,
    backupsToDelete,
    createBackup,
    inspectBackup,
    restoreDatabase,
    dumpDatabase,
    startAutoBackup,
    stopAutoBackup,
    getStatus,
};
