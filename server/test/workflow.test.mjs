// The order workflow after the November 2026 changes, against the REAL server
// + MySQL and a FAKE Telegram API. Run through `npm run test:integration`.
// Expects an empty database.
//
//  - nobody picks an accountant: a completed order is offered to all of them,
//    and the first to take it gets it (one winner, also when they tap at once)
//  - a city is required; quantities have no default
//  - a taker's item changes go one item at a time, so two takers (or a quick
//    second edit) cannot write an old quantity back over a new one
//  - the maker's edit window changes only what the maker changed
//  - a taker on an order can bring in other takers to help
//  - the maker can send a finished order back to the same takers
//  - API answers are never cached
const BASE = process.argv[2];
const TG = process.argv[3];
if (!BASE || !TG) {
  console.error('usage: node workflow.test.mjs <server-url> <fake-telegram-url>');
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
  return { status: res.status, data, headers: res.headers };
}
const login = async (u, p = 'pass1234') => (await call('POST', '/api/auth/login', { body: { username: u, password: p } })).data.token;

const tgGet = async (path) => (await (await fetch(TG + path)).json()).result;
const tg = {
  say: (chatId, text) => fetch(TG + '/_test/update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, text }),
  }),
  sent: () => tgGet('/_test/sent'),
  edits: () => tgGet('/_test/edits'),
};
const sentTo = async (chatId) => (await tg.sent()).filter((m) => m.chatId === String(chatId));
const editsIn = async (chatId) => (await tg.edits()).filter((m) => m.chatId === String(chatId));
async function waitFor(fn, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  return null;
}
const newSent = async (chatId, before, { wait = 5000, settle = 500 } = {}) => {
  await waitFor(async () => (await sentTo(chatId)).length > before, wait);
  await sleep(settle);
  return (await sentTo(chatId)).slice(before);
};
const newEdits = async (chatId, before, { wait = 5000, settle = 500 } = {}) => {
  await waitFor(async () => (await editsIn(chatId)).length > before, wait);
  await sleep(settle);
  return (await editsIn(chatId)).slice(before);
};

console.log(`\nOrder workflow - real server ${BASE}, fake Telegram ${TG}\n`);

// ---- setup -----------------------------------------------------------------
const admin = await login('admin', 'admin123');
const people = [['maker1', 'maker'], ['maker2', 'maker'], ['taker1', 'taker'], ['taker2', 'taker'], ['taker3', 'taker'], ['acc1', 'accounter'], ['acc2', 'accounter']];
for (const [u, role] of people) await call('POST', '/api/auth/register', { body: { username: u, password: 'pass1234', role } });
for (const u of (await call('GET', '/api/admin/users/pending', { token: admin })).data || []) {
  await call('PUT', `/api/admin/users/${u.id}/approve`, { token: admin, body: {} });
}
const T = {};
for (const [u] of people) T[u] = await login(u);
const users = (await call('GET', '/api/admin/users', { token: admin })).data;
const uid = (u) => users.find((x) => x.username === u).id;

const CHAT = { taker1: 911, taker2: 912, acc1: 921, acc2: 922 };
async function link(token, chatId) {
  const r = await call('POST', '/api/telegram/link', { token });
  await tg.say(chatId, `/start ${new URL(r.data.url).searchParams.get('start')}`);
  return waitFor(async () => (await call('GET', '/api/telegram/status', { token })).data.linked);
}
let linked = true;
for (const [u, chat] of Object.entries(CHAT)) linked = Boolean(await link(T[u], chat)) && linked;
ok(linked, 'setup: taker1, taker2, acc1 and acc2 linked Telegram (taker3 did not)');

const create = (body, token = T.maker1) => call('POST', '/api/orders', {
  token,
  body: { title: 'زبون', city: 'نابلس', items: [{ name: 'طحينة', quantity: 2, price: 12.5 }, { name: 'سكر', quantity: 1, price: 4 }], ...body },
});
const items = (o) => Object.fromEntries((o.Items || []).map((i) => [i.name, i]));
const asMaker = async (id, token = T.maker1) => (await call('GET', '/api/orders/maker?status=all&limit=20', { token })).data.orders.find((o) => o.id === id);
const history = async (id) => {
  const o = (await call('GET', '/api/orders/admin?status=all&limit=20', { token: admin })).data.orders.find((x) => x.id === id);
  return (o?.History || []).map((h) => h.newDescription);
};

