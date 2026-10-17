#!/usr/bin/env node
/**
 * Restore the database from a backup.
 *
 *   npm run db:restore                 pick from a numbered list of backups
 *   npm run db:restore -- <file>       a specific backup (a name in the backups
 *                                      folder, or a path to one anywhere)
 *   npm run db:restore -- <file> --yes skip the typed confirmation (scripts)
 *
 * What it does, in order:
 *   1. refuses if the system is running (stop it first)
 *   2. reads the backup end to end and refuses if it is damaged or incomplete
 *   3. asks you to type RESTORE
 *   4. takes a safety backup of the current data ("...-before-restore")
 *   5. replaces every table with the backup's contents
 *
 * If something goes wrong half-way, restore the "before-restore" backup the
 * same way to get back to where you were.
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');
const path = require('path');
const readlineSync = require('readline');
const mysql = require('mysql2/promise');
const backup = require('./utils/backup');

const args = process.argv.slice(2);
const assumeYes = args.includes('--yes');
const target = args.find((a) => !a.startsWith('--'));

const cfg = backup.dbConfigFromEnv();
const PORT = Number(process.env.PORT) || 6001;

const say = (line = '') => console.log(line);
const fail = (message) => {
    console.error(`\n  ${message}\n`);
    process.exit(1);
};

/** Ask a question. If the input ends instead (window closed, nothing typed), the answer is "". */
function ask(question) {
    const rl = readlineSync.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        let answered = false;
        rl.on('close', () => {
            if (!answered) resolve('');
        });
        rl.question(question, (answer) => {
            answered = true;
            rl.close();
            resolve(answer.trim());
        });
    });
}

const kb = (bytes) => `${Math.max(1, Math.round(bytes / 1024))} KB`;
const when = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toLocaleString() : 'unknown time');

async function serverIsRunning() {
    try {
        const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) });
        return res.ok;
    } catch {
        return false;
    }
}

async function chooseFile() {
    if (target) {
        const inFolder = backup.resolveBackup(path.basename(target));
        if (fs.existsSync(target)) return path.resolve(target);
        if (inFolder) return inFolder;
        fail(`Backup not found: ${target}`);
    }

    const list = backup.listBackups();
    if (list.length === 0) fail(`There are no backups in ${backup.backupDir()}`);
    if (assumeYes) fail('Name the backup to restore when using --yes.');

    say(`Backups in ${backup.backupDir()}:\n`);
    list.slice(0, 30).forEach((b, i) => {
        const kind = b.label === 'manual' ? ' (manual)' : b.label === 'before-restore' ? ' (safety copy before a restore)' : '';
        say(`  ${String(i + 1).padStart(2)}. ${when(b.createdAt)}  ${kb(b.size).padStart(8)}${kind}`);
    });
    say();
    const answer = await ask('Number of the backup to restore (Enter to cancel): ');
    const index = Number(answer) - 1;
    if (!answer || !Number.isInteger(index) || !list[index]) fail('Cancelled - nothing was changed.');
    return path.join(backup.backupDir(), list[index].name);
}

async function databaseExists() {
    const c = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password });
    try {
        const [rows] = await c.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [cfg.database]);
        if (rows.length) return true;
        await c.query(`CREATE DATABASE ${mysql.escapeId(cfg.database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        say(`  Database "${cfg.database}" did not exist - created it (utf8mb4).`);
        return false;
    } finally {
        await c.end();
    }
}

async function main() {
    say('\nAMA Order System - restore a backup\n');
    if (!cfg.database) fail('DB_NAME is not set in server/.env.');

    if (await serverIsRunning()) {
        fail(`The system is running (port ${PORT}). Stop it first ("Stop AMA"), then run this again.`);
    }

    const file = await chooseFile();
    say(`\nChecking ${path.basename(file)} ...`);
    const info = await backup.inspectBackup(file);
    if (!info.ok) fail(`Cannot use this backup: ${info.reason}.`);

    const rows = Object.values(info.tables).reduce((a, b) => a + b, 0);
    say(`  Taken:    ${when(info.createdAt)}`);
    say(`  From:     database "${info.database}"`);
    say(`  Contains: ${Object.keys(info.tables).length} tables, ${rows} rows`);
    // MySQL on Windows stores table names in lower case, on a Mac as written.
    const count = (table) => Object.entries(info.tables).find(([t]) => t.toLowerCase() === table)?.[1];
    if (count('orders') !== undefined) say(`            ${count('orders')} orders, ${count('users') ?? '?'} users`);
    if (info.database && info.database !== cfg.database) {
        say(`\n  NOTE: this backup was taken from "${info.database}", and will be restored into "${cfg.database}".`);
    }

    say(`\nThis REPLACES ALL CURRENT DATA in "${cfg.database}" with the backup above.`);
    say('A safety backup of the current data is taken first.\n');
    if (!assumeYes) {
        const answer = await ask('Type RESTORE to continue: ');
        if (answer !== 'RESTORE') fail('Cancelled - nothing was changed.');
    }

    if (await databaseExists()) {
        say('\nTaking a safety backup of the current data ...');
        try {
            const safety = await backup.createBackup({ label: 'before-restore', cfg });
            say(`  Saved: ${safety.name}`);
        } catch (err) {
            fail(`The safety backup failed (${err.message}). Nothing was changed.`);
        }
    }

    say('\nRestoring ...');
    const started = Date.now();
    try {
        const result = await backup.restoreDatabase(cfg, file);
        say(`  Done: ${result.statements} statements in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
    } catch (err) {
        fail(`The restore failed: ${err.message}\n  Your data before the restore is in the "before-restore" backup - restore that one to go back.`);
    }

    say('\nThe data is back as it was when the backup was taken. Start the system again ("Start AMA").\n');
}

main().catch((err) => fail(err.message || String(err)));
