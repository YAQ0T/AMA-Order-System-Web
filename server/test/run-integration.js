#!/usr/bin/env node
/**
 * Integration tests against the REAL server and a REAL MySQL database.
 * Run:  npm run test:integration
 *
 * These are the tests that matter for data safety. The client's unit tests and
 * the mock API cannot see server-side races: the "two takers undo each other"
 * bug lost a tick in 20 of 20 rounds here, and was invisible everywhere else.
 *
 * Your own database is never touched. The runner:
 *   1. creates a throwaway database named <DB_NAME>_test
 *   2. starts a second copy of the server on a free port, pointed at it
 *   3. runs each suite on a freshly reset database
 *   4. stops that server and drops the throwaway database
 *
 * It uses the MySQL credentials from server/.env.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');

const SERVER_DIR = path.join(__dirname, '..');
const SUITES = ['api.test.mjs', 'concurrency.test.mjs'];
const REAL_DB = process.env.DB_NAME;
const TEST_DB = `${REAL_DB}_test`;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!REAL_DB) fail('DB_NAME is not set in server/.env.');
// Belt and braces: never run against anything that is not clearly a test DB.
if (TEST_DB === REAL_DB || !TEST_DB.endsWith('_test') || !/^[A-Za-z0-9_$]+$/.test(TEST_DB)) {
  fail(`Refusing to use "${TEST_DB}" as a test database.`);
}

const connect = () =>
  mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

async function resetDatabase() {
  const c = await connect();
  await c.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  await c.query(`CREATE DATABASE \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await c.end();
}

async function dropDatabase() {
  const c = await connect();
  await c.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  await c.end();
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

async function startServer(port) {
  let output = '';
  const child = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, DB_NAME: TEST_DB, PORT: String(port), DB_ALTER: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));

  // The HTTP port opens before the database is synced, so /api/health alone
  // is not enough. Ready means the seeded admin can log in.
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const r = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' }),
      });
      if (r.status === 200) return { child, base };
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  child.kill();
  console.error(output);
  fail('The test server did not become ready within 30 seconds (output above).');
}

function runSuite(file, base) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, file), base], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code === 0));
  });
}

async function main() {
  console.log(`\nIntegration tests - throwaway database "${TEST_DB}" (yours, "${REAL_DB}", is not touched)`);

  try {
    await (await connect()).end();
  } catch (error) {
    fail(`Cannot connect to MySQL: ${error.code || error.message}. Run "npm run db:check" first.`);
  }

  const results = [];
  try {
    for (const suite of SUITES) {
      await resetDatabase(); // each suite starts from an empty database
      const port = await freePort();
      const { child, base } = await startServer(port);
      try {
        results.push([suite, await runSuite(suite, base)]);
      } finally {
        child.kill();
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  } finally {
    await dropDatabase();
  }

  console.log('Summary');
  for (const [suite, ok] of results) console.log(`  ${ok ? '✓' : '✗'} ${suite}`);
  console.log(`  (throwaway database "${TEST_DB}" dropped)\n`);
  process.exit(results.every(([, ok]) => ok) ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  try {
    await dropDatabase();
  } catch {
    /* best effort */
  }
  process.exit(1);
});
