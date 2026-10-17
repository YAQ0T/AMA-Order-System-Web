#!/usr/bin/env node
/**
 * Database health check.  Run:  npm run db:check
 *
 * Verifies, in the order things actually go wrong:
 *   1. the driver can authenticate (catches an unsupported auth plugin)
 *   2. the server version is new enough
 *   3. the database's charset/collation will not destroy Arabic
 *   4. Sequelize's dialect support works against this server version
 *   5. Arabic genuinely round-trips through a real table
 *   6. DECIMAL still arrives as a string, which the web client relies on
 *
 * Step 5 is the one that matters most. Everything can look configured and still
 * mangle Arabic into "????" - the only proof is writing it and reading it back.
 */
require('dotenv').config();

const { Sequelize, DataTypes } = require('sequelize');

const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => console.log(`  ✗ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);

const DB_NAME = process.env.DB_NAME;
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = Number(process.env.DB_PORT) || 3306;

let problems = 0;

async function main() {
  console.log('\nChecking database setup\n');
  console.log(`  target: ${DB_USER_DISPLAY()}@${DB_HOST}:${DB_PORT}/${DB_NAME || '(DB_NAME not set!)'}\n`);

  if (!DB_NAME) {
    fail('DB_NAME is not set. Copy server/.env.example to server/.env and fill it in.');
    process.exit(1);
  }

  const sequelize = new Sequelize(DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: DB_HOST,
    port: DB_PORT,
    dialect: 'mysql',
    logging: false,
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    define: { charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
    dialectOptions: { charset: 'utf8mb4', decimalNumbers: false },
  });

  // --- 1. connect -----------------------------------------------------------
  try {
    await sequelize.authenticate();
    pass('connected and authenticated');
  } catch (error) {
    const code = error.original?.code || error.parent?.code || error.name;
    fail(`cannot connect: ${code}`);
    if (code === 'ER_NOT_SUPPORTED_AUTH_MODE') {
      console.log('\n    MySQL is using an authentication plugin this driver does not support.');
      console.log('    Either re-run the MySQL installer and choose "Use Strong Password');
      console.log('    Encryption", or change the user:\n');
      console.log(`      ALTER USER '${process.env.DB_USER}'@'localhost'`);
      console.log("        IDENTIFIED WITH caching_sha2_password BY 'your_password';");
      console.log('      FLUSH PRIVILEGES;');
    } else if (code === 'ER_BAD_DB_ERROR') {
      console.log(`\n    The database "${DB_NAME}" does not exist yet. Create it with:\n`);
      console.log(`      CREATE DATABASE ${DB_NAME}`);
      console.log('        CHARACTER SET utf8mb4');
      console.log('        COLLATE utf8mb4_unicode_ci;');
    } else if (code === 'ECONNREFUSED') {
      console.log('\n    Nothing is listening. Is the MySQL service running (services.msc)?');
    } else if (code === 'ER_ACCESS_DENIED_ERROR') {
      console.log('\n    Wrong DB_USER / DB_PASSWORD in server/.env.');
    }
    console.log('');
    process.exit(1);
  }

  // --- 2. server version ----------------------------------------------------
  try {
    const version = await sequelize.databaseVersion();
    const major = parseInt(version, 10);
    // 5.7 is the floor: DataTypes.JSON and the 3072-byte index limit.
    // MySQL switched to calendar versioning, so anything >= 8 is fine, and a
    // year-based number like 26.x is fine too.
    if (Number.isFinite(major) && (major >= 8 || version.startsWith('5.7'))) {
      pass(`server version ${version}`);
    } else {
      fail(`server version ${version} - this app needs MySQL 5.7 or newer`);
      problems++;
    }
  } catch {
    warn('could not read the server version');
  }

  // --- 3. database charset --------------------------------------------------
  try {
    const [[row]] = await sequelize.query(
      `SELECT DEFAULT_CHARACTER_SET_NAME cs, DEFAULT_COLLATION_NAME co
       FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`,
      { replacements: [DB_NAME] }
    );

    if (row?.cs === 'utf8mb4') {
      pass(`database charset ${row.cs} / ${row.co}`);
    } else {
      fail(`database charset is "${row?.cs}", not utf8mb4 - Arabic WILL be corrupted`);
      console.log('\n    Fix it before creating any data:\n');
      console.log(`      DROP DATABASE ${DB_NAME};`);
      console.log(`      CREATE DATABASE ${DB_NAME}`);
      console.log('        CHARACTER SET utf8mb4');
      console.log('        COLLATE utf8mb4_unicode_ci;\n');
      problems++;
    }

    if (row?.co && /_bin$|_cs$/.test(row.co)) {
      warn(`collation ${row.co} is case-sensitive - order search will not match case-insensitively`);
      problems++;
    }
  } catch {
    warn('could not read the database charset');
  }

  // --- 4 & 5. real round-trip through a real table --------------------------
  // This is the decisive test: Sequelize creating a table on this server
  // version, then Arabic and DECIMAL surviving a write and a read.
  const Probe = sequelize.define(
    '_ama_probe',
    {
      label: { type: DataTypes.STRING, allowNull: false },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    },
    { tableName: '_ama_probe', timestamps: false }
  );

  const ARABIC = 'طحينة نابلس — زبون ١٢٣';

  try {
    await Probe.sync({ force: true });
    pass('Sequelize can create tables on this server version');

    await Probe.create({ label: ARABIC, amount: '12.50' });
    const found = await Probe.findOne({ where: {} });

    if (found.label === ARABIC) {
      pass(`Arabic round-trips intact: ${found.label}`);
    } else {
      fail(`Arabic was corrupted on the round-trip: got "${found.label}"`);
      problems++;
    }

    if (typeof found.amount === 'string') {
      pass(`DECIMAL returns a string ("${found.amount}"), as the web client expects`);
    } else {
      warn(`DECIMAL returned a ${typeof found.amount} - check decimalNumbers in db.js`);
      problems++;
    }

    // Case-insensitive LIKE is what replaced Postgres ILIKE for order search.
    const hit = await Probe.findOne({
      where: sequelize.where(sequelize.col('label'), 'LIKE', '%نابلس%'),
    });
    if (hit) {
      pass('LIKE matches Arabic substrings (order search will work)');
    } else {
      fail('LIKE did not match an Arabic substring - order search would be broken');
      problems++;
    }
  } catch (error) {
    fail(`table round-trip failed: ${error.message}`);
    problems++;
  } finally {
    try {
      await sequelize.getQueryInterface().dropTable('_ama_probe');
    } catch {
      warn('could not drop the temporary _ama_probe table; drop it manually');
    }
  }

  await sequelize.close();

  console.log('');
  if (problems === 0) {
    console.log('  All good. Start the server with:  npm run dev\n');
    process.exit(0);
  } else {
    console.log(`  ${problems} problem(s) found - see above.\n`);
    process.exit(1);
  }
}

function DB_USER_DISPLAY() {
  return process.env.DB_USER || '(DB_USER not set)';
}

main().catch((error) => {
  console.error('\nUnexpected failure:', error);
  process.exit(1);
});
