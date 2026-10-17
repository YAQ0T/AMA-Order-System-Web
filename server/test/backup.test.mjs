// Backups and restore, against the REAL server + MySQL. Run through
// `npm run test:integration`, which passes the server address and, in the
// environment, the THROWAWAY database and backups folder to use.
//
// The restore tool is run for real (restore-db.js), but only ever against the
// test database: it is given DB_NAME explicitly, and this file refuses to run
// unless that name ends in "_test".
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2];
const TEST_DB = process.env.AMA_TEST_DB;
const BACKUP_DIR = process.env.AMA_TEST_BACKUP_DIR;
if (!BASE || !TEST_DB || !BACKUP_DIR) {
  console.error('Run through `npm run test:integration`.');
  process.exit(2);
}
if (!TEST_DB.endsWith('_test')) {
  console.error(`Refusing to restore into "${TEST_DB}" - not a test database.`);
  process.exit(2);
}

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const backupLib = require(path.join(SERVER_DIR, 'utils', 'backup.js'));

let passed = 0;
let failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? '  -> ' + detail : ''}`); }
};

async function call(method, urlPath, { token, body, raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + urlPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (raw) return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}
const login = async (u, p = 'pass1234') => (await call('POST', '/api/auth/login', { body: { username: u, password: p } })).data?.token;

const freePort = () => new Promise((resolve) => {
  const srv = net.createServer();
  srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

/** Run the real restore tool against the TEST database. */
async function restoreTool(args, { port } = {}) {
  const env = {
    ...process.env,
    DB_NAME: TEST_DB,
    BACKUP_DIR,
    BACKUP_COPY_DIR: '',
    PORT: String(port ?? (await freePort())),
  };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['restore-db.js', ...args], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('exit', (code) => resolve({ code, output }));
  });
}

console.log(`\nBackups - real server ${BASE}, database ${TEST_DB}\n`);

// ---- setup -----------------------------------------------------------------
const admin = await login('admin', 'admin123');
for (const [u, role] of [['maker1', 'maker'], ['taker1', 'taker'], ['acc1', 'accounter']]) {
  await call('POST', '/api/auth/register', { body: { username: u, password: 'pass1234', role } });
}
for (const u of (await call('GET', '/api/admin/users/pending', { token: admin })).data || []) {
  await call('PUT', `/api/admin/users/${u.id}/approve`, { token: admin, body: {} });
}
const maker = await login('maker1');
const taker = await login('taker1');
const users = (await call('GET', '/api/admin/users', { token: admin })).data;
const uid = (u) => users.find((x) => x.username === u).id;

const mk = async (title, items) => {
  const r = await call('POST', '/api/orders', {
    token: maker,
    body: { title, city: 'الخليل', description: 'سطر أول\nسطر ثانٍ — "اقتباس" و \'فاصلة\' ; نهاية', items, assignedTakerIds: [uid('taker1')], accounterId: uid('acc1') },
  });
  if (r.status !== 201) throw new Error(`create: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
const orderA = await mk('مؤسسة الأمل للتجارة', [
  { name: 'طحينة', quantity: 2.5, price: 12.75 },
  { name: 'زيت زيتون', quantity: 1, price: 99.99 },
  { name: 'Back\\slash; and quote\'', quantity: 3, price: null },
]);
const orderB = await mk('بقالة النور', [{ name: 'سكر', quantity: 10, price: 4.5 }]);
await call('PATCH', `/api/orders/${orderA.id}/items/status`, { token: taker, body: { name: 'طحينة', status: 'collected' } });
await call('PATCH', `/api/orders/${orderA.id}/items/status`, { token: taker, body: { name: 'زيت زيتون', status: 'unavailable' } });

const snapshot = async (id) => (await call('GET', '/api/orders/admin?status=all&limit=20&includeHistory=true', { token: admin }))
  .data.orders.find((o) => o.id === id);
const before = await snapshot(orderA.id);

// ---- access -----------------------------------------------------------------
console.log('Who may use it');
ok((await call('GET', '/api/admin/backups')).status === 401, 'no token -> 401');
ok((await call('GET', '/api/admin/backups', { token: maker })).status === 403, 'a maker -> 403');
ok((await call('POST', '/api/admin/backups', { token: taker })).status === 403, 'a taker cannot take one -> 403');