// ---- no accountant to pick; city and quantity required -----------------------
console.log('Creating: no accountant to pick, a city and quantities are required');
{
  let r = await create({ assignedTakerIds: [uid('taker3')] });
  ok(r.status === 201 && r.data.accounterId === null, 'an order goes out with no accountant chosen', `${r.status} ${JSON.stringify(r.data?.error)}`);
  r = await create({ city: '', assignedTakerIds: [uid('taker3')] });
  ok(r.status === 400 && r.data?.error === 'Choose a city', 'without a city -> 400 "Choose a city" (no Nablus by default)', `${r.status} ${r.data?.error}`);
  r = await create({ city: undefined, openToAll: true });
  ok(r.status === 400 && r.data?.error === 'Choose a city', 'not even for an open order', `${r.status}`);
  r = await create({ items: [{ name: 'طحينة', quantity: '' }], assignedTakerIds: [uid('taker3')] });
  ok(r.status === 400 && /Invalid quantity/.test(r.data?.error || ''), 'an item without a quantity -> 400 (no quantity 1 by default)', `${r.status} ${r.data?.error}`);
  const draft = await create({ city: '', status: 'archived' });
  ok(draft.status === 201, 'a draft (archived) may wait for its city', `${draft.status}`);
  r = await call('PUT', `/api/orders/${draft.data.id}`, { token: T.maker1, body: { status: 'pending', assignedTakerIds: [uid('taker3')] } });
  ok(r.status === 400 && r.data?.error === 'Choose a city', '...but cannot be sent out without one', `${r.status} ${r.data?.error}`);
  r = await call('PUT', `/api/orders/${draft.data.id}`, { token: T.maker1, body: { status: 'pending', city: 'جنين', assignedTakerIds: [uid('taker3')] } });
  ok(r.status === 200 && r.data.status === 'pending', 'and goes out once it has one', `${r.status} ${r.data?.error}`);
  r = await call('PUT', `/api/orders/${draft.data.id}`, { token: T.maker1, body: { city: '' } });
  ok(r.status === 400 && r.data?.error === 'Choose a city', 'the city of an order that is out cannot be cleared', `${r.status}`);
}

// ---- a taker's item changes: one item at a time -------------------------------
console.log('\nA taker changes items one at a time');
{
  const o = (await create({ assignedTakerIds: [uid('taker1'), uid('taker2')] })).data;
  let r = await call('PATCH', `/api/orders/${o.id}/items/quantity`, { token: T.taker1, body: { name: 'طحينة', quantity: 3 } });
  ok(r.status === 200 && items(r.data)['طحينة'].quantity === 3, 'taker1 changes one quantity', `${r.status} ${r.data?.error}`);
  ok(!('price' in items(r.data)['طحينة']), 'the answer has no prices (takers never see them)');
  ok(Number(items(await asMaker(o.id))['طحينة'].price) === 12.5, 'the maker\'s price is untouched');
  ok((await history(o.id)).includes('Updated طحينة: Qty 2 -> 3'), 'the change is in the order history');
  r = await call('POST', `/api/orders/${o.id}/items`, { token: T.taker2, body: { name: 'زيت', quantity: 2 } });
  ok(r.status === 201 && items(r.data)['زيت']?.quantity === 2, 'taker2 adds one item', `${r.status} ${r.data?.error}`);
  ok(items(await asMaker(o.id))['زيت'].price === null, 'an item a taker adds has no price (the maker sets it)');
  r = await call('POST', `/api/orders/${o.id}/items`, { token: T.taker1, body: { name: 'زيت', quantity: 1 } });
  ok(r.status === 400 && /Duplicate item/.test(r.data?.error), 'adding the same item again -> 400', `${r.status}`);
  r = await call('PATCH', `/api/orders/${o.id}/items/quantity`, { token: T.taker1, body: { name: 'سكر', quantity: 0 } });
  ok(r.status === 400 && /Invalid quantity/.test(r.data?.error), 'a quantity of 0 -> 400', `${r.status}`);
  r = await call('PATCH', `/api/orders/${o.id}/items/quantity`, { token: T.taker3, body: { name: 'سكر', quantity: 5 } });
  ok(r.status === 403, 'a taker not on the order -> 403', `${r.status}`);
  r = await call('PATCH', `/api/orders/${o.id}/items/quantity`, { token: T.taker1, body: { name: 'خبز', quantity: 5 } });
  ok(r.status === 404, 'an item that is not there -> 404', `${r.status}`);

  // The bug: two takers changing different items at the same moment.
  let lost = 0;
  for (let round = 0; round < 20; round++) {
    const a = 10 + round;
    const b = 50 + round;
    await Promise.all([
      call('PATCH', `/api/orders/${o.id}/items/quantity`, { token: T.taker1, body: { name: 'طحينة', quantity: a } }),
      call('PATCH', `/api/orders/${o.id}/items/quantity`, { token: T.taker2, body: { name: 'سكر', quantity: b } }),
    ]);
    const now = items(await asMaker(o.id));
    if (now['طحينة'].quantity !== a || now['سكر'].quantity !== b) lost++;
  }
  ok(lost === 0, 'two takers change two quantities at the same moment, 20 rounds: nothing lost', `${lost} rounds lost a change`);
  let lostAdd = 0;
  for (let round = 0; round < 10; round++) {
    const q = 70 + round;
    await Promise.all([
      call('POST', `/api/orders/${o.id}/items`, { token: T.taker1, body: { name: `صنف ${round}`, quantity: 1 } }),
      call('PATCH', `/api/orders/${o.id}/items/quantity`, { token: T.taker2, body: { name: 'طحينة', quantity: q } }),
    ]);
    const now = items(await asMaker(o.id));
    if (!now[`صنف ${round}`] || now['طحينة'].quantity !== q) lostAdd++;
  }
  ok(lostAdd === 0, 'one adds an item while the other changes a quantity, 10 rounds: both kept', `${lostAdd} rounds lost a change`);
}

