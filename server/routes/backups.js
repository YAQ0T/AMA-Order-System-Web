const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { logActivity } = require('../utils/activityLogger');
const backup = require('../utils/backup');

const router = express.Router();

// Backups contain every row in the database, password hashes included.
router.use(authenticateToken, requireAdmin);

const publicEntry = (b) => ({ name: b.name, size: b.size, createdAt: b.createdAt, label: b.label ?? null });

// GET /api/admin/backups - settings, last result, and the list (newest first)
router.get('/', (req, res) => {
    try {
        res.json({ status: backup.getStatus(), backups: backup.listBackups().map(publicEntry) });
    } catch (error) {
        console.error('Error listing backups:', error);
        res.status(500).json({ error: 'Could not read the backups folder' });
    }
});

// POST /api/admin/backups - take one now
router.post('/', async (req, res) => {
    try {
        const result = await backup.createBackup({ label: 'manual' });
        await logActivity(req.user.id, 'backup_created', 'system', null, { name: result.name, size: result.size }, req.ip);
        res.status(201).json({ ...publicEntry({ ...result, label: 'manual' }), tables: result.tables });
    } catch (error) {
        res.status(500).json({ error: `Backup failed: ${error.message}` });
    }
});

// GET /api/admin/backups/:name/download
// The name must match the backup naming pattern exactly (resolveBackup), so
// this can never be used to read any other file.
router.get('/:name/download', async (req, res) => {
    const file = backup.resolveBackup(req.params.name);
    if (!file) return res.status(404).json({ error: 'Backup not found' });
    await logActivity(req.user.id, 'backup_downloaded', 'system', null, { name: req.params.name }, req.ip);
    res.download(file, req.params.name);
});

module.exports = router;
