// Accounts, sessions and input checks, against the REAL server + MySQL.
// Run through `npm run test:integration`. Expects an empty database.
import jwtLib from '../node_modules/jsonwebtoken/index.js';

const BASE = process.argv[2];
if (!BASE) {
  console.error('usage: node security.test.mjs <server-url>');
  process.exit(2);
}

let passed = 0;
let failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? '  -> ' + detail : ''}`); }
};

async function call(method, path, { token, body, headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}
const loginAs = (username, password = 'pass1234') => call('POST', '/api/auth/login', { body: { username, password } });
const login = async (u, p) => (await loginAs(u, p)).data?.token;
const register = (username, role, password = 'pass1234') => call('POST', '/api/auth/register', { body: { username, password, role } });

console.log(`\nSecurity - real server ${BASE}\n`);

let admin = await login('admin', 'admin123');
const approveAll = async () => {
  for (const u of (await call('GET', '/api/admin/users/pending', { token: admin })).data || []) {
    await call('PUT', `/api/admin/users/${u.id}/approve`, { token: admin, body: {} });
  }
};
const userId = async (name) => (await call('GET', '/api/admin/users', { token: admin })).data.find((u) => u.username === name)?.id;

// ---- signing up ----------------------------------------------------------------
console.log('Signing up');
{
  const r = await register('sneaky', 'admin');
  ok(r.status === 400 && r.data?.error === 'Invalid role', 'signing up as "admin" is refused', `${r.status} ${JSON.stringify(r.data)}`);
  ok((await loginAs('sneaky')).status === 401, 'and no such account exists');
  const users = (await call('GET', '/api/admin/users', { token: admin })).data;
  ok(users.filter((u) => u.role === 'admin').length === 1, 'there is still exactly one admin');

  ok((await register('ab', 'maker')).status === 400, 'a 2-letter username is refused');
  ok((await register('shortpw', 'maker', '12345')).status === 400, 'a 5-character password is refused');
  ok((await register('nobody', 'superuser')).status === 400, 'an unknown role is refused');
  ok((await register('maker1', 'maker')).status === 201, 'a normal sign-up works');
  const dup = await register('MAKER1', 'taker');
  ok(dup.status === 409 && dup.data?.error === 'Username already taken', 'the same name in other letter case is "already taken"', `${dup.status}`);

  for (const [u, role] of [['taker1', 'taker'], ['taker2', 'taker'], ['acc1', 'accounter'], ['spare', 'taker']]) await register(u, role);
  await register('waiting', 'taker'); // left unapproved
  const pendingIds = new Set(((await call('GET', '/api/admin/users/pending', { token: admin })).data || []).map((u) => u.username));
  for (const u of (await call('GET', '/api/admin/users/pending', { token: admin })).data || []) {
    if (u.username !== 'waiting') await call('PUT', `/api/admin/users/${u.id}/approve`, { token: admin, body: {} });
  }
  ok(pendingIds.has('waiting'), 'setup: a taker left waiting for approval');

  const maker = await login('maker1');
  const takers = (await call('GET', '/api/auth/takers', { token: maker })).data.map((t) => t.username);
  ok(takers.includes('taker1') && !takers.includes('waiting'), 'makers are only offered approved takers', takers.join());
}

// ---- sessions ------------------------------------------------------------------------
console.log('\nSessions');
{
  ok((await call('GET', '/api/auth/me')).status === 401, 'no token -> 401');
  const junk = await call('GET', '/api/auth/me', { token: 'not.a.token' });
  ok(junk.status === 401 && typeof junk.data === 'object', 'a broken token -> 401 with a JSON reason (the app then shows the login page)', `${junk.status}`);
  const forged = jwtLib.sign({ id: 1, username: 'admin', role: 'admin', isApproved: true }, 'your-secret-key');
  ok((await call('GET', '/api/admin/users', { token: forged })).status === 401, 'a token signed with the old default secret is rejected');

  const spareToken = await login('spare');
  ok((await call('GET', '/api/auth/me', { token: spareToken })).status === 200, 'setup: a fresh user is logged in');
  const del = await call('DELETE', `/api/admin/users/${await userId('spare')}`, { token: admin });
  ok(del.status === 200, 'admin deletes a user who never did anything');
  const after = await call('GET', '/api/auth/me', { token: spareToken });
  ok(after.status === 401, 'their still-unexpired token stops working at once', `${after.status}`);
}

// ---- deactivating instead of deleting --------------------------------------------------
console.log('\nDeactivating instead of deleting');
let orderId;
{
  const maker = await login('maker1');
  const acc = await userId('acc1');
  const r = await call('POST', '/api/orders', {
    token: maker,
    body: { title: 'طلب للسجل', city: 'نابلس', items: [{ name: 'سكر', quantity: 1, price: 2 }], assignedTakerIds: [await userId('taker1')], accounterId: acc },
  });
  orderId = r.data.id;
  const taker1 = await login('taker1');
  await call('PATCH', `/api/orders/${orderId}/items/status`, { token: taker1, body: { name: 'سكر', status: 'collected' } });

  let d = await call('DELETE', `/api/admin/users/${await userId('maker1')}`, { token: admin });
  ok(d.status === 409 && d.data?.code === 'USER_HAS_HISTORY', 'deleting a maker who created orders is refused (409)', `${d.status}`);
  const still = (await call('GET', '/api/orders/admin?status=all', { token: admin })).data.orders.some((o) => o.id === orderId);
  ok(still, 'and their orders are untouched (deleting used to wipe them all)');
  d = await call('DELETE', `/api/admin/users/${await userId('taker1')}`, { token: admin });
  ok(d.status === 409, 'so is deleting a taker who has worked on orders', `${d.status}`);

  const t1 = await userId('taker1');
  const de = await call('PUT', `/api/admin/users/${t1}/deactivate`, { token: admin, body: {} });
  ok(de.status === 200 && de.data.activeAssignments === 1, 'deactivating taker1 works, and reports 1 order still waiting on them', JSON.stringify(de.data));
  const me = await call('GET', '/api/auth/me', { token: taker1 });
  ok(me.status === 401 && me.data?.deactivated === true, 'their open session ends at once');
  const relog = await loginAs('taker1');
  ok(relog.status === 403 && relog.data?.deactivated === true, 'they cannot log in ("deactivated", not "waiting for approval")');
  const pending = (await call('GET', '/api/admin/users/pending', { token: admin })).data.map((u) => u.username);
  ok(!pending.includes('taker1') && pending.includes('waiting'), 'they do not show up as waiting for approval');
  const maker2 = await login('maker1');
  ok(!(await call('GET', '/api/auth/takers', { token: maker2 })).data.some((t) => t.username === 'taker1'), 'and makers can no longer pick them');
  const hist = (await call('GET', '/api/orders/admin?status=all&includeHistory=true', { token: admin })).data.orders.find((o) => o.id === orderId)?.History || [];
  ok(hist.some((h) => h.Editor?.username === 'taker1'), 'their history entries are still there, with their name');

  ok((await call('PUT', `/api/admin/users/${t1}/approve`, { token: admin, body: {} })).status === 200, 'activating them again works');
  ok((await loginAs('taker1')).status === 200, 'and they can log in again');

  ok((await call('PUT', '/api/admin/users/1/deactivate', { token: admin, body: {} })).status === 400, 'the admin cannot deactivate themselves');
  ok((await call('DELETE', '/api/admin/users/1', { token: admin })).status === 400, 'or delete themselves');
  ok((await call('PUT', `/api/admin/users/${t1}/deactivate`, { token: await login('maker1'), body: {} })).status === 403, 'a maker cannot deactivate anyone');
}

// ---- passwords --------------------------------------------------------------------------
console.log('\nPasswords');
{
  const first = await loginAs('admin', 'admin123');
  ok(first.data?.mustChangePassword === true, 'logging in with the default admin password is flagged');

  const old = first.data.token;
  let r = await call('PUT', '/api/auth/password', { token: old, body: { currentPassword: 'wrong', newPassword: 'Strong-Pass-1' } });
  ok(r.status === 400 && r.data?.error === 'Current password is incorrect', 'a wrong current password -> 400 (and not a logout)', `${r.status}`);
  ok((await call('GET', '/api/auth/me', { token: old })).status === 200, 'the session survives the mistake');
  r = await call('PUT', '/api/auth/password', { token: old, body: { currentPassword: 'admin123', newPassword: '123' } });
  ok(r.status === 400, 'a too-short new password -> 400');
  r = await call('PUT', '/api/auth/password', { token: old, body: { currentPassword: 'admin123', newPassword: 'admin123' } });
  ok(r.status === 400, 'the same password again -> 400');

  r = await call('PUT', '/api/auth/password', { token: old, body: { currentPassword: 'admin123', newPassword: 'Strong-Pass-1' } });
  ok(r.status === 200 && r.data?.token, 'changing it works and returns a new token');
  admin = r.data.token;
  ok((await call('GET', '/api/admin/users', { token: admin })).status === 200, 'the new token works');
  ok((await call('GET', '/api/admin/users', { token: old })).status === 401, 'the old token (any other device) is logged out');
  ok((await loginAs('admin', 'admin123')).status === 401, 'the old password no longer works');
  const fresh = await loginAs('admin', 'Strong-Pass-1');
  ok(fresh.status === 200 && fresh.data.mustChangePassword === false, 'the new one does, and is not flagged');

  const takerOld = await login('taker2');
  const t2 = await userId('taker2');
  r = await call('PUT', `/api/admin/users/${t2}/password`, { token: admin, body: { newPassword: 'reset-123' } });
  ok(r.status === 200, 'the admin sets a new password for a taker who forgot theirs');
  ok((await call('GET', '/api/auth/me', { token: takerOld })).status === 401, "the taker's old session ends");
  ok((await loginAs('taker2', 'reset-123')).status === 200, 'they log in with the new password');
  ok((await call('PUT', `/api/admin/users/${t2}/password`, { token: await login('maker1'), body: { newPassword: 'hacked-1' } })).status === 403, 'a maker cannot set anyone\'s password');
}

// ---- input checks ------------------------------------------------------------------------
console.log('\nInput checks (a clear 400, never a 500)');
{
  const maker = await login('maker1');
  const acc = await userId('acc1');
  const t2 = await userId('taker2');
  const make = (over) => call('POST', '/api/orders', {
    token: maker,
    body: { title: 'زبون', city: 'نابلس', items: [{ name: 'سكر', quantity: 1, price: 2 }], assignedTakerIds: [t2], accounterId: acc, ...over },
  });
  const cases = [
    ['a 256-character item name', { items: [{ name: 'س'.repeat(256), quantity: 1 }] }, /too long/],
    ['a 256-character customer name', { title: 'ز'.repeat(256) }, /too long/],
    ['a 5001-character description', { description: 'و'.repeat(5001) }, /too long/],
    ['a city that is not on the list', { city: 'باريس' }, /Invalid city/],
    ['a quantity of 10,000,000', { items: [{ name: 'سكر', quantity: 1e7 }] }, /Invalid quantity/],
    ['a negative price', { items: [{ name: 'سكر', quantity: 1, price: -5 }] }, /Invalid price/],
    ['a price of 100,000,000', { items: [{ name: 'سكر', quantity: 1, price: 1e8 }] }, /Invalid price/],
  ];
  for (const [label, over, re] of cases) {
    const r = await make(over);
    ok(r.status === 400 && re.test(r.data?.error || ''), `${label} -> 400`, `${r.status} ${r.data?.error}`);
  }
  const edit = await call('PUT', `/api/orders/${orderId}`, { token: maker, body: { title: 'ز'.repeat(300) } });
  ok(edit.status === 400, 'the same checks apply when editing', `${edit.status}`);

  await make({ title: 'خصم 50% على الكل' });
  await make({ title: 'زبون عادي' });
  const pct = (await call('GET', `/api/orders/maker?status=all&search=${encodeURIComponent('%')}`, { token: maker })).data.orders;
  ok(pct.length === 1 && pct[0].title.includes('50%'), 'searching for "%" finds the order with % in it - not every order', `${pct.length}`);
  const under = (await call('GET', `/api/orders/maker?status=all&search=_`, { token: maker })).data.orders;
  ok(under.length === 0, 'searching for "_" is not a wildcard either', `${under.length}`);
}

// ---- headers ------------------------------------------------------------------------------
console.log('\nBrowser hardening');
{
  const r = await call('GET', '/api/health');
  ok(r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('x-frame-options') === 'DENY', 'nosniff and no-framing headers are sent');
  ok(!r.headers.get('x-powered-by'), 'the server does not advertise Express');
  ok(r.data?.db === 'ready', '/api/health reports the database as ready');
}

// ---- guessing passwords (last: it locks this address out for a while) -----------------------
console.log('\nGuessing passwords');
{
  let last;
  for (let i = 0; i < 8; i++) last = await loginAs('maker1', `guess-${i}`);
  ok(last.status === 401, '8 wrong passwords in a row: each is just "invalid"');
  const ninth = await loginAs('maker1', 'pass1234');
  ok(ninth.status === 429 && ninth.headers.get('retry-after'), 'then even the RIGHT password is refused for a while (429)', `${ninth.status}`);
  ok((await loginAs('acc1')).status === 200, 'other people can still log in meanwhile');
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
