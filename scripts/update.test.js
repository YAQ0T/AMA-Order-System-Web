#!/usr/bin/env node
/**
 * Checks for "Update AMA" (node scripts/launch.js update): which files an
 * update from a ZIP may write or delete. Runs on any computer, offline, in
 * temporary folders - nothing real is touched:  node scripts/update.test.js
 *
 * The rule that matters most: this computer's settings and data - server/.env
 * (passwords, the Telegram token), backups, logs, .ama_runtime, installed
 * packages - are never written or deleted, even by a ZIP that contains them.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { isKeptPath, planUpdate, applyUpdate } = require('./launch.js');

let passed = 0;
let failed = 0;
const ok = (cond, label, detail = '') => {
    if (cond) {
        passed++;
        console.log(`  ✓ ${label}`);
    } else {
        failed++;
        console.log(`  ✗ ${label}${detail ? `  -> ${detail}` : ''}`);
    }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ama-update-test-'));
const put = (root, rel, text) => {
    const file = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
};
const read = (root, rel) => {
    try {
        return fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
    } catch {
        return null;
    }
};

try {
    console.log('\nWhat an update never touches');
    for (const rel of [
        'server/.env', 'client/.env', '.env', 'server/.env.local', 'Server/.ENV',
        'backups/ama-backup-2026-11-11_10-00-00.sql.gz', 'server/logs/orders.jsonl', 'logs/x.txt',
        '.ama_runtime/server.pid', '.git/config', 'server/node_modules/a/index.js', 'client/node_modules/b.js', 'backups/readme.txt',
        'client/dist/index.html', 'some/where.sql.gz', '.DS_Store',
    ]) ok(isKeptPath(rel), `kept: ${rel}`);
    for (const rel of ['server/.env.example', 'server/index.js', 'scripts/launch.js', 'Update AMA (Mac).command', 'client/src/App.jsx', 'README.md']) {
        ok(!isKeptPath(rel), `updated: ${rel}`);
    }

    // This computer's copy: program files from an older version, plus its own settings and data.
    const root = path.join(tmp, 'copy');
    const settings = {
        'server/.env': 'DB_PASSWORD=the-real-one\nTELEGRAM_BOT_TOKEN=real-token\n',
        'backups/ama-backup-2026-11-10_03-00-00.sql.gz': 'a backup',
        'server/logs/orders-2026-11.jsonl': '{"a":1}',
        '.ama_runtime/server.pid': '1234',
        'server/node_modules/express/index.js': 'installed package',
        'client/dist/index.html': 'built client',
        'my-notes.txt': 'a file of the user, never part of the system',
    };
    for (const [rel, text] of Object.entries(settings)) put(root, rel, text);
    put(root, 'server/index.js', 'old server');
    put(root, 'scripts/launch.js', 'old launcher');
    put(root, 'client/src/App.jsx', 'same in both');
    put(root, 'scripts/gone.js', 'brought by the previous update, dropped since');
    put(root, 'Update AMA (Mac).command', '#!/bin/bash\necho old\n');

    // The new version, as unpacked from GitHub's ZIP - including files it must never be allowed to place.
    const from = path.join(tmp, 'new');
    put(from, 'server/index.js', 'new server');
    put(from, 'scripts/launch.js', 'new launcher');
    put(from, 'client/src/App.jsx', 'same in both');
    put(from, 'client/src/New.jsx', 'a new file');
    put(from, 'Update AMA (Mac).command', '#!/bin/bash\necho new\n');
    put(from, 'server/.env', 'DB_PASSWORD=from-the-zip\n');
    put(from, 'backups/evil.sql.gz', 'not a real backup');
    put(from, 'backups/readme.txt', 'any file, not only backups');
    put(from, '.ama_runtime/server.pid', '9999');
    put(from, 'server/node_modules/express/index.js', 'from the zip');
    put(from, 'client/dist/index.html', 'from the zip');

    console.log('\nPlanning (nothing changes yet)');
    // What the previous update brought (the system's own files only - the list comes from the ZIP).
    const previous = ['server/index.js', 'scripts/launch.js', 'client/src/App.jsx', 'scripts/gone.js', 'Update AMA (Mac).command'];
    const plan = planUpdate(from, root, previous);
    ok(JSON.stringify(plan.changed) === JSON.stringify(['Update AMA (Mac).command', 'scripts/launch.js', 'server/index.js']), 'changed: exactly the program files that differ', JSON.stringify(plan.changed));
    ok(JSON.stringify(plan.added) === JSON.stringify(['client/src/New.jsx']), 'new: the new file', JSON.stringify(plan.added));
    ok(JSON.stringify(plan.removed) === JSON.stringify(['scripts/gone.js']), 'removed: only a file the previous update brought that the new version dropped', JSON.stringify(plan.removed));
    ok(!plan.files.some(isKeptPath), 'the plan has no setting, backup, package or build file in it');
    ok(read(root, 'server/index.js') === 'old server', 'planning alone changes nothing');

    console.log('\nApplying');
    applyUpdate(from, root, plan);
    ok(read(root, 'server/index.js') === 'new server' && read(root, 'scripts/launch.js') === 'new launcher', 'program files are replaced');
    ok(read(root, 'client/src/New.jsx') === 'a new file', 'a new file is added');
    ok(read(root, 'scripts/gone.js') === null, 'the dropped file is removed');
    for (const [rel, text] of Object.entries(settings)) ok(read(root, rel) === text, `left exactly as it was: ${rel}`);
    ok(read(root, 'backups/evil.sql.gz') === null && read(root, 'backups/readme.txt') === null, 'nothing from the ZIP lands in backups/ - of any kind');
    if (process.platform !== 'win32') {
        const mode = fs.statSync(path.join(root, 'Update AMA (Mac).command')).mode & 0o777;
        ok(mode === 0o755, 'the .command file can still be double-clicked (mode 755)', mode.toString(8));
    }

    console.log('\nRunning it again');
    const again = planUpdate(from, root, plan.files);
    ok(!again.changed.length && !again.added.length && !again.removed.length, 'nothing left to do: "already up to date"');

    console.log('\nA first update (no record of a previous one)');
    const fresh = planUpdate(from, root, null);
    ok(fresh.removed.length === 0, 'removes nothing at all');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