// ---- taking one ----------------------------------------------------------------
console.log('\nTaking a backup');
let backupName;
{
  const status = await call('GET', '/api/admin/backups', { token: admin });
  ok(status.status === 200 && status.data.status.auto === false, 'status: automatic backups are off in tests', JSON.stringify(status.data?.status));
  ok(path.resolve(status.data.status.dir) === path.resolve(BACKUP_DIR), 'and they go to the throwaway folder, not the real one');

  const r = await call('POST', '/api/admin/backups', { token: admin });
  backupName = r.data?.name;
  ok(r.status === 201 && /^ama-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-manual\.sql\.gz$/.test(backupName || ''), 'admin takes one: 201, named by date', `${r.status} ${backupName}`);
  const orderCount = Object.entries(r.data?.tables || {}).find(([t]) => t.toLowerCase() === 'orders')?.[1];
  ok(orderCount === 2, 'it reports the rows it saved (2 orders)', JSON.stringify(r.data?.tables));
  ok(fs.existsSync(path.join(BACKUP_DIR, backupName)), 'the file is on disk');
  ok(!fs.readdirSync(BACKUP_DIR).some((f) => f.endsWith('.partial')), 'no half-written file left behind');

  const list = await call('GET', '/api/admin/backups', { token: admin });
  ok(list.data.backups[0]?.name === backupName && list.data.backups[0].size > 0, 'it is listed, newest first, with its size');
  ok(list.data.status.lastSuccess?.name === backupName, 'and shown as the last successful backup');
}

// ---- downloading -----------------------------------------------------------------
console.log('\nDownloading');
{
  const d = await call('GET', `/api/admin/backups/${backupName}/download`, { token: admin, raw: true });
  ok(d.status === 200 && /attachment/.test(d.headers.get('content-disposition') || ''), 'admin downloads it as a file');
  let sql = '';
  try { sql = zlib.gunzipSync(d.buffer).toString('utf8'); } catch (e) { sql = ''; }
  ok(sql.startsWith('-- AMA Order System backup') && sql.trimEnd().endsWith('-- Backup complete'), 'it is a complete backup (start and end markers)');
  ok(/CREATE TABLE `orders`/i.test(sql) && /CREATE TABLE `users`/i.test(sql) && /CREATE TABLE `orderitems`/i.test(sql), 'with every table');
  ok(sql.includes('مؤسسة الأمل للتجارة') && sql.includes('طحينة'), 'Arabic is stored as Arabic');
  ok(sql.includes("'12.75'") && sql.includes("'2.500'"), 'prices and quantities are exact (no rounding)');
  ok(!sql.includes('admin123'), 'passwords are only stored hashed');

  ok((await call('GET', `/api/admin/backups/${backupName}/download`, { token: maker })).status === 403, 'a maker cannot download it');
  for (const evil of ['..%2F..%2Fserver%2F.env', '%2E%2E', 'ama-backup-2026-01-01_00-00-00.sql.gz%2F..%2F..%2Fpackage.json', 'package.json']) {
    const r = await call('GET', `/api/admin/backups/${evil}/download`, { token: admin });
    ok(r.status === 404, `"${decodeURIComponent(evil)}" cannot be downloaded (404)`, `${r.status}`);
  }
}