// ---- the maker's edit window -------------------------------------------------------
console.log('\nThe maker\'s edit window changes only what the maker changed');
{
  const o = (await create({ assignedTakerIds: [uid('taker1')], items: [{ name: 'أرز', quantity: 2, price: 10 }, { name: 'عدس', quantity: 5, price: 7 }, { name: 'حمص', quantity: 1, price: 8 }] })).data;
  const base = [{ name: 'أرز', quantity: 2, price: 10 }, { name: 'عدس', quantity: 5, price: 7 }, { name: 'حمص', quantity: 1, price: 8 }];
  // While the maker's window is open, the taker works on the order:
  await call('PATCH', `/api/orders/${o.id}/items/quantity`, { token: T.taker1, body: { name: 'عدس', quantity: 7 } });
  await call('POST', `/api/orders/${o.id}/items`, { token: T.taker1, body: { name: 'فريكة', quantity: 1 } });
  await call('PATCH', `/api/orders/${o.id}/items/status`, { token: T.taker1, body: { name: 'أرز', status: 'collected' } });
  await call('PATCH', `/api/orders/${o.id}/items/status`, { token: T.taker1, body: { name: 'حمص', status: 'collected' } });
  // ...then the maker saves: rice 2 -> 3, lentils as they were in the window,
  // chickpeas' price 8 -> 9, a new item, and the window never saw freekeh.
  const r = await call('PUT', `/api/orders/${o.id}`, {
    token: T.maker1,
    body: {
      items: [{ name: 'أرز', quantity: 3, price: 10 }, { name: 'عدس', quantity: 5, price: 7 }, { name: 'حمص', quantity: 1, price: 9 }, { name: 'سميد', quantity: 4, price: 6 }],
      baseItems: base,
    },
  });
  const now = items(r.data);
  ok(r.status === 200, 'setup: the maker saves', `${r.status} ${r.data?.error}`);
  ok(now['أرز']?.quantity === 3, 'the quantity the maker changed is the maker\'s');
  ok(now['أرز']?.status === null, '...and that item lost its tick: it needs checking again');
  ok(now['عدس']?.quantity === 7, 'the quantity the taker changed meanwhile is KEPT (it used to be written back to 5)', `${now['عدس']?.quantity}`);
  ok(Boolean(now['فريكة']), 'the item the taker added meanwhile is KEPT (it used to be deleted)');
  ok(now['حمص']?.status === 'collected' && Number(now['حمص']?.price) === 9, 'a price-only change keeps the tick');
  ok(Boolean(now['سميد']), 'the maker\'s new item is added');
  const removed = await call('PUT', `/api/orders/${o.id}`, {
    token: T.maker1,
    body: {
      items: (r.data.Items || []).filter((i) => i.name !== 'سميد').map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })),
      baseItems: (r.data.Items || []).map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })),
    },
  });
  ok(removed.status === 200 && !items(removed.data)['سميد'] && items(removed.data)['فريكة'], 'an item the maker removes in the window is removed; the others stay');
  const renamed = await call('PUT', `/api/orders/${o.id}`, {
    token: T.maker1,
    body: {
      items: (removed.data.Items || []).map((i) => (i.name === 'حمص' ? { name: 'حمص حب', quantity: i.quantity, price: i.price, status: i.status } : { name: i.name, quantity: i.quantity, price: i.price })),
      baseItems: (removed.data.Items || []).map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })),
    },
  });
  const rn = items(renamed.data);
  ok(renamed.status === 200 && !rn['حمص'] && rn['حمص حب']?.status === 'collected', 'a renamed item keeps its tick', `${renamed.status} ${JSON.stringify(Object.keys(rn))}`);
}

