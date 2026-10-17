const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { User } = require('../db');
const { SECRET_KEY } = require('../middleware/auth');
const { authenticateToken } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLogger');

const router = express.Router();

router.post('/register', async (req, res) => {
    try {
        const { username, password, role } = req.body;

        // Create user with isApproved=false (will be auto-approved for admin in beforeCreate hook)
        const user = await User.create({
            username,
            password,
            role,
            isApproved: false // Explicitly set to false, will be overridden for admin
        });

        // Log the registration
        await logActivity(user.id, 'user_registered', 'user', user.id, {
            username: user.username,
            role: user.role
        }, req.ip);

        res.status(201).json({
            message: 'User created successfully',
            requiresApproval: user.role !== 'admin'
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});


router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ where: { username } });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check if user is approved (skip check for admin)
        if (user.role !== 'admin' && !user.isApproved) {
            return res.status(403).json({
                error: 'Account pending admin approval',
                requiresApproval: true
            });
        }

        // Log successful login
        await logActivity(user.id, 'user_login', 'user', user.id, {
            username: user.username
        }, req.ip);

        const token = jwt.sign({
            id: user.id,
            username: user.username,
            role: user.role,
            isApproved: user.isApproved
        }, SECRET_KEY, { expiresIn: '365d' });

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                isApproved: user.isApproved,
                prefersDark: user.prefersDark
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Verify current session and return user profile
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id, {
            attributes: ['id', 'username', 'role', 'isApproved', 'prefersDark']
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update user theme preference
router.put('/theme', authenticateToken, async (req, res) => {
    try {
        const { prefersDark } = req.body;
        if (typeof prefersDark !== 'boolean') {
            return res.status(400).json({ error: 'prefersDark must be a boolean' });
        }

        const user = await User.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.prefersDark = prefersDark;
        await user.save();

        await logActivity(user.id, 'user_theme_updated', 'user', user.id, { prefersDark }, req.ip);

        res.json({
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                isApproved: user.isApproved,
                prefersDark: user.prefersDark
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all takers (for Makers to assign)
router.get('/takers', authenticateToken, async (req, res) => {
    try {
        const takers = await User.findAll({
            where: { role: 'taker' },
            attributes: ['id', 'username', 'role']
        });
        res.json(takers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all accounters (for Makers to assign)
router.get('/accounters', authenticateToken, async (req, res) => {
    try {
        const accounters = await User.findAll({
            where: { role: 'accounter' },
            attributes: ['id', 'username', 'role']
        });
        res.json(accounters);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
