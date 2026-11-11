#!/usr/bin/env node
/**
 * Take a backup now:  npm run db:backup
 * Works whether or not the system is running. Saved in the backups folder
 * (BACKUP_DIR in server/.env), next to the automatic ones.
 *
 * `node backup-db.js before-update` labels it as the safety copy that
 * "Update AMA" takes before it changes anything (kept like the copies taken
 * before a restore). Without an argument it is a "manual" backup.
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const backup = require('./utils/backup');

const label = process.argv[2] === 'before-update' ? 'before-update' : 'manual';

backup.createBackup({ label }).then(
    (result) => {
        console.log(`\n  Saved: ${result.file}\n`);
    },
    (err) => {
        console.error(`\n  Backup failed: ${err.message}\n`);
        process.exit(1);
    }
);