// ---- helpers --------------------------------------------------------------------------
console.log('\nA taker brings in helpers');
let helperOrder;
{
  helperOrder = (await create({ openToAll: true, items: [{ name: 'شاي', quantity: 2, price: 9 }, { name: 'قهوة', quantity: 1, price: 30 }] })).data;
  await call('POST', `/api/orders/${helperOrder.id}/claim`, { token: T.taker1 });
  const before2 = (await sentTo(CHAT.taker2)).length;
  let r = await call('POST', `/api/orders/${helperOrder.id}/helpers`, { token: T.taker1, body: { takerIds: [uid('taker2')] } });
  ok(r.status === 200 && (r.data.AssignedTakers || []).map((t) => t.username).sort().join() === 'taker1,taker2', 'taker1 (who took it) adds taker2', `${r.status} ${r.data?.error}`);
  const mine2 = (await call('GET', '/api/orders/taker?status=active', { token: T.taker2 })).data.orders;
  ok(mine2.some((x) => x.id === helperOrder.id), 'the order is now under taker2\'s «طلباتي»');
  const msg = await newSent(CHAT.taker2, before2);
  ok(msg.length === 1 && msg[0].text.includes('أضافك taker1 لتجهيز الطلب'), 'taker2 is told on Telegram, once', `${msg.length} ${msg[0]?.text?.slice(0, 60)}`);
  const makerNotes = (await call('GET', '/api/notifications', { token: T.maker1 })).data.map((n) => n.message);
  ok(makerNotes.some((m) => m === `Order #${helperOrder.id}: taker1 added taker2 to help`), 'the maker is told in the app');
  ok((await history(helperOrder.id)).includes('Added takers: taker2'), 'and it is in the order history');

  r = await call('PATCH', `/api/orders/${helperOrder.id}/items/status`, { token: T.taker2, body: { name: 'شاي', status: 'collected' } });
  ok(r.status === 200, 'the helper ticks items', `${r.status}`);
  r = await call('PATCH', `/api/orders/${helperOrder.id}/items/quantity`, { token: T.taker2, body: { name: 'قهوة', quantity: 2 } });
  ok(r.status === 200, 'changes quantities', `${r.status}`);
  r = await call('POST', `/api/orders/${helperOrder.id}/helpers`, { token: T.taker2, body: { takerIds: [uid('taker3')] } });
  ok(r.status === 200 && r.data.AssignedTakers.length === 3, 'and brings in a helper too', `${r.status}`);
  r = await call('POST', `/api/orders/${helperOrder.id}/helpers`, { token: T.taker1, body: { takerIds: [uid('maker2')] } });
  ok(r.status === 400 && r.data?.error === 'Invalid taker selection', 'only takers can be added', `${r.status}`);
  const other = (await create({ assignedTakerIds: [uid('taker1')] })).data;
  r = await call('POST', `/api/orders/${other.id}/helpers`, { token: T.taker2, body: { takerIds: [uid('taker2')] } });
  ok(r.status === 403, 'a taker cannot add anyone to an order that is not theirs', `${r.status}`);
  r = await call('POST', `/api/orders/${other.id}/helpers`, { token: T.maker1, body: { takerIds: [uid('taker2')] } });
  ok(r.status === 403, 'the maker uses the edit window, not this', `${r.status}`);
  r = await call('PUT', `/api/orders/${other.id}`, { token: T.taker1, body: { assignedTakerIds: [] } });
  ok(r.status === 403, 'taking someone OFF an order stays the maker\'s call', `${r.status}`);
}

// ---- takers move an order forward only ------------------------------------------------
console.log('\nA taker moves an order forward only; a finished order is locked for takers');
{
  const o = (await create({ assignedTakerIds: [uid('taker1')] })).data;
  let r = await call('PUT', `/api/orders/${o.id}`, { token: T.taker1, body: { status: 'archived' } });
  ok(r.status === 400 && r.data?.error === 'This status change is not allowed', 'a taker cannot archive an order', `${r.status}`);
  r = await call('PUT', `/api/orders/${o.id}`, { token: T.taker1, body: { status: 'in-progress' } });
  ok(r.status === 200, 'starts it', `${r.status}`);
  r = await call('PUT', `/api/orders/${o.id}`, { token: T.taker1, body: { status: 'pending' } });
  ok(r.status === 400, 'cannot move it back to pending', `${r.status}`);
  r = await call('PUT', `/api/orders/${o.id}`, { token: T.taker1, body: { status: 'completed' } });
  ok(r.status === 200, 'finishes it', `${r.status}`);
  ok((await history(o.id)).includes('Status: in-progress -> completed'), 'status changes are now in the order history');
  r = await call('PUT', `/api/orders/${o.id}`, { token: T.taker1, body: { status: 'in-progress' } });
  ok(r.status === 409, 'cannot reopen it (only the maker sends it back)', `${r.status}`);
  r = await call('PATCH', `/api/orders/${o.id}/items/quantity`, { token: T.taker1, body: { name: 'سكر', quantity: 9 } });
  ok(r.status === 409, 'cannot change a quantity of a finished order', `${r.status}`);
  r = await call('POST', `/api/orders/${o.id}/items`, { token: T.taker1, body: { name: 'خبز', quantity: 1 } });
  ok(r.status === 409, 'or add an item', `${r.status}`);
  r = await call('POST', `/api/orders/${o.id}/helpers`, { token: T.taker1, body: { takerIds: [uid('taker2')] } });
  ok(r.status === 409, 'or add helpers', `${r.status}`);
}

