// Single-item status endpoint, against the REAL server + MySQL.
// Run through `npm run test:integration`, which supplies a throwaway database.
// Expects an empty database containing only the seeded admin.
const BASE = process.argv[2] || 'http://localhost:6099';
const ROUNDS = 20;

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
const login = async (u, p = 'pass1234') => {
  const r = await call('POST', '/api/auth/login', { body: { username: u, password: p } });
  if (r.status !== 200) throw new Error(`login ${u}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
};
const tick = (token, orderId, name, status) =>
  call('PATCH', `/api/orders/${orderId}/items/status`, { token, body: { name, status } });

// What the client now sends for structural edits: no id, NO status.
const structural = (items) => items.map((i) => ({ name: i.name, quantity: Number(i.quantity), price: i.price ?? null }));

const getOrder = async (token, id) => {
  for (let off = 0; off < 400; off += 20) {
    const r = await call('GET', `/api/orders/maker?status=all&limit=20&offset=${off}`, { token });
    const hit = r.data?.orders?.find((o) => o.id === id);
    if (hit) return hit;
    if (!r.data?.orders?.length || r.data.orders.length < 20) return null;
  }
  return null;
};
const statuses = (o) => Object.fromEntries(o.Items.map((i) => [i.name, i.status]));

console.log(`\nSingle-item status endpoint - real server at ${BASE}\n`);

// ---- setup -----------------------------------------------------------------
const admin = await login('admin', 'admin123');
for (const [u, role] of [['maker1', 'maker'], ['maker2', 'maker'], ['taker1', 'taker'], ['taker2', 'taker'], ['taker3', 'taker'], ['acc1', 'accounter']]) {
  await call('POST', '/api/auth/register', { body: { username: u, password: 'pass1234', role } });
}
for (const u of (await call('GET', '/api/admin/users/pending', { token: admin })).data || []) {
  await call('PUT', `/api/admin/users/${u.id}/approve`, { token: admin, body: {} });
}
const [maker, maker2, taker1, taker2, taker3, acc] = await Promise.all(
  ['maker1', 'maker2', 'taker1', 'taker2', 'taker3', 'acc1'].map((u) => login(u))
);
const takers = (await call('GET', '/api/auth/takers', { token: maker })).data;
const id = (u) => takers.find((t) => t.username === u).id;
const acc1Id = (await call('GET', '/api/auth/accounters', { token: maker })).data[0].id;

const newOrder = async (title, items, assigned = ['taker1', 'taker2']) => {
  const r = await call('POST', '/api/orders', {
    token: maker,
    body: { title, city: 'نابلس', items, assignedTakerIds: assigned.map(id), accounterId: acc1Id },
  });
  if (r.status >= 300) throw new Error(`create order: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.id;
};

// ---- 1. the bug that was reported, now via the new endpoint ----------------
console.log('One taker, three quick taps');
{
  const oid = await newOrder('طلب ١', [
    { name: 'طحينة', quantity: 2.5, price: 12.5 },
    { name: 'زيت زيتون', quantity: 1, price: 45 },
    { name: 'سكر', quantity: 3, price: 4.25 },
  ]);
  const before = (await getOrder(maker, oid)).Items.map((i) => i.id).sort();
  const r = await Promise.all([
    tick(taker1, oid, 'طحينة', 'collected'),
    tick(taker1, oid, 'زيت زيتون', 'collected'),
    tick(taker1, oid, 'سكر', 'unavailable'),
  ]);
  ok(r.every((x) => x.status === 200), 'all three taps accepted', r.map((x) => x.status).join(','));
  const after = await getOrder(maker, oid);
  const st = statuses(after);
  ok(st['طحينة'] === 'collected' && st['زيت زيتون'] === 'collected' && st['سكر'] === 'unavailable',
    'all three statuses persisted', JSON.stringify(st));
  ok(after.Items.every((i) => i.price !== null), 'prices untouched (a tick never sends them)');
  const ids = after.Items.map((i) => i.id).sort();
  ok(JSON.stringify(ids) === JSON.stringify(before), 'item ids did NOT rotate (no destroy + bulkCreate)');
  ok(r[0].data?.Items?.every((i) => i.price === undefined), 'response to a taker carries no prices');
}

// ---- 2. THE NEW BUG: two takers at the same moment -------------------------
console.log(`\nTwo takers ticking different items at the same moment, ${ROUNDS} rounds`);
{
  let lost = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const oid = await newOrder(`سباق ${round}`, [
      { name: 'أ', quantity: 1, price: 1 }, { name: 'ب', quantity: 1, price: 1 },
      { name: 'ج', quantity: 1, price: 1 }, { name: 'د', quantity: 1, price: 1 },
    ]);
    await Promise.all([
      tick(taker1, oid, 'أ', 'collected'),
      tick(taker2, oid, 'ب', 'unavailable'),
      tick(taker1, oid, 'ج', 'collected'),
      tick(taker2, oid, 'د', 'collected'),
    ]);
    const st = statuses(await getOrder(maker, oid));
    if (!(st['أ'] === 'collected' && st['ب'] === 'unavailable' && st['ج'] === 'collected' && st['د'] === 'collected')) lost++;
  }
  ok(lost === 0, `no ticks lost in ${ROUNDS} rounds of 4 simultaneous writes from 2 takers`, `${lost} rounds lost a tick`);
}

