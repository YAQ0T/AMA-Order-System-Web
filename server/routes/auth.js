const express = require('express');
const bcrypt = require('bcryptjs');
const { User } = require('../db');
const { authenticateToken, signToken, forgetUser } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLogger');

const router = express.Router();

// Anyone can sign up, so admin is never one of the choices: an admin account
// can only come from seedAdmin (first start). Accepting role "admin" here used
// to give anyone on the network a working admin account.
const SELF_SERVICE_ROLES = new Set(['maker', 'taker', 'accounter']);
const MIN_PASSWORD = 6;
const DEFAULT_ADMIN_PASSWORD = 'admin123';

const publicUser = (user) => ({
    id: user.id,
    username: user.username,
    role: user.role,
    isApproved: user.isApproved,
    prefersDark: user.prefersDark
});

const passwordProblem = (password) => {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
        return `Password must be at least ${MIN_PASSWORD} characters`;
    }
    if (password.length > 100) return 'Password is too long';
    return null;
};

// ---------------------------------------------------------------------------
// Failed-login throttling (in memory). Each username+address gets 8 tries per
// 15 minutes, each address 30 across all usernames - plenty for a person
// mistyping, far too few for a program guessing passwords.
const WINDOW_MS = 15 * 60 * 1000;
const LIMITS = { name: 8, ip: 30 };
const failures = new Map(); // key -> { count, first, blockedUntil }

const lockedFor = (key) => {
    const entry = failures.get(key);
    return entry?.blockedUntil && entry.blockedUntil > Date.now() ? entry.blockedUntil - Date.now() : 0;
};
const recordFailure = (key, limit) => {
    const now = Date.now();
    let entry = failures.get(key);
    if (!entry || now - entry.first > WINDOW_MS) entry = { count: 0, first: now };
    entry.count += 1;
    if (entry.count >= limit) entry.blockedUntil = now + WINDOW_MS;
    failures.set(key, entry);
};
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of failures) {
        if (now - entry.first > WINDOW_MS && !(entry.blockedUntil > now)) failures.delete(key);
    }
}, 10 * 60 * 1000).unref();

// ---------------------------------------------------------------------------

router.post('/register', async (req, res) => {
    try {
        const { username, password, role } = req.body || {};
        const name = typeof username === 'string' ? username.trim() : '';

        if (name.length < 3 || name.length > 40) {
            return res.status(400).json({ error: 'Username must be 3-40 characters' });
        }
        const problem = passwordProblem(password);
        if (problem) return res.status(400).json({ error: problem });
        if (!SELF_SERVICE_ROLES.has(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        const user = await User.create({
            username: name,
            password,
            role,
            isApproved: false
        });

        await logActivity(user.id, 'user_registered', 'user', user.id, {
            username: user.username,
            role: user.role
        }, req.ip);

        res.status(201).json({
            message: 'User created successfully',
            requiresApproval: true
        });
    } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({ error: 'Username already taken' });
        }
        res.status(400).json({ error: error.message });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body || {};
        const name = typeof username === 'string' ? username.trim() : '';
        const nameKey = `n:${name.toLowerCase()}|${req.ip}`;
        const ipKey = `ip:${req.ip}`;

        const wait = Math.max(lockedFor(nameKey), lockedFor(ipKey));
        if (wait) {
            const minutes = Math.ceil(wait / 60000);
            res.set('Retry-After', String(Math.ceil(wait / 1000)));
            return res.status(429).json({
                error: `Too many failed login attempts. Try again in ${minutes} minutes.`,
                retryAfterMinutes: minutes
            });
        }

        const user = name ? await User.findOne({ where: { username: name } }) : null;
        if (!user || typeof password !== 'string' || !(await bcrypt.compare(password, user.password))) {
            recordFailure(nameKey, LIMITS.name);
            recordFailure(ipKey, LIMITS.ip);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        failures.delete(nameKey);

        if (user.role !== 'admin' && !user.isApproved) {
            // approvedAt is set once an admin approves someone; an account that
            // has it but is not approved was deactivated later.
            if (user.approvedAt) {
                return res.status(403).json({ error: 'This account has been deactivated', deactivated: true });
            }
            return res.status(403).json({
                error: 'Account pending admin approval',
                requiresApproval: true
            });
        }

        await logActivity(user.id, 'user_login', 'user', user.id, {
            username: user.username
        }, req.ip);

        res.json({
            token: signToken(user),
            user: publicUser(user),
            // The seeded admin password is printed in the README and the
            // server log; the app nags until it is changed.
            mustChangePassword: user.role === 'admin' && password === DEFAULT_ADMIN_PASSWORD
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

// PUT /api/auth/password - change your own password. Ends your other sessions
// (their tokens carry the old password stamp) and returns a fresh token for this one.
router.put('/password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body || {};
        const problem = passwordProblem(newPassword);
        if (problem) return res.status(400).json({ error: problem });

        const user = await User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // 400, not 401: a wrong current password must not log the person out.
        if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, user.password))) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }
        if (await bcrypt.compare(newPassword, user.password)) {
            return res.status(400).json({ error: 'The new password must be different from the current one' });
        }

        // The model only hashes on create, so hash here.
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        forgetUser(user.id);

        await logActivity(user.id, 'user_password_changed', 'user', user.id, { username: user.username }, req.ip);

        res.json({ token: signToken(user), user: publicUser(user) });
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

        res.json({ user: publicUser(user) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// The people a maker can pick from. Only approved, active accounts: a pending
// or deactivated user cannot log in, so an order assigned to them reaches no one.
router.get('/takers', authenticateToken, async (req, res) => {
    try {
        const takers = await User.findAll({
            where: { role: 'taker', isApproved: true },
            attributes: ['id', 'username', 'role'],
            order: [['username', 'ASC']]
        });
        res.json(takers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/accounters', authenticateToken, async (req, res) => {
    try {
        const accounters = await User.findAll({
            where: { role: 'accounter', isApproved: true },
            attributes: ['id', 'username', 'role'],
            order: [['username', 'ASC']]
        });
        res.json(accounters);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
