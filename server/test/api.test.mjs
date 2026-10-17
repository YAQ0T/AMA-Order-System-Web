// End-to-end tests against the REAL server + MySQL (not the mock).
// Run through `npm run test:integration`, which supplies a throwaway database.
// Expects an empty database containing only the seeded admin.
const BASE = process.argv[2] || 'http://localhost:6099';

let passed = 0;
let failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? '  -> ' + detail : ''}`); }
};

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

const login = async (username, password) => {
  const r = await call('POST', '/api/auth/login', { body: { username, password } });
  if (r.status !== 200) throw new Error(`login ${username} failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
};

// Exactly what the fixed client sends: full list, name-keyed, NO id.
const itemsPayload = (items) => items.map((i) => ({
  name: i.name, quantity: i.quantity, price: i.price ?? null, status: i.status ?? null,
}));

const findOrder = async (token, role, id, status = 'all') => {
  for (let offset = 0; offset < 200; offset += 20) {
    const r = await call('GET', `/api/orders/${role}?status=${status}&limit=20&offset=${offset}`, { token });
    const hit = r.data?.orders?.find((o) => o.id === id);
    if (hit) return hit;
    if (!r.data?.orders?.length || r.data.orders.length < 20) return null;
  }
  return null;
};

console.log(`\nReal-server test against ${BASE}\n`);

// ---------------------------------------------------------------- security
console.log('Security fixes');
{
  const r1 = await call('PATCH', '/api/items/1/status', { body: { status: 'collected' } });
  ok(r1.status === 401, 'PATCH /api/items/:id/status rejects requests without a token', `got ${r1.status}`);
  const r2 = await call('GET', '/api/auth/takers');
  ok(r2.status === 401, 'GET /api/auth/takers rejects requests without a token', `got ${r2.status}`);
  const r3 = await call('GET', '/api/items/suggestions?q=ab');
  ok(r3.status === 401, 'GET /api/items/suggestions rejects requests without a token', `got ${r3.status}`);
  const h = await call('GET', '/api/health');
  ok(h.status === 200 && h.data?.ok, 'GET /api/health responds');
}

// ---------------------------------------------------------------- users
console.log('\nUsers & approval');
const admin = await login('admin', 'admin123');
ok(Boolean(admin), 'seeded admin can log in');

for (const [u, role] of [['maker1', 'maker'], ['taker1', 'taker'], ['taker2', 'taker'], ['acc1', 'accounter']]) {
  const r = await call('POST', '/api/auth/register', { body: { username: u, password: 'pass1234', role } });
  ok(r.status === 201, `register ${u} (${role})`, `got ${r.status} ${JSON.stringify(r.data)}`);
}

{
  const blocked = await call('POST', '/api/auth/login', { body: { username: 'maker1', password: 'pass1234' } });
  ok(blocked.status === 403 && blocked.data?.requiresApproval, 'unapproved user is blocked with requiresApproval', `got ${blocked.status}`);

  const pending = await call('GET', '/api/admin/users/pending', { token: admin });
  ok(pending.data?.length === 4, `admin sees 4 pending users`, `got ${pending.data?.length}`);
  for (const u of pending.data || []) {
    await call('PUT', `/api/admin/users/${u.id}/approve`, { token: admin, body: {} });
  }
  const after = await call('GET', '/api/admin/users/pending', { token: admin });
  ok(after.data?.length === 0, 'all approved');
}

const maker = await login('maker1', 'pass1234');
const taker = await login('taker1', 'pass1234');
const taker2 = await login('taker2', 'pass1234');
const acc = await login('acc1', 'pass1234');

const takers = (await call('GET', '/api/auth/takers', { token: maker })).data;
const accounters = (await call('GET', '/api/auth/accounters', { token: maker })).data;
const taker1Id = takers.find((t) => t.username === 'taker1').id;
const taker2Id = takers.find((t) => t.username === 'taker2').id;
const acc1Id = accounters.find((a) => a.username === 'acc1').id;
ok(Boolean(taker1Id && acc1Id), 'takers and accounters list with a token');

// ---------------------------------------------------------------- create
console.log('\nCreate order (Arabic, prices, fractional qty)');
const created = await call('POST', '/api/orders', {
  token: maker,
  body: {
    title: 'زبون تجريبي — نابلس',
    description: 'ملاحظة: التسليم صباحاً',
    city: 'نابلس',
    items: [
      { name: 'طحينة', quantity: 2.5, price: 12.5 },
      { name: 'زيت زيتون', quantity: 1, price: 45 },
      { name: 'سكر', quantity: 3, price: 4.25 },
    ],
    assignedTakerIds: [taker1Id, taker2Id],
    accounterId: acc1Id,
  },
});
ok(created.status === 201 || created.status === 200, 'maker creates an active order', `got ${created.status} ${JSON.stringify(created.data).slice(0, 200)}`);
const orderId = created.data?.id;

