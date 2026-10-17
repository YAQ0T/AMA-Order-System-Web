require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const net = require('net');
const { DataTypes } = require('sequelize');
const { sequelize, OrderAssignments, Order, User, OrderItem } = require('./db');
const { seedAdmin } = require('./utils/seedAdmin');

const app = express();
const PREFERRED_PORT = Number(process.env.PORT) || 6001;

const os = require('os');

const listLanAddresses = () => {
    const out = [];
    for (const entries of Object.values(os.networkInterfaces() || {})) {
        for (const entry of entries || []) {
            if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address);
        }
    }
    return out;
};

const isPortAvailable = (port) => new Promise((resolve, reject) => {
    const tester = net
        .createServer()
        .once('error', (err) => {
            if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
                resolve(false);
            } else {
                reject(err);
            }
        })
        .once('listening', () => {
            tester.close(() => resolve(true));
        })
        .listen(port, '0.0.0.0');
});

const findAvailablePort = async (preferredPort, attempts = 10) => {
    const available = await isPortAvailable(preferredPort);
    if (available) {
        return preferredPort;
    }

    throw new Error(`Port ${preferredPort} is not available. Please stop the process using it or set PORT env.`);
};

// Middleware: allow all origins (mobile/web clients on LAN)
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());

// Certificate Authentication Middleware - DISABLED
// const { validateClientCertificate } = require('./middleware/certificateAuth');
// app.use(validateClientCertificate);