// ---- 3. maker edits while a taker ticks ------------------------------------
console.log(`\nMaker edits the order while a taker ticks, ${ROUNDS} rounds`);
{
  let lost = 0;
  let editLost = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const oid = await newOrder(`تعديل ${round}`, [
      { name: 'طحينة', quantity: 1, price: 10 }, { name: 'سكر', quantity: 1, price: 5 },
    ]);
    const snapshot = await getOrder(maker, oid); // maker opens the edit modal
    await Promise.all([
      tick(taker1, oid, 'سكر', 'collected'),
      call('PUT', `/api/orders/${oid}`, {
        token: maker,
        body: {
          title: `معدّل ${round}`,
          items: structural(snapshot.Items.map((i) => (i.name === 'طحينة' ? { ...i, quantity: 9 } : i))),
        },
      }),
    ]);
    const after = await getOrder(maker, oid);
    if (statuses(after)['سكر'] !== 'collected') lost++;
    if (Number(after.Items.find((i) => i.name === 'طحينة').quantity) !== 9) editLost++;
  }
  ok(lost === 0, `taker's tick survives a concurrent maker edit in all ${ROUNDS} rounds`, `${lost} lost`);
  ok(editLost === 0, `maker's quantity change survives too`, `${editLost} lost`);
}

// ---- 4. a second taker adds an item while the first ticks ------------------
console.log(`\nOne taker adds an item while another ticks, ${ROUNDS} rounds`);
{
  let lost = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const oid = await newOrder(`إضافة ${round}`, [{ name: 'طحينة', quantity: 1, price: 10 }, { name: 'سكر', quantity: 1, price: 5 }]);
    const snap = await getOrder(maker, oid);
    await Promise.all([
      tick(taker1, oid, 'طحينة', 'unavailable'),
      call('PUT', `/api/orders/${oid}`, {
        token: taker2,
        body: { items: [...structural(snap.Items), { name: 'ملح', quantity: 2, price: null }] },
      }),
    ]);
    const after = await getOrder(maker, oid);
    const st = statuses(after);
    if (st['طحينة'] !== 'unavailable' || !('ملح' in st)) lost++;
    if (Number(after.Items.find((i) => i.name === 'طحينة')?.price) !== 10) lost++; // taker write must not wipe prices
  }
  ok(lost === 0, `tick, new item and prices all survive in ${ROUNDS} rounds`, `${lost} problems`);
}

// ---- 5. rename carries status (what the edit modal sends) ------------------
console.log('\nRenaming an item');
{
  const oid = await newOrder('إعادة تسمية', [{ name: 'طحينه', quantity: 1, price: 3 }, { name: 'سكر', quantity: 1, price: 2 }]);
  await tick(taker1, oid, 'طحينه', 'collected');
  await tick(taker1, oid, 'سكر', 'unavailable');
  const o = await getOrder(maker, oid);
  // modal: renamed row carries status explicitly, unchanged row omits it
  await call('PUT', `/api/orders/${oid}`, {
    token: maker,
    body: { items: [
      { name: 'طحينة', quantity: 1, price: 3, status: 'collected' },
      { name: 'سكر', quantity: 1, price: 2 },
    ] },
  });
  const st = statuses(await getOrder(maker, oid));
  ok(st['طحينة'] === 'collected', 'renamed item keeps its status', JSON.stringify(st));
  ok(!('طحينه' in st), 'old name is gone');
  ok(st['سكر'] === 'unavailable', 'untouched item keeps its status with no status key sent');
}

// ---- 6. exact name matching -------------------------------------------------
console.log('\nExact name matching (the collation treats Latin case/accents as equal)');
{
  const oid = await newOrder('أسماء', [{ name: 'cafe', quantity: 1, price: 1 }, { name: 'café', quantity: 1, price: 1 }]);
  await tick(taker1, oid, 'café', 'collected');
  const st = statuses(await getOrder(maker, oid));
  ok(st['café'] === 'collected' && st['cafe'] === null, 'ticking "café" changes only "café", not "cafe"', JSON.stringify(st));
}