// ---- accountants take completed orders ---------------------------------------------------
console.log('\nAccountants take completed orders - the first one gets it');
{
  const o = (await create({ assignedTakerIds: [uid('taker1')], items: [{ name: 'طحينة', quantity: 2, price: 12.5 }, { name: 'سكر', quantity: 1, price: 4 }] })).data;
  let r = await call('POST', `/api/orders/${o.id}/accounting-claim`, { token: T.acc1 });
  ok(r.status === 409 && r.data?.error === 'This order is not ready for the accountant yet', 'cannot be taken before it is completed', `${r.status} ${r.data?.error}`);
  await call('PATCH', `/api/orders/${o.id}/items/status`, { token: T.taker1, body: { name: 'سكر', status: 'unavailable' } });
  const b1 = (await sentTo(CHAT.acc1)).length;
  const b2 = (await sentTo(CHAT.acc2)).length;
  r = await call('PUT', `/api/orders/${o.id}`, { token: T.taker1, body: { status: 'completed' } });
  ok(r.status === 200, 'setup: taker1 completes it', `${r.status}`);
  const m1 = await newSent(CHAT.acc1, b1);
  const m2 = await newSent(CHAT.acc2, b2);
  ok(m1.length === 1 && m2.length === 1, 'every accountant on Telegram is offered it, once', `${m1.length}/${m2.length}`);
  ok(m1[0]?.text.includes('طلب جاهز للمحاسبة') && m1[0]?.text.includes('أول محاسب يأخذه'), 'the message says first come, first served');
  ok(m1[0]?.text.includes('<s>') && !/12\.5|12٫5/.test(m1[0]?.text || ''), 'shows the unavailable item struck through, and no prices');
  const notes = (await call('GET', '/api/notifications', { token: T.acc2 })).data.map((n) => n.message);
  ok(notes.includes(`Order #${o.id} is ready for an accountant: زبون`), 'and told in the app too');
  const av1 = (await call('GET', '/api/orders/accounter/available', { token: T.acc1 })).data.orders.map((x) => x.id);
  const av2 = (await call('GET', '/api/orders/accounter/available', { token: T.acc2 })).data.orders.map((x) => x.id);
  ok(av1.includes(o.id) && av2.includes(o.id), 'both see it under «available»');
  ok(!(await call('GET', '/api/orders/accounter?status=completed', { token: T.acc1 })).data.orders.some((x) => x.id === o.id), 'it is nobody\'s yet');

  const e1 = (await editsIn(CHAT.acc1)).length;
  const e2 = (await editsIn(CHAT.acc2)).length;
  r = await call('POST', `/api/orders/${o.id}/accounting-claim`, { token: T.acc1 });
  ok(r.status === 200 && r.data.accounterId === uid('acc1'), 'acc1 takes it', `${r.status} ${r.data?.error}`);
  r = await call('POST', `/api/orders/${o.id}/accounting-claim`, { token: T.acc2 });
  ok(r.status === 409 && r.data?.code === 'ORDER_TAKEN', 'acc2 is too late: 409', `${r.status}`);
  ok(!(await call('GET', '/api/orders/accounter/available', { token: T.acc2 })).data.orders.some((x) => x.id === o.id), 'it left «available»');
  ok((await call('GET', '/api/orders/accounter?status=completed', { token: T.acc1 })).data.orders.some((x) => x.id === o.id), 'it is in acc1\'s own list');
  const ed1 = await newEdits(CHAT.acc1, e1);
  const ed2 = await newEdits(CHAT.acc2, e2);
  ok(ed1.length === 1 && ed1[0].text.includes('أخذتَ الطلب'), 'acc1\'s message now says they took it');
  ok(ed2.length === 1 && ed2[0].text.includes('أخذه acc1'), 'acc2\'s message says acc1 took it');
  ok((await history(o.id)).includes('Taken for accounting by acc1'), 'it is in the order history');
  const offer = (await call('GET', '/api/notifications', { token: T.acc2 })).data
    .find((n) => n.message === `Order #${o.id} is ready for an accountant: زبون`);
  ok(offer && offer.isRead === true, 'acc2\'s in-app offer stops counting as unread (it stays in the list)', JSON.stringify(offer));
  r = await call('PUT', `/api/orders/${o.id}`, { token: T.acc2, body: { status: 'entered_erp' } });
  ok(r.status === 403, 'acc2 cannot enter it into ERP', `${r.status}`);
  r = await call('POST', `/api/orders/${o.id}/accounting-claim`, { token: T.taker1 });
  ok(r.status === 403, 'a taker cannot take orders for accounting', `${r.status}`);

  // The race: both accountants tap twice at the same moment, 15 orders.
  let bad = 0;
  for (let round = 0; round < 15; round++) {
    const x = (await create({ assignedTakerIds: [uid('taker2')], items: [{ name: 'ملح', quantity: 1 }] })).data;
    await call('PUT', `/api/orders/${x.id}`, { token: T.taker2, body: { status: 'completed' } });
    const results = await Promise.all([T.acc1, T.acc2, T.acc1, T.acc2].map((t) => call('POST', `/api/orders/${x.id}/accounting-claim`, { token: t })));
    const winners = new Set(results.filter((res) => res.status === 200).map((res) => res.data.accounterId));
    const losers = results.filter((res) => res.status === 409).length;
    if (winners.size !== 1 || losers < 1) bad++;
  }
  ok(bad === 0, 'two accountants tap at once, 15 orders: always exactly one gets it', `${bad} rounds went wrong`);
}