// Sync Database and seed admin
const syncDatabase = async () => {
    // 1) Connection first, with a message that says what to actually fix.
    //    Bad credentials or a stopped MySQL service is the most common setup
    //    failure, and a generic stack trace does not help anyone.
    try {
        await sequelize.authenticate();
        console.log(`Connected to MySQL "${process.env.DB_NAME}" at ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}`);
    } catch (error) {
        // Sequelize's connection errors often carry an empty message, so go by
        // the driver's error code instead and say what to actually do about it.
        const code = error.original?.code || error.parent?.code || error.name;
        const host = process.env.DB_HOST || 'localhost';
        const port = process.env.DB_PORT || 3306;

        const advice = {
            ECONNREFUSED: [
                `Nothing is accepting connections on ${host}:${port}.`,
                '  - Is the MySQL service running? (services.msc on Windows)',
                '  - Is DB_PORT right? MySQL uses 3306; 3307 is common when two are installed.',
            ],
            ER_ACCESS_DENIED_ERROR: [
                `MySQL rejected the credentials for user "${process.env.DB_USER}".`,
                '  - Check DB_USER and DB_PASSWORD in server/.env.',
                '  - A blank password must be an empty value, not the word "null".',
            ],
            ER_BAD_DB_ERROR: [
                `Connected to MySQL, but the database "${process.env.DB_NAME}" does not exist.`,
                '  - Create it first. IMPORTANT, use utf8mb4 or Arabic will be stored as "????":',
                '',
                `      CREATE DATABASE ${process.env.DB_NAME || 'ama_order_system'}`,
                '        CHARACTER SET utf8mb4',
                '        COLLATE utf8mb4_unicode_ci;',
            ],
            ENOTFOUND: [`The host "${host}" could not be resolved. Check DB_HOST.`],
            ETIMEDOUT: [`Timed out reaching ${host}:${port}. A firewall is the usual cause.`],
        }[code];

        console.error('\n  Cannot connect to the database.');
        console.error(`  ${code || 'Unknown error'}${error.original?.message ? ': ' + error.original.message : ''}\n`);

        if (advice) {
            advice.forEach((line) => console.error(`  ${line}`));
        } else {
            console.error('  Check DB_NAME / DB_USER / DB_PASSWORD / DB_HOST / DB_PORT in server/.env,');
            console.error('  and that MySQL is running. See server/.env.example.');
        }
        console.error('');
        return;
    }

    // 2) Create any missing tables. This must run BEFORE the legacy checks
    //    below: on a fresh database `describeTable` throws, and when that
    //    happened inside the same try block it skipped sync() entirely and
    //    left the server running against an empty schema.
    try {
        await sequelize.sync();
        console.log('Database synced');
    } catch (error) {
        console.error('Failed to create tables:', error);
        return;
    }

    // 3) Legacy migration for installs that predate Orders.accounterId.
    //    Harmless on a fresh database - the column is already there.
    try {
        const queryInterface = sequelize.getQueryInterface();
        const orderTable = await queryInterface.describeTable('Orders');

        if (!orderTable.accounterId) {
            await queryInterface.addColumn('Orders', 'accounterId', {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: 'Users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            });
            console.log('Added accounterId column to Orders table');
        }
    } catch (error) {
        console.error('Could not check for legacy columns:', error.message);
    }

    // 4) Schema alteration is OPT-IN, and deliberately off by default.
    //
    //    These calls exist to migrate old installs that lack columns added
    //    later (Order.description nullable, User.email, OrderItem.status).
    //    On a fresh database they are pure no-ops.
    //
    //    Running `alter: true` on every start is actively risky on MySQL:
    //    Sequelize re-adds indexes it thinks are missing, and these models
    //    carry a lot of them (Orders alone has six). MySQL caps a table at 64
    //    keys, so repeated restarts can accumulate duplicate indexes until
    //    ALTER TABLE fails outright. Turn it on for one run when migrating,
    //    then turn it off.
    if (process.env.DB_ALTER === 'true') {
        console.warn('DB_ALTER=true - altering schema. Use this for a migration, not routinely.');
        for (const model of [Order, User, OrderItem]) {
            try {
                await model.sync({ alter: true });
                console.log(`${model.name} table altered`);
            } catch (err) {
                console.error(`Error altering ${model.name} table:`, err.message);
            }
        }
    }

    // 5) Seed the default admin if there is none.
    try {
        await seedAdmin();
    } catch (error) {
        console.error('Failed to seed admin user:', error.message);
    }
};

syncDatabase();

// Routes
const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');
const orderMakerRoutes = require('./routes/orders_maker');
const orderTakerRoutes = require('./routes/orders_taker');
const orderAdminRoutes = require('./routes/orders_admin');
const orderAccounterRoutes = require('./routes/orders_accounter');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');

app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/orders', orderMakerRoutes);
app.use('/api/orders', orderTakerRoutes);
app.use('/api/orders', orderAdminRoutes);
app.use('/api/orders', orderAccounterRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/items', require('./routes/items'));

// Health check (handy for checking the API is reachable from a browser/LAN device)
app.get('/api/health', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
});

// Serve the built React client from client/dist when it has been built.
// This makes the whole app single-origin: no CORS, no VITE_API_URL to configure.
const path = require('path');
const fs = require('fs');
const clientDist = path.join(__dirname, '..', 'client', 'dist');

if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist));
    // SPA fallback: anything that is not /api/* returns index.html so deep links work.
    app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
        res.sendFile(path.join(clientDist, 'index.html'));
    });
    console.log('Serving web client from', clientDist);
} else {
    console.log('No client build found at', clientDist, '- run `npm run build` in client/ to serve it from here.');
}

// Export for routes to use
module.exports = { app, sequelize };

const startServer = async () => {
    const portToUse = await findAvailablePort(PREFERRED_PORT);

    http.createServer(app).listen(portToUse, '0.0.0.0', () => {
        console.log(`HTTP server running on http://localhost:${portToUse}`);
        for (const addr of listLanAddresses()) {
            console.log(`Also accessible on the LAN at http://${addr}:${portToUse}`);
        }
    });
};

// Start HTTP Server
if (require.main === module) {
    startServer().catch((error) => {
        console.error('Failed to start server:', error);
        process.exit(1);
    });
}
