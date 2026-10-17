#!/usr/bin/env node
/**
 * Take a backup now:  npm run db:backup
 * Works whether or not the system is running. Saved in the backups folder
 * (BACKUP_DIR in server/.env), next to the automatic ones.
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const backup = require('./utils/backup');

backup.createBackup({ label: 'manual' }).then(
    (result) => {
        console.log(`\n  Saved: ${result.file}\n`);
    },
    (err) => {
        console.error(`\n  Backup failed: ${err.message}\n`);
        process.exit(1);
    }
);