// ---- sending a finished order back ----------------------------------------------------------
console.log('\nThe maker sends a finished order back to the same takers');
{
  // helperOrder: taker1 + taker2 + taker3 on it. Finish it; acc1 takes it.
  await call('PATCH', `/api/orders/${helperOrder.id}/items/status`, { token: T.taker1, body: { name: 'قهوة', status: 'unavailable' } });
  await call('PUT', `/api/orders/${helperOrder.id}`, { token: T.taker1, body: { status: 'completed' } });
  await call('POST', `/api/orders/${helperOrder.id}/accounting-claim`, { token: T.acc1 });
  const done = await asMaker(helperOrder.id);
  ok(done.status === 'completed' && done.accounterId === uid('acc1'), 'setup: finished, and taken by acc1');

  const t1 = (await sentTo(CHAT.taker1)).length;
  const t2 = (await sentTo(CHAT.taker2)).length;
  const a1 = (await sentTo(CHAT.acc1)).length;
  const base = done.Items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price }));
  const r = await call('PUT', `/api/orders/${helperOrder.id}`, {
    token: T.maker1,
    body: { items: done.Items.map((i) => ({ name: i.name, quantity: i.name === 'شاي' ? 4 : i.quantity, price: i.price })), baseItems: base },
  });
  const now = items(r.data);
  ok(r.status === 200 && r.data.status === 'in-progress', 'changing an item of a completed order sends it back: in progress again', `${r.status} ${r.data?.status} ${r.data?.error}`);
  ok(now['شاي']?.quantity === 4 && now['شاي']?.status === null, 'the changed item lost its tick');
  ok(now['قهوة']?.status === 'unavailable', 'the untouched item keeps its mark');
  ok(r.data.AssignedTakers.length === 3, 'the same takers keep it');
  for (const who of ['taker1', 'taker2', 'taker3']) {
    const list = (await call('GET', '/api/orders/taker?status=active', { token: T[who] })).data.orders;
    if (!list.some((x) => x.id === helperOrder.id)) ok(false, `${who} sees it again`);
  }
  ok(true, 'it is back under «طلباتي» for all three');
  const h = await history(helperOrder.id);
  ok(h.includes('Sent back to the takers') && h.includes('Status: completed -> in-progress'), 'the history says it was sent back');
  const tm1 = await newSent(CHAT.taker1, t1);
  const tm2 = await newSent(CHAT.taker2, t2);
  ok(tm1.length === 1 && tm1[0].text.includes('أُعيد إليك الطلب') && tm2.length === 1, 'each taker on Telegram gets ONE "sent back to you" message (not also "edited")', `${tm1.length}/${tm2.length}`);
  const am1 = await newSent(CHAT.acc1, a1);
  ok(am1.length === 1 && am1[0].text.includes('سيعود إليك عند اكتماله'), 'acc1 is told it comes back to them when done');
  ok(!(await call('GET', '/api/orders/accounter?status=completed', { token: T.acc1 })).data.orders.some((x) => x.id === helperOrder.id), 'meanwhile it left acc1\'s list');

  const a2 = (await sentTo(CHAT.acc2)).length;
  const a1b = (await sentTo(CHAT.acc1)).length;
  await call('PATCH', `/api/orders/${helperOrder.id}/items/status`, { token: T.taker2, body: { name: 'شاي', status: 'collected' } });
  await call('PUT', `/api/orders/${helperOrder.id}`, { token: T.taker2, body: { status: 'completed' } });
  const back = await newSent(CHAT.acc1, a1b);
  ok(back.length === 1 && back[0].text.includes('طلب جاهز للإدخال على ERP'), 'finished again: it goes straight back to acc1');
  const none = await newSent(CHAT.acc2, a2, { wait: 1500 });
  ok(none.length === 0, 'and is not offered to the other accountants again');

  // Price only: nothing for the takers to redo.
  const fin = await asMaker(helperOrder.id);
  const t1b = (await sentTo(CHAT.taker1)).length;
  const p = await call('PUT', `/api/orders/${helperOrder.id}`, {
    token: T.maker1,
    body: { items: fin.Items.map((i) => ({ name: i.name, quantity: i.quantity, price: Number(i.price) + 1 })), baseItems: fin.Items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })) },
  });
  ok(p.status === 200 && p.data.status === 'completed', 'changing only prices keeps it completed (nothing for takers to redo)', `${p.data?.status}`);
  ok((await newSent(CHAT.taker1, t1b, { wait: 1500 })).length === 0, 'and the takers get no message');

  // Sent back by status alone, while it was on offer to all accountants.
  const x = (await create({ assignedTakerIds: [uid('taker1')] })).data;
  const o1 = (await sentTo(CHAT.acc1)).length;
  await call('PUT', `/api/orders/${x.id}`, { token: T.taker1, body: { status: 'completed' } });
  await newSent(CHAT.acc1, o1);
  const e1 = (await editsIn(CHAT.acc1)).length;
  const tx = (await sentTo(CHAT.taker1)).length;
  const s = await call('PUT', `/api/orders/${x.id}`, { token: T.maker1, body: { status: 'in-progress' } });
  ok(s.status === 200 && s.data.status === 'in-progress', 'the maker can also send it back with the status menu', `${s.status}`);
  const ed = await newEdits(CHAT.acc1, e1);
  ok(ed.length === 1 && ed[0].text.includes('أُعيد الطلب'), 'the offer to the accountants is edited to say it went back');
  const tmx = await newSent(CHAT.taker1, tx);
  ok(tmx.length === 1 && tmx[0].text.includes('أُعيد إليك الطلب'), 'and the taker is told');
  const offerRead = async (token, id) => (await call('GET', '/api/notifications', { token })).data
    .filter((n) => n.message.startsWith(`Order #${id} is ready for an accountant:`))
    .every((n) => n.isRead === true);
  ok(await offerRead(T.acc1, x.id) && await offerRead(T.acc2, x.id), 'the in-app offers no longer count as unread');

  // Deleted while on offer: same.
  const y = (await create({ assignedTakerIds: [uid('taker1')] })).data;
  await call('PUT', `/api/orders/${y.id}`, { token: T.taker1, body: { status: 'completed' } });
  const unreadBefore = (await call('GET', '/api/notifications', { token: T.acc2 })).data
    .some((n) => n.message.startsWith(`Order #${y.id} is ready for an accountant:`) && !n.isRead);
  const del = await call('DELETE', `/api/orders/${y.id}`, { token: T.maker1 });
  ok(unreadBefore && del.status === 200 && await offerRead(T.acc2, y.id), 'an offered order that is deleted stops counting too', `${unreadBefore} ${del.status}`);
}