{
  const o = await findOrder(maker, 'maker', orderId);
  ok(o?.title === 'زبون تجريبي — نابلس', 'Arabic title round-trips through MySQL', `got ${o?.title}`);
  ok(o?.description === 'ملاحظة: التسليم صباحاً', 'Arabic description round-trips');
  ok(o?.city === 'نابلس', 'Arabic city round-trips');
  const tahina = o?.Items?.find((i) => i.name === 'طحينة');
  ok(tahina && Number(tahina.quantity) === 2.5, 'fractional quantity 2.5 stored exactly', `got ${tahina?.quantity}`);
  ok(typeof tahina?.price === 'string', 'price arrives as a STRING (DECIMAL), as the client expects', `got ${typeof tahina?.price} ${tahina?.price}`);
  ok(Number(tahina?.price) === 12.5, 'price value correct', `got ${tahina?.price}`);
}

{
  const bad = await call('POST', '/api/orders', {
    token: maker,
    body: { title: 'x', city: 'نابلس', items: [{ name: 'a', quantity: 1 }], assignedTakerIds: [], accounterId: acc1Id },
  });
  ok(bad.status === 400, 'active order without a taker is rejected server-side', `got ${bad.status}`);
}

// ---------------------------------------------------------------- THE BUG
// Ticks now go through PATCH (see concurrency.test.mjs). PUT still accepts
// explicit statuses - the edit modal relies on it for renamed items - and still
// restores prices on a taker's write, so both stay covered here.
console.log('\nPUT with explicit statuses (renamed items, taker price restore)');
let idsBefore;
{
  const o = await findOrder(taker, 'taker', orderId, 'active');
  ok(Boolean(o), 'taker sees the assigned order');
  ok(o?.Items?.every((i) => i.price === undefined), 'taker receives NO price field', JSON.stringify(o?.Items?.[0]));
  idsBefore = o.Items.map((i) => i.id).sort((a, b) => a - b);

  // Tap 1: mark طحينة collected - built exactly like the fixed client builds it.
  const r1 = await call('PUT', `/api/orders/${orderId}`, {
    token: taker,
    body: { items: itemsPayload(o.Items.map((i) => (i.name === 'طحينة' ? { ...i, status: 'collected' } : i))) },
  });
  ok(r1.status === 200, 'tap 1 (طحينة collected) accepted', `got ${r1.status} ${JSON.stringify(r1.data).slice(0, 200)}`);

  // Tap 2: chain on the SERVER RESPONSE of tap 1, as the fixed client does.
  const base = r1.data;
  const r2 = await call('PUT', `/api/orders/${orderId}`, {
    token: taker,
    body: { items: itemsPayload(base.Items.map((i) => (i.name === 'زيت زيتون' ? { ...i, status: 'collected' } : i))) },
  });
  ok(r2.status === 200, 'tap 2 (زيت زيتون collected) accepted');

  // Tap 3: unavailable
  const r3 = await call('PUT', `/api/orders/${orderId}`, {
    token: taker,
    body: { items: itemsPayload(r2.data.Items.map((i) => (i.name === 'سكر' ? { ...i, status: 'unavailable' } : i))) },
  });
  ok(r3.status === 200, 'tap 3 (سكر unavailable) accepted');

  const after = await findOrder(maker, 'maker', orderId);
  const st = Object.fromEntries(after.Items.map((i) => [i.name, i.status]));
  ok(st['طحينة'] === 'collected', 'طحينة still collected after two more taps', `got ${st['طحينة']}`);
  ok(st['زيت زيتون'] === 'collected', 'زيت زيتون collected', `got ${st['زيت زيتون']}`);
  ok(st['سكر'] === 'unavailable', 'سكر unavailable', `got ${st['سكر']}`);

  const prices = Object.fromEntries(after.Items.map((i) => [i.name, Number(i.price)]));
  ok(prices['طحينة'] === 12.5 && prices['زيت زيتون'] === 45 && prices['سكر'] === 4.25,
    'prices survive three taker writes (server restores them by name)', JSON.stringify(prices));

  const idsAfter = after.Items.map((i) => i.id).sort((a, b) => a - b);
  ok(idsAfter.every((id) => !idsBefore.includes(id)),
    'confirmed root cause: every item id rotated after the writes', `before ${idsBefore} after ${idsAfter}`);
}

