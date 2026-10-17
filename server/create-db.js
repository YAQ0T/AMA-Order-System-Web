#!/usr/bin/env node
/**
 * Creates the database with the correct charset.  Run:  npm run db:create
 *
 * This exists so you do not need the `mysql` command-line client (the MySQL
 * installer often omits it), and more importantly so the charset cannot be got
 * wrong. Creating the database through a GUI usually accepts a default that is
 * not utf8mb4, and Arabic then stores as "????" - which is only noticed after
 * there is data worth keeping.
 *
 * Safe to re-run: it will not touch a database that already exists, and it
 * never drops anything.
 */
require('dotenv').config();

const mysql = require('mysql2/promise');

const DB_NAME = process.env.DB_NAME;
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = Number(process.env.DB_PORT) || 3306;
const DB_USER = process.env.DB_USER;

const CHARSET = 'utf8mb4';
const COLLATION = 'utf8mb4_unicode_ci';

// Database names are identifiers and cannot be parameterised, so validate
// rather than interpolate blindly.
const VALID_NAME = /^[A-Za-z0-9_$]+$/;

async function main() {
  console.log('');

  if (!DB_NAME) {
    console.error('  DB_NAME is not set. Copy server/.env.example to server/.env first.\n');
    process.exit(1);
  }
  if (!VALID_NAME.test(DB_NAME)) {
    console.error(`  DB_NAME "${DB_NAME}" contains unexpected characters.`);
    console.error('  Use letters, numbers and underscores only.\n');
    process.exit(1);
  }

  let connection;
  try {
    // Connect WITHOUT selecting a database - it may not exist yet.
    connection = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: process.env.DB_PASSWORD,
    });
  } catch (error) {
    console.error(`  Cannot connect to MySQL at ${DB_HOST}:${DB_PORT} - ${error.code}\n`);
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('  Wrong DB_USER / DB_PASSWORD in server/.env.');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('  Is the MySQL service running? (services.msc)');
    } else if (error.code === 'ER_NOT_SUPPORTED_AUTH_MODE') {
      console.error('  MySQL is using an auth plugin this driver does not support.');
      console.error('  Re-run the MySQL installer and choose "Use Strong Password Encryption".');
    }
    console.error('');
    process.exit(1);
  }

  try {
    const [existing] = await connection.query(
      `SELECT DEFAULT_CHARACTER_SET_NAME cs, DEFAULT_COLLATION_NAME co
       FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`,
      [DB_NAME]
    );

    if (existing.length > 0) {
      const { cs, co } = existing[0];
      if (cs === CHARSET) {
        console.log(`  Database "${DB_NAME}" already exists (${cs} / ${co}). Nothing to do.\n`);
      } else {
        console.log(`  Database "${DB_NAME}" already exists, but its charset is "${cs}", not ${CHARSET}.`);
        console.log('  Arabic will be corrupted.\n');
        console.log('  If it has no data worth keeping, drop and recreate it:\n');
        console.log(`      DROP DATABASE ${DB_NAME};`);
        console.log('      then run this command again\n');
        console.log('  If it DOES have data, converting in place is possible but needs care -');
        console.log('  ask before doing it, because a bad conversion is not reversible.\n');
        process.exitCode = 1;
      }
      return;
    }

    await connection.query(
      `CREATE DATABASE \`${DB_NAME}\` CHARACTER SET ${CHARSET} COLLATE ${COLLATION}`
    );
    console.log(`  Created database "${DB_NAME}" (${CHARSET} / ${COLLATION}).\n`);
    console.log('  Next:  npm run db:check\n');
  } catch (error) {
    console.error(`  Failed to create the database: ${error.code || error.message}\n`);
    if (error.code === 'ER_DBACCESS_DENIED_ERROR') {
      console.error(`  User "${DB_USER}" lacks CREATE privileges. Use an admin account,`);
      console.error('  or have someone create the database for you.\n');
    }
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('\nUnexpected failure:', error);
  process.exit(1);
});