// ---- the maker changes an order after ERP --------------------------------------------------
console.log('\nThe maker can change an order even after it was entered into ERP - and it all stays in the history');
{
  const NAME = 'زبون بعد ERP';
  const made = (await create({ title: NAME, assignedTakerIds: [uid('taker1')], items: [{ name: 'طحينة', quantity: 2, price: 12.5 }, { name: 'سكر', quantity: 1, price: 4 }] })).data;
  const id = made.id;
  const find = async (search, { token = admin, role = 'admin' } = {}) =>
    (await call('GET', `/api/orders/${role}?status=all&search=${encodeURIComponent(search)}`, { token })).data.orders.find((o) => o.id === id);
  const hist = async (search) => ((await find(search))?.History || []).map((x) => x.newDescription);
  const plain = (o) => o.Items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price }));
  const notes = async (token) => (await call('GET', '/api/notifications', { token })).data;

  await call('PUT', `/api/orders/${id}`, { token: T.taker1, body: { status: 'completed' } });
  await call('POST', `/api/orders/${id}/accounting-claim`, { token: T.acc1 });
  let r = await call('PUT', `/api/orders/${id}`, { token: T.acc1, body: { status: 'entered_erp' } });
  ok(r.status === 200 && r.data.status === 'entered_erp', 'setup: finished, taken by acc1, entered into ERP', `${r.status}`);

  // Saving without changing anything: allowed, and leaves no trace.
  const o0 = await find(NAME, { token: T.maker1, role: 'maker' });
  const base0 = plain(o0);
  const n0 = (await notes(T.acc1)).length;
  r = await call('PUT', `/api/orders/${id}`, { token: T.maker1, body: { title: NAME, city: o0.city, items: base0, baseItems: base0 } });
  ok(r.status === 200 && r.data.status === 'entered_erp', 'its maker may now save it (it used to be refused with 409)', `${r.status} ${r.data?.error}`);
  ok(!(await hist(NAME)).includes('Changed after it was entered into ERP'), 'a save that changes nothing leaves no mark in the history');
  ok((await notes(T.acc1)).length === n0, '...and tells nobody');

  // The customer name and a price: it stays entered into ERP; every change is in the history.
  const a1 = (await sentTo(CHAT.acc1)).length;
  const a2 = (await sentTo(CHAT.acc2)).length;
  const t1 = (await sentTo(CHAT.taker1)).length;
  const items1 = base0.map((i) => (i.name === 'طحينة' ? { ...i, price: 14 } : i));
  r = await call('PUT', `/api/orders/${id}`, { token: T.maker1, body: { title: `${NAME} 2`, items: items1, baseItems: base0 } });
  ok(r.status === 200 && r.data.status === 'entered_erp', 'the maker changes the customer name and a price: it stays entered into ERP', `${r.status} ${r.data?.status}`);
  const h1 = await hist(`${NAME} 2`);
  ok(h1[0] === 'Changed after it was entered into ERP', 'the history says, on top, that this came after ERP', h1[0]);
  ok(h1.includes(`Title: ${NAME} -> ${NAME} 2`), '...then the new customer name');
  ok(h1.includes('Updated طحينة: Price 12.5 -> 14'), '...and the price change (prices were not written to the history at all before)', JSON.stringify(h1.slice(0, 4)));
  ok((await notes(T.acc1)).some((n) => n.message === `Order #${id} was changed by maker1 after it was entered into ERP`), 'acc1, who entered it, is told in the app');
  const am = await newSent(CHAT.acc1, a1);
  ok(am.length === 1 && am[0].text.includes('بعد إدخاله على ERP') && !am[0].text.includes('12.5') && !am[0].text.includes('سعر'), '...and once on Telegram, without prices', `${am.length}`);
  ok((await newSent(CHAT.acc2, a2, { wait: 1000 })).length === 0, 'the other accountant hears nothing');
  ok((await newSent(CHAT.taker1, t1, { wait: 1000 })).length === 0, 'nor do its takers - they are done with it');
  ok(!(await notes(T.taker1)).some((n) => n.message === `Order #${id} was updated by Maker`), '...not even in the app');

  // Takers never see prices - also not in the history.
  const PRICED = 'زبون السعر';
  const live = (await create({ title: PRICED, assignedTakerIds: [uid('taker1')], items: [{ name: 'طحينة', quantity: 2, price: 12.5 }] })).data;
  const lb = [{ name: 'طحينة', quantity: 2, price: 12.5 }];
  await call('PATCH', `/api/orders/${live.id}/items/status`, { token: T.taker1, body: { name: 'طحينة', status: 'collected' } });
  await call('PUT', `/api/orders/${live.id}`, { token: T.maker1, body: { items: [{ name: 'طحينة', quantity: 2, price: 13 }], baseItems: lb } });
  const seenByTaker = (await call('GET', `/api/orders/taker?search=${encodeURIComponent(PRICED)}`, { token: T.taker1 })).data.orders.find((o) => o.id === live.id);
  const seenByAdmin = (await call('GET', `/api/orders/admin?status=all&search=${encodeURIComponent(PRICED)}`, { token: admin })).data.orders.find((o) => o.id === live.id);
  ok(seenByAdmin?.History.some((x) => x.newDescription === 'Updated طحينة: Price 12.5 -> 13'), 'a price change is in the history for the maker and the admin');
  const takerLines = (seenByTaker?.History || []).map((x) => x.newDescription);
  ok(takerLines.includes('طحينة: collected') && !takerLines.some((x) => /Price/.test(x)), '...but not in the taker\'s copy of it (which still has the rest)', JSON.stringify(takerLines));

  // A quantity after ERP: back to the same takers, then back to acc1 to enter again.
  const o1 = await find(`${NAME} 2`, { token: T.maker1, role: 'maker' });
  const base1 = plain(o1);
  const t1b = (await sentTo(CHAT.taker1)).length;
  const a1b = (await sentTo(CHAT.acc1)).length;
  r = await call('PUT', `/api/orders/${id}`, { token: T.maker1, body: { items: base1.map((i) => (i.name === 'سكر' ? { ...i, quantity: 3 } : i)), baseItems: base1 } });
  ok(r.status === 200 && r.data.status === 'in-progress', 'a changed quantity after ERP sends it back to its takers', `${r.status} ${r.data?.status}`);
  const h2 = await hist(`${NAME} 2`);
  ok(h2[0] === 'Changed after it was entered into ERP' && h2.includes('Status: entered_erp -> in-progress') && h2.includes('Sent back to the takers') && h2.includes('Updated سكر: Qty 1 -> 3'),
    'the history shows all of it', JSON.stringify(h2.slice(0, 5)));
  const tm = await newSent(CHAT.taker1, t1b);
  ok(tm.length === 1 && tm[0].text.includes('أُعيد إليك الطلب'), 'taker1 gets one "sent back to you" message', `${tm.length}`);
  const am2 = await newSent(CHAT.acc1, a1b);
  ok(am2.length === 1 && am2[0].text.includes('سيعود إليك'), 'acc1 gets one message: it comes back when done', `${am2.length}`);
  await call('PUT', `/api/orders/${id}`, { token: T.taker1, body: { status: 'completed' } });
  ok((await call('GET', '/api/orders/accounter?status=completed', { token: T.acc1 })).data.orders.some((o) => o.id === id), 'finished again, it is straight back in acc1\'s list (not offered to everyone)');
  r = await call('PUT', `/api/orders/${id}`, { token: T.acc1, body: { status: 'entered_erp' } });
  ok(r.status === 200 && r.data.status === 'entered_erp', '...and acc1 enters it into ERP again', `${r.status}`);

  // Or the status menu: back to «completed», for the accountant to enter again.
  r = await call('PUT', `/api/orders/${id}`, { token: T.maker1, body: { status: 'completed' } });
  ok(r.status === 200 && r.data.status === 'completed' && r.data.accounterId === uid('acc1'), 'the maker can also put it back to «completed», still acc1\'s', `${r.status} ${r.data?.status}`);
  ok((await notes(T.acc1)).some((n) => n.message.startsWith(`New completed order ready for review: Order #${id}`)), '...and acc1 is told it is ready again');

  // Still nobody else.
  r = await call('PUT', `/api/orders/${id}`, { token: T.acc1, body: { status: 'entered_erp' } });
  r = await call('PUT', `/api/orders/${id}`, { token: T.maker2, body: { title: 'غريب' } });
  ok(r.status === 403, 'another maker still cannot change it', `${r.status}`);
  r = await call('PUT', `/api/orders/${id}`, { token: T.taker1, body: { status: 'in-progress' } });
  ok(r.status === 409, 'nor can its taker', `${r.status}`);
}

// ---- freshness ------------------------------------------------------------------------------
console.log('\nAPI answers are never cached');
{
  const r = await call('GET', '/api/orders/maker', { token: T.maker1 });
  ok(r.headers.get('cache-control') === 'no-store', 'Cache-Control: no-store on order lists', r.headers.get('cache-control'));
  const h = await call('GET', '/api/health');
  ok(h.headers.get('cache-control') === 'no-store', 'and on every /api answer');
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