// ---- 7. authorization ------------------------------------------------------
console.log('\nAuthorization');
const authOrder = await newOrder('صلاحيات', [{ name: 'شاي', quantity: 1, price: 1 }], ['taker1']);
{
  ok((await tick(taker3, authOrder, 'شاي', 'collected')).status === 403, 'taker NOT assigned to the order -> 403');
  ok((await tick(acc, authOrder, 'شاي', 'collected')).status === 403, 'accounter -> 403');
  ok((await tick(maker2, authOrder, 'شاي', 'collected')).status === 403, "a different maker's order -> 403");
  ok((await tick(maker, authOrder, 'شاي', 'collected')).status === 200, 'owning maker -> 200');
  ok((await tick(admin, authOrder, 'شاي', null)).status === 200, 'admin -> 200');
  ok((await tick(taker1, authOrder, 'شاي', 'collected')).status === 200, 'assigned taker -> 200');
  const noToken = await call('PATCH', `/api/orders/${authOrder}/items/status`, { body: { name: 'شاي', status: null } });
  ok(noToken.status === 401, 'no token -> 401', `got ${noToken.status}`);
}

// ---- 8. validation ---------------------------------------------------------
console.log('\nValidation');
{
  ok((await tick(taker1, authOrder, 'شاي', 'done')).status === 400, 'unknown status value -> 400');
  ok((await tick(taker1, authOrder, '', 'collected')).status === 400, 'empty name -> 400');
  ok((await tick(taker1, authOrder, 'غير موجود', 'collected')).status === 404, 'item not in order -> 404');
  ok((await tick(taker1, 999999, 'شاي', 'collected')).status === 404, 'order does not exist -> 404');
  const noKey = await call('PATCH', `/api/orders/${authOrder}/items/status`, { token: taker1, body: { name: 'شاي' } });
  ok(noKey.status === 400, 'missing status key -> 400 (never clears by omission)', `got ${noKey.status}`);
}

// ---- 9. locked once completed ----------------------------------------------
console.log('\nCompleted orders');
{
  const oid = await newOrder('مكتمل', [{ name: 'ماء', quantity: 1, price: 1 }], ['taker1']);
  await call('PUT', `/api/orders/${oid}`, { token: taker1, body: { status: 'in-progress' } });
  await call('PUT', `/api/orders/${oid}`, { token: taker1, body: { status: 'completed' } });
  ok((await tick(taker1, oid, 'ماء', 'collected')).status === 409, 'taker cannot tick a completed order -> 409');
  ok((await tick(maker, oid, 'ماء', 'collected')).status === 200, 'maker still can');
}

// ---- 10. legacy endpoint is now authorized ---------------------------------
console.log('\nLegacy PATCH /api/items/:itemId/status');
{
  const o = await getOrder(maker, authOrder);
  const itemId = o.Items[0].id;
  const r1 = await call('PATCH', `/api/items/${itemId}/status`, { token: taker3, body: { status: 'collected' } });
  ok(r1.status === 403, 'unassigned taker blocked (used to be allowed!)', `got ${r1.status}`);
  const r2 = await call('PATCH', `/api/items/${itemId}/status`, { token: taker1, body: { status: 'unavailable' } });
  ok(r2.status === 200 && r2.data?.status === 'unavailable', 'assigned taker allowed');
}

// ---- 11. history, activity log, notifications ------------------------------
console.log('\nHistory, activity log and notifications');
{
  const oid = await newOrder('سجل', [{ name: 'عدس', quantity: 1, price: 1 }, { name: 'برغل', quantity: 1, price: 1 }], ['taker1']);
  const notesBefore = (await call('GET', '/api/notifications', { token: maker })).data.length;

  await tick(taker1, oid, 'عدس', 'collected');
  await tick(taker1, oid, 'برغل', 'collected');
  const notesAfterTicks = (await call('GET', '/api/notifications', { token: maker })).data.length;
  ok(notesAfterTicks === notesBefore, 'ticking items creates NO notifications for the maker', `${notesBefore} -> ${notesAfterTicks}`);

  await call('PUT', `/api/orders/${oid}`, { token: taker1, body: { status: 'in-progress' } });
  const notesAfterStatus = (await call('GET', '/api/notifications', { token: maker })).data.length;
  ok(notesAfterStatus === notesBefore + 1, 'a status change DOES notify the maker', `${notesAfterTicks} -> ${notesAfterStatus}`);

  const o = await getOrder(maker, oid);
  const hist = (o.History || []).map((h) => h.newDescription);
  ok(hist.some((h) => h === 'عدس: collected') && hist.some((h) => h === 'برغل: collected'),
    'each tick is recorded in the order history', JSON.stringify(hist.slice(0, 4)));

  const noop = await tick(taker1, oid, 'عدس', 'collected'); // same value again
  const o2 = await getOrder(maker, oid);
  ok(noop.status === 200 && o2.History.length === o.History.length, 're-sending the same status adds no history noise');

  const logs = (await call('GET', '/api/admin/logs/all?limit=50', { token: admin })).data;
  ok(logs.some((l) => l.action === 'order_item_status_changed'), 'activity log records order_item_status_changed');
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