// ---------------------------------------------------------------- edit
console.log('\nMaker edits an order the taker already worked on');
{
  // put a known state back
  const cur = await findOrder(maker, 'maker', orderId);
  const set = await call('PUT', `/api/orders/${orderId}`, {
    token: taker,
    body: { items: itemsPayload(cur.Items.map((i) => ({ ...i, status: i.name === 'سكر' ? 'unavailable' : 'collected' }))) },
  });
  ok(set.status === 200, 'taker sets known statuses');

  const fresh = await findOrder(maker, 'maker', orderId);
  const edit = await call('PUT', `/api/orders/${orderId}`, {
    token: maker,
    body: {
      title: 'زبون تجريبي — معدّل',
      city: 'جنين',
      items: itemsPayload(fresh.Items.map((i) => (i.name === 'طحينة' ? { ...i, price: 99.5, quantity: 7 } : i))),
      assignedTakerIds: [taker1Id, taker2Id],
      accounterId: acc1Id,
    },
  });
  ok(edit.status === 200, 'maker edit accepted', `got ${edit.status} ${JSON.stringify(edit.data).slice(0, 200)}`);

  const after = await findOrder(maker, 'maker', orderId);
  const t = after.Items.find((i) => i.name === 'طحينة');
  ok(after.title === 'زبون تجريبي — معدّل' && after.city === 'جنين', 'title and city updated');
  ok(Number(t.price) === 99.5 && Number(t.quantity) === 7, 'price and quantity updated');
  ok(after.Items.find((i) => i.name === 'طحينة').status === 'collected'
    && after.Items.find((i) => i.name === 'سكر').status === 'unavailable',
    "taker's statuses survive the maker's edit");
  ok((after.History || []).length > 0, `order history (سجل التعديلات) recorded ${after.History?.length} entries`);
}

// ---------------------------------------------------------------- search
console.log('\nSearch (LIKE replaced ILIKE)');
{
  const r = await call('GET', `/api/orders/maker?status=all&search=${encodeURIComponent('معدّل')}`, { token: maker });
  ok(r.data?.orders?.some((o) => o.id === orderId), 'Arabic substring search finds the order');
  const r2 = await call('GET', `/api/orders/maker?status=all&search=${encodeURIComponent('لا يوجد')}`, { token: maker });
  ok(r2.data?.orders?.length === 0, 'non-matching search returns nothing');
  const s = await call('GET', `/api/items/suggestions?q=${encodeURIComponent('طح')}`, { token: maker });
  ok(Array.isArray(s.data) && s.data.includes('طحينة'), 'item suggestions match Arabic prefix', JSON.stringify(s.data));
}

