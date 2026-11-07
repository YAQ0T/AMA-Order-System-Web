// Online / urgent marks, who sees which orders, and the admin's orders -
// against the REAL server + MySQL and a FAKE Telegram API. Run through
// `npm run test:integration`. Expects an empty database.
const BASE = process.argv[2];
const TG = process.argv[3];
if (!BASE || !TG) {
  console.error('usage: node order-marks.test.mjs <server-url> <fake-telegram-url>');
  process.exit(2);
}

let passed = 0;
let failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? '  -> ' + detail : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const login = async (u, p = 'pass1234') => (await call('POST', '/api/auth/login', { body: { username: u, password: p } })).data?.token;

const sentTo = async (chatId) => ((await (await fetch(TG + '/_test/sent')).json()).result || []).filter((m) => m.chatId === String(chatId));
async function waitFor(fn, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  return null;
}
const newSent = async (chatId, before) => {
  await waitFor(async () => (await sentTo(chatId)).length > before);
  await sleep(400);
  return (await sentTo(chatId)).slice(before);
};

console.log(`\nOrder marks and order privacy - real server ${BASE}, fake Telegram ${TG}\n`);

// ---- setup -----------------------------------------------------------------
const admin = await login('admin', 'admin123');
for (const [u, role] of [['maker1', 'maker'], ['maker2', 'maker'], ['taker1', 'taker'], ['acc1', 'accounter']]) {
  await call('POST', '/api/auth/register', { body: { username: u, password: 'pass1234', role } });
}
for (const u of (await call('GET', '/api/admin/users/pending', { token: admin })).data || []) {
  await call('PUT', `/api/admin/users/${u.id}/approve`, { token: admin, body: {} });
}
const [maker1, maker2, taker1] = await Promise.all(['maker1', 'maker2', 'taker1'].map((u) => login(u)));
const users = (await call('GET', '/api/admin/users', { token: admin })).data;
const uid = (u) => users.find((x) => x.username === u).id;

{
  const r = await call('POST', '/api/telegram/link', { token: taker1 });
  await fetch(TG + '/_test/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: 901, text: `/start ${new URL(r.data.url).searchParams.get('start')}` }),
  });
  await waitFor(async () => (await call('GET', '/api/telegram/status', { token: taker1 })).data.linked);
}

const create = (token, over = {}) => call('POST', '/api/orders', {
  token,
  body: {
    title: 'زبون', city: 'نابلس', items: [{ name: 'سكر', quantity: 1, price: 2 }],
    assignedTakerIds: [uid('taker1')], accounterId: uid('acc1'), ...over,
  },
});

// ---- online orders -----------------------------------------------------------
console.log('Online orders (marked by the maker)');
let onlineId;
let plainId;
{
  const before = (await sentTo(901)).length;
  const r = await create(maker1, { title: 'طلب من الموقع', isOnline: true });
  onlineId = r.data?.id;
  ok(r.status === 201 && r.data.isOnline === true && r.data.isUrgent === false, 'a maker creates an order marked online', `${r.status} ${JSON.stringify({ o: r.data?.isOnline, u: r.data?.isUrgent })}`);
  const m = await newSent(901, before);
  ok(m.length === 1 && m[0].text.includes('طلب أونلاين') && !m[0].text.includes('ضروري'), 'the taker\'s Telegram message says it is an online order');

  const plain = await create(maker1, { title: 'طلب عادي' });
  plainId = plain.data?.id;
  ok(plain.data?.isOnline === false && plain.data?.isUrgent === false, 'without the mark, an order is a normal one');

  const sneaky = await create(maker1, { title: 'محاولة', isUrgent: true });
  ok(sneaky.status === 201 && sneaky.data.isUrgent === false, 'a maker cannot make their own order urgent', `${sneaky.data?.isUrgent}`);

  let e = await call('PUT', `/api/orders/${plainId}`, { token: maker1, body: { isOnline: true } });
  ok(e.status === 200 && e.data.isOnline === true, 'the maker can mark an existing order online', `${e.status}`);
  const hist = (e.data.History || []).map((h) => h.newDescription);
  ok(hist.includes('Marked online'), 'and the order history records it');
  e = await call('PUT', `/api/orders/${plainId}`, { token: maker1, body: { isOnline: false } });
  ok(e.status === 200 && e.data.isOnline === false, 'and remove the mark again');
  e = await call('PUT', `/api/orders/${plainId}`, { token: maker1, body: { isUrgent: true } });
  ok(e.status === 403, 'but cannot mark it urgent (403)', `${e.status}`);
  e = await call('PUT', `/api/orders/${plainId}`, { token: taker1, body: { isOnline: true } });
  ok(e.status === 403, 'a taker cannot change the online mark (403)', `${e.status}`);
}

