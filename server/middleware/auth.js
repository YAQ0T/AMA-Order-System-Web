const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// A missing or example secret would let anyone forge a login. Fall back to a
// random one for this run instead - logins then simply do not survive a
// restart. "Start AMA" (scripts/launch.js) writes a permanent one into .env.
const PLACEHOLDERS = new Set(['', 'your-secret-key', 'change-me-to-a-long-random-string']);
let SECRET_KEY = (process.env.JWT_SECRET || '').trim();
if (PLACEHOLDERS.has(SECRET_KEY)) {
    SECRET_KEY = crypto.randomBytes(48).toString('hex');
    console.warn('[auth] JWT_SECRET is not set in server/.env - using a random one for this run, so everyone has to log in again after each restart.');
}

/**
 * A short fingerprint of the stored password hash. It goes into each token,
 * so changing a password ends every session that was opened with the old one.
 */
const passwordStamp = (hash) => crypto.createHash('sha256').update(String(hash)).digest('base64url').slice(0, 12);

const signToken = (user) => jwt.sign({
    id: user.id,
    username: user.username,
    role: user.role,
    isApproved: user.isApproved,
    pwd: passwordStamp(user.password),
}, SECRET_KEY, { expiresIn: '365d' });

// Tokens last a year, so who they belong to is re-checked against the database
// (at most every 15 seconds per user): a deleted or deactivated account loses
// access right away, and a role change takes effect without logging out.
const CACHE_MS = 15_000;
const cache = new Map(); // id -> { at, user }

/** Drop a user from the cache after changing them, so the change applies at once. */
const forgetUser = (id) => cache.delete(Number(id));

async function loadUser(id) {
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.user;
    const { User } = require('../db');
    const row = await User.findByPk(id, { attributes: ['id', 'username', 'role', 'isApproved', 'password'] });
    const user = row && {
        id: row.id,
        username: row.username,
        role: row.role,
        isApproved: row.isApproved,
        stamp: passwordStamp(row.password),
    };
    cache.set(id, { at: Date.now(), user });
    return user;
}

/**
 * Every "not logged in any more" answer is a 401 with a JSON body. The web
 * client logs out on a 401 and shows the login page; an invalid token used to
 * get a bare 403, which the client could not tell from "not allowed", leaving
 * people stuck on errors after, for example, the secret changed.
 */
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Not logged in' });

    jwt.verify(token, SECRET_KEY, async (err, claims) => {
        if (err) return res.status(401).json({ error: 'Session expired, please log in again' });
        try {
            const user = await loadUser(Number(claims.id));
            if (!user) return res.status(401).json({ error: 'This account no longer exists' });
            // Tokens issued before password stamps existed carry none; they stay valid.
            if (claims.pwd && claims.pwd !== user.stamp) {
                return res.status(401).json({ error: 'Your password was changed, please log in again' });
            }
            if (user.role !== 'admin' && !user.isApproved) {
                return res.status(401).json({ error: 'This account has been deactivated', deactivated: true });
            }
            req.user = { id: user.id, username: user.username, role: user.role, isApproved: user.isApproved };
            next();
        } catch (e) {
            console.error('Session check failed:', e.message);
            res.status(503).json({ error: 'Cannot check the session right now' });
        }
    });
};

module.exports = { authenticateToken, signToken, forgetUser, passwordStamp, SECRET_KEY };