// ---------------------------------------------------------------- lifecycle
console.log('\nLifecycle: pending -> in-progress -> completed -> entered_erp');
{
  let r = await call('PUT', `/api/orders/${orderId}`, { token: taker, body: { status: 'in-progress' } });
  ok(r.status === 200, 'taker: pending -> in-progress', `got ${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);

  const early = await call('PUT', `/api/orders/${orderId}`, { token: acc, body: { status: 'entered_erp' } });
  ok(early.status >= 400, 'accounter cannot send to ERP before completion', `got ${early.status}`);

  r = await call('PUT', `/api/orders/${orderId}`, { token: taker, body: { status: 'completed' } });
  ok(r.status === 200, 'taker: in-progress -> completed');

  const hidden = await findOrder(taker, 'taker', orderId, 'all');
  ok(hidden === null, 'completed order disappears from the taker, even with status=all');

  const accSees = await findOrder(acc, 'accounter', orderId, 'completed');
  ok(Boolean(accSees), 'accounter sees it under completed');

  r = await call('PUT', `/api/orders/${orderId}`, { token: acc, body: { status: 'entered_erp' } });
  ok(r.status === 200, 'accounter: completed -> entered_erp', `got ${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);

  const erp = await findOrder(acc, 'accounter', orderId, 'entered_erp');
  ok(Boolean(erp), 'now listed under entered_erp');
}

// ---------------------------------------------------------------- archived
console.log('\nArchived order + bulk send');
{
  const a = await call('POST', '/api/orders', {
    token: maker,
    body: { title: 'مسودة', city: 'الخليل', status: 'archived', items: [{ name: 'شاي', quantity: 2, price: 3 }] },
  });
  ok(a.status === 201 || a.status === 200, 'archived order created without taker/accounter');
  const arch = await findOrder(maker, 'maker', a.data.id, 'archived');
  ok(arch?.status === 'archived', 'listed as archived');

  const noAssign = await call('PUT', `/api/orders/${a.data.id}`, { token: maker, body: { status: 'pending' } });
  ok(noAssign.status === 400, 'activating without taker/accounter is rejected', `got ${noAssign.status}`);

  const send = await call('PUT', `/api/orders/${a.data.id}`, {
    token: maker,
    body: { status: 'pending', assignedTakerIds: [taker1Id], accounterId: acc1Id },
  });
  ok(send.status === 200, 'bulk-send path: archived -> pending with assignment', `got ${send.status} ${JSON.stringify(send.data).slice(0, 150)}`);
  const sent = await findOrder(taker, 'taker', a.data.id, 'active');
  ok(Boolean(sent), 'taker now sees the sent order');

  const del = await call('DELETE', `/api/orders/${a.data.id}`, { token: maker });
  ok(del.status === 200 || del.status === 204, 'maker deletes an order', `got ${del.status}`);
  const gone = await findOrder(maker, 'maker', a.data.id, 'all');
  ok(gone === null, 'deleted order is gone');
}

// ---------------------------------------------------------------- admin
console.log('\nAdmin');
{
  const s = await call('GET', '/api/admin/stats', { token: admin });
  ok(s.status === 200 && s.data.totalUsers === 4, `stats: ${s.data?.totalUsers} users, ${s.data?.totalOrders} orders`);
  const logs = await call('GET', '/api/admin/logs?limit=10', { token: admin });
  ok(Array.isArray(logs.data) && logs.data.length > 0, `activity log has entries (${logs.data?.length})`);
  const theme = await call('PUT', '/api/auth/theme', { token: maker, body: { prefersDark: true } });
  ok(theme.data?.user?.prefersDark === true, 'dark-mode preference saves');
  const notAdmin = await call('GET', '/api/admin/users', { token: taker });
  ok(notAdmin.status === 403, 'taker cannot reach admin endpoints', `got ${notAdmin.status}`);
}

// ---------------------------------------------------------------- email is gone
console.log('\nEmail removed');
{
  const bulk = await call('POST', '/api/orders/bulk-email', { token: maker, body: { orderIds: [1], takerIds: [1] } });
  ok(bulk.status === 404, 'the bulk-email endpoint no longer exists', `got ${bulk.status}`);
  const users = await call('GET', '/api/admin/users', { token: admin });
  const setEmail = await call('PUT', `/api/admin/users/${users.data[0].id}/email`, { token: admin, body: { email: 'a@b.co' } });
  ok(setEmail.status === 404, 'the admin set-email endpoint no longer exists', `got ${setEmail.status}`);
  ok(users.data.every((u) => !('email' in u)), 'the admin user list carries no email addresses');

  // Orders used to return the maker's and every taker's email address to
  // whoever loaded them. Check both the list and an update response.
  const list = await call('GET', '/api/orders/maker?status=all', { token: maker });
  const people = list.data.orders.flatMap((o) => [o.Maker, o.Accounter, ...(o.AssignedTakers || [])]).filter(Boolean);
  ok(people.length > 0 && people.every((p) => !('email' in p)), `order lists expose no email addresses (${people.length} people checked)`);
  const fresh = await call('POST', '/api/orders', {
    token: maker,
    body: { title: 'خصوصية', city: 'نابلس', items: [{ name: 'شاي', quantity: 1, price: 1 }], assignedTakerIds: [taker1Id], accounterId: acc1Id },
  });
  ok([fresh.data?.Maker, ...(fresh.data?.AssignedTakers || [])].filter(Boolean).every((p) => !('email' in p)),
    'a create response exposes no email addresses');
  const upd = await call('PUT', `/api/orders/${fresh.data.id}`, { token: maker, body: { description: 'فحص الخصوصية' } });
  const inUpdate = [upd.data?.Maker, ...(upd.data?.AssignedTakers || [])].filter(Boolean);
  ok(upd.status === 200 && inUpdate.length > 0 && inUpdate.every((p) => !('email' in p)), 'an update response exposes no email addresses either');
}

// ---------------------------------------------------------------- telegram off
console.log('\nTelegram with no bot configured');
{
  const s = await call('GET', '/api/telegram/status', { token: taker });
  ok(s.status === 200 && s.data?.enabled === false, 'status reports the feature as off (the app hides the card)');
  const l = await call('POST', '/api/telegram/link', { token: taker });
  ok(l.status === 503, 'asking for a link gets 503, not a crash', `got ${l.status}`);
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