// ---- the admin's orders ------------------------------------------------------------
console.log('\nThe admin\'s orders (urgent, red)');
let urgentId;
{
  const before = (await sentTo(901)).length;
  const r = await create(admin, { title: 'طلب المدير', isOnline: true });
  urgentId = r.data?.id;
  ok(r.status === 201 && r.data.isUrgent === true, 'an order the admin creates is urgent by itself', `${r.status} ${r.data?.isUrgent}`);
  ok(r.data?.isOnline === true, 'and can be online as well');
  const m = await newSent(901, before);
  ok(m.length === 1 && m[0].text.startsWith('🔴') && m[0].text.includes('طلب ضروري'), 'the taker\'s Telegram message starts with 🔴 and says urgent', m[0]?.text.split('\n')[0]);

  const later = await create(maker1, { title: 'أحدث طلب عادي' });
  const list = (await call('GET', '/api/orders/taker', { token: taker1 })).data.orders;
  ok(list[0]?.id === urgentId, 'the urgent order is first in the taker\'s list, even though a newer order exists', list.map((o) => `${o.id}${o.isUrgent ? '!' : ''}`).join(','));
  ok(list[1]?.id === later.data.id, 'then the rest, newest first');

  let e = await call('PUT', `/api/orders/${urgentId}`, { token: admin, body: { isUrgent: false } });
  ok(e.status === 200 && e.data.isUrgent === false && (e.data.History || []).some((h) => h.newDescription === 'Urgent mark removed'), 'the admin can take the urgent mark off (and it is in the history)');
  e = await call('PUT', `/api/orders/${plainId}`, { token: admin, body: { isUrgent: true } });
  ok(e.status === 200 && e.data.isUrgent === true, 'or put it on any order');
  await call('PUT', `/api/orders/${plainId}`, { token: admin, body: { isUrgent: false } });
}
{
  // Open orders: urgent first, then oldest first.
  const oldOpen = await create(maker1, { title: 'مفتوح قديم', assignedTakerIds: [], openToAll: true });
  const urgentOpen = await create(admin, { title: 'مفتوح ضروري', assignedTakerIds: [], openToAll: true });
  const open = (await call('GET', '/api/orders/open', { token: taker1 })).data.orders.map((o) => o.id);
  ok(open[0] === urgentOpen.data.id && open[1] === oldOpen.data.id, 'in the open list the urgent order comes first too', open.join(','));
}

// ---- makers only see their own orders -------------------------------------------------
console.log('\nMakers only see their own orders');
{
  const other = (await call('GET', '/api/orders/maker?status=all', { token: maker2 })).data.orders;
  ok(Array.isArray(other) && other.length === 0, 'maker2 sees none of maker1\'s (or the admin\'s) orders', `${other?.length}`);
  const generic = (await call('GET', '/api/orders?status=all', { token: maker2 })).data.orders;
  ok(generic.length === 0, 'not through the general order list either');
  ok((await call('GET', '/api/orders/admin', { token: maker2 })).status === 403, 'and cannot use the admin list (403)');
  ok((await call('PUT', `/api/orders/${onlineId}`, { token: maker2, body: { title: 'سرقة' } })).status === 403, 'cannot edit maker1\'s order (403)');
  ok((await call('PUT', `/api/orders/${onlineId}`, { token: maker2, body: { status: 'completed' } })).status === 403, 'cannot change its status (403)');
  ok((await call('PATCH', `/api/orders/${onlineId}/items/status`, { token: maker2, body: { name: 'سكر', status: 'collected' } })).status === 403, 'cannot tick its items (403)');
  ok((await call('DELETE', `/api/orders/${onlineId}`, { token: maker2 })).status === 403, 'cannot delete it (403)');
  const titles = (await call('GET', `/api/orders/suggestions?q=${encodeURIComponent('طلب')}`, { token: maker2 })).data;
  ok(Array.isArray(titles) && titles.length === 0, 'customer-name suggestions never show another maker\'s customers', JSON.stringify(titles));
  const own = (await call('GET', `/api/orders/suggestions?q=${encodeURIComponent('طلب')}`, { token: maker1 })).data;
  ok(own.length > 0, '(maker1 does get their own)');
  const mine = (await call('GET', '/api/orders/maker?status=all', { token: maker1 })).data.orders;
  ok(mine.length > 0 && mine.every((o) => o.makerId === uid('maker1')), 'maker1\'s list holds only maker1\'s orders');
}