// ---- restoring -------------------------------------------------------------------
console.log('\nRestoring');
let orderC;
{
  // Damage the data after the backup.
  await call('DELETE', `/api/orders/${orderA.id}`, { token: maker });
  await call('PUT', `/api/orders/${orderB.id}`, { token: maker, body: { title: 'اسم خاطئ' } });
  orderC = await mk('طلب بعد النسخة', [{ name: 'أرز', quantity: 1, price: 1 }]);
  ok(!(await snapshot(orderA.id)), 'setup: an order deleted after the backup');

  const busy = await restoreTool([backupName, '--yes'], { port: new URL(BASE).port });
  ok(busy.code !== 0 && /is running/.test(busy.output), 'the tool refuses while the system is running', busy.output.trim().split('\n').pop());

  const damaged = 'ama-backup-2020-01-01_00-00-00-damaged.sql.gz';
  const full = fs.readFileSync(path.join(BACKUP_DIR, backupName));
  fs.writeFileSync(path.join(BACKUP_DIR, damaged), full.subarray(0, Math.floor(full.length / 2)));
  let r = await restoreTool([damaged, '--yes']);
  ok(r.code !== 0 && /damaged or incomplete/.test(r.output), 'it refuses a cut-off backup', r.output.trim().split('\n').pop());
  fs.unlinkSync(path.join(BACKUP_DIR, damaged));

  const foreign = 'ama-backup-2020-01-01_00-00-01-foreign.sql.gz';
  fs.writeFileSync(path.join(BACKUP_DIR, foreign), zlib.gzipSync('DROP DATABASE x;\n'));
  r = await restoreTool([foreign, '--yes']);
  ok(r.code !== 0 && /not an AMA backup/.test(r.output), 'it refuses a file that is not an AMA backup');
  fs.unlinkSync(path.join(BACKUP_DIR, foreign));
  ok(Boolean(await snapshot(orderC.id)), 'and after those refusals nothing was changed');

  r = await restoreTool([backupName, '--yes']);
  ok(r.code === 0 && /Done/.test(r.output), 'restore succeeds', r.output.trim().split('\n').slice(-3).join(' | '));
  ok(fs.readdirSync(BACKUP_DIR).some((f) => /-before-restore\.sql\.gz$/.test(f)), 'a safety backup of the data before the restore was taken first');

  const after = await snapshot(orderA.id);
  ok(Boolean(after), 'the deleted order is back');
  ok(after && after.title === before.title && after.description === before.description, 'with its customer name and description (Arabic, line break, quotes)');
  const items = (o) => JSON.stringify((o?.Items || []).map((i) => [i.name, i.quantity, i.price, i.status]));
  ok(items(after) === items(before), 'items, quantities, prices and ticks exactly as before', items(after));
  ok(after?.AssignedTakers?.map((t) => t.username).join() === 'taker1' && after?.Accounter?.username === 'acc1', 'its taker and accountant');
  ok((after?.History || []).length === (before.History || []).length, 'and its history');
  ok((await snapshot(orderB.id))?.title === 'بقالة النور', 'an order edited after the backup is back to how it was');
  ok(!(await snapshot(orderC.id)), 'an order created after the backup is gone (it was not in the backup)');
  ok(Boolean(await login('maker1')) && Boolean(await login('admin', 'admin123')), 'everyone can still log in');

  const fresh = await mk('طلب جديد بعد الاسترجاع', [{ name: 'شاي', quantity: 1, price: 2 }]);
  ok(fresh.id > orderB.id, 'new orders keep getting new numbers (no clash with restored ones)', `${fresh.id}`);
  const tick = await call('PATCH', `/api/orders/${orderA.id}/items/status`, { token: await login('taker1'), body: { name: 'Back\\slash; and quote\'', status: 'collected' } });
  ok(tick.status === 200, 'the restored order works normally (a tick on an item with \\ ; and \')');
}

// ---- while people are working ----------------------------------------------------
console.log('\nBacking up while people are working');
{
  const work = Array.from({ length: 8 }, (_, i) => mk(`عمل متزامن ${i}`, [{ name: 'عدس', quantity: i + 1, price: 1.25 }]));
  const [b, ...created] = await Promise.all([call('POST', '/api/admin/backups', { token: admin }), ...work]);
  ok(b.status === 201, 'a backup taken while 8 orders are being created succeeds');
  ok(created.every((o) => o.id), 'and nobody was blocked or failed');
}

// ---- which old backups are kept ----------------------------------------------------
console.log('\nWhich old backups are kept');
{
  const now = new Date(2026, 9, 18, 12, 0, 0);
  const at = (daysAgo, hour = 9) => { const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(hour, 0, 0, 0); return d; };
  const list = [];
  for (let day = 0; day < 400; day++) {
    for (const hour of [9, 15]) list.push({ name: `d${day}h${hour}`, createdAt: at(day, hour), label: null });
  }
  list.push({ name: 'safety-recent', createdAt: at(10, 11), label: 'before-restore' });
  list.push({ name: 'safety-old', createdAt: at(90, 11), label: 'before-restore' });
  const doomed = new Set(backupLib.backupsToDelete(list, { days: 30, now }).map((b) => b.name));
  const kept = list.filter((b) => !doomed.has(b.name));
  ok(!doomed.has('d0h15') && !doomed.has('d0h9') && !doomed.has('d1h15'), 'the newest ones are always kept');
  ok(!doomed.has('d29h15') && doomed.has('d29h9'), 'one per day for the last 30 days (the newest of each day)');
  ok(doomed.has('d40h15') || doomed.has('d40h9'), 'older days are thinned out');
  const months = new Set(kept.filter((b) => b.createdAt < at(30)).map((b) => `${b.createdAt.getFullYear()}-${b.createdAt.getMonth()}`));
  ok(months.size >= 10 && months.size <= 12, 'and one per month for a year', `${months.size} months`);
  ok(!doomed.has('safety-recent') && doomed.has('safety-old'), 'safety copies from a restore are kept for 30 days');
  ok(kept.length <= 50, `roughly 30 + 12 files are kept out of ${list.length}`, `${kept.length}`);
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