// ---- the description, and what a taker may change ----------------------------------------
console.log('\nThe description, and what a taker may change');
{
  const made = await call('POST', '/api/orders', {
    token: maker1,
    body: { title: 'زبون الوصف', city: 'نابلس', items: [{ name: 'شاي', quantity: 1, price: 3 }], assignedTakerIds: [uid('taker1')], accounterId: uid('acc1') },
  });
  ok(made.status === 201 && made.data.description === null, 'an order created with no description stores none (it used to store "Order with 1 items")', JSON.stringify(made.data?.description));
  const id = made.data.id;
  let r = await call('PUT', `/api/orders/${id}`, { token: maker1, body: { description: 'توصيل بعد الظهر' } });
  ok(r.status === 200 && r.data.description === 'توصيل بعد الظهر', 'the maker adds a description', `${r.status}`);
  r = await call('PUT', `/api/orders/${id}`, { token: maker1, body: { description: null } });
  ok(r.status === 200 && r.data.description === null, 'and clears it with an emptied box (it used to come back)', JSON.stringify(r.data?.description));
  r = await call('PUT', `/api/orders/${id}`, { token: maker1, body: { items: [{ name: 'شاي', quantity: 2, price: 3 }] } });
  ok(r.status === 200 && r.data.description === null, 'an edit that leaves the description out does not touch it', `${r.status}`);

  for (const [label, body] of [['customer name', { title: 'غيّرته' }], ['description', { description: 'نص' }], ['city', { city: 'جنين' }]]) {
    r = await call('PUT', `/api/orders/${id}`, { token: taker1, body });
    ok(r.status === 403, `the assigned taker cannot change the ${label} (403)`, `${r.status}`);
  }
  r = await call('PUT', `/api/orders/${id}`, { token: taker1, body: { items: [{ name: 'شاي', quantity: 2 }, { name: 'سكر', quantity: 1 }] } });
  ok(r.status === 200 && r.data.Items?.length === 2, 'but can still add an item, as the app lets them', `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
  const after = (await call('GET', '/api/orders/maker?status=all', { token: maker1 })).data.orders.find((o) => o.id === id);
  ok(Number(after?.Items.find((i) => i.name === 'شاي')?.price) === 3, 'and the maker\'s price survives the taker\'s edit');
  ok(after?.title === 'زبون الوصف' && after?.city === 'نابلس', 'customer and city are unchanged');
}

// ---- the admin sees and manages everything -----------------------------------------------
console.log('\nThe admin sees and manages everything');
{
  const all = (await call('GET', '/api/orders/admin?status=all', { token: admin })).data.orders;
  const makers = new Set(all.map((o) => o.Maker?.username));
  ok(makers.has('maker1') && makers.has('admin'), 'the admin list holds every maker\'s orders', [...makers].join(','));
  const del = await call('DELETE', `/api/orders/${onlineId}`, { token: admin });
  ok(del.status === 200, 'the admin can delete any order (this used to be refused)', `${del.status} ${JSON.stringify(del.data)}`);

  const stats = (await call('GET', '/api/admin/stats', { token: admin })).data;
  ok(stats.recentActivity.length > 0 && stats.recentActivity.every((a) => a.User === null || Number.isInteger(a.User.id)),
    'the overview\'s recent activity carries each person\'s id (with only the name the app showed all zeros)');
  const full = (await call('GET', '/api/admin/logs/all?limit=100', { token: admin })).data;
  ok(full.some((e) => e.type === 'order_change') && full.every((e) => Number.isInteger(e.id) && 'User' in e),
    'every entry of the full log has an id and a User (the app showed an empty list)');
  await call('PUT', `/api/admin/users/${uid('maker2')}/deactivate`, { token: admin, body: {} });
  const after = (await call('GET', '/api/admin/stats', { token: admin })).data;
  const waiting = (await call('GET', '/api/admin/users/pending', { token: admin })).data;
  ok(after.pendingApprovals === waiting.length, 'a deactivated account is not counted as "waiting for approval"', `${after.pendingApprovals} vs ${waiting.length}`);
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
