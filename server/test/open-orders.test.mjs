// Open orders ("مفتوح لأي مجهّز"), against the REAL server + MySQL and a FAKE
// Telegram API. Run through `npm run test:integration`, which passes both
// addresses in. Expects an empty database.
//
// An open order is pending with no taker assigned; any taker may take it, and
// exactly one must win when several tap at the same moment.
const BASE = process.argv[2];
const TG = process.argv[3];
if (!BASE || !TG) {
  console.error('usage: node open-orders.test.mjs <server-url> <fake-telegram-url>');
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
/** Messages that reached chatId after `before` existed; waits, then lets duplicates arrive. */
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

console.log(`\nOpen orders - real server ${BASE}, fake Telegram ${TG}\n`);

// ---- setup -----------------------------------------------------------------
const admin = await login('admin', 'admin123');
const people = [['maker1', 'maker'], ['taker1', 'taker'], ['taker2', 'taker'], ['taker3', 'taker'], ['taker4', 'taker'], ['acc1', 'accounter']];
for (const [u, role] of people) {
  await call('POST', '/api/auth/register', { body: { username: u, password: 'pass1234', role } });
}
for (const u of (await call('GET', '/api/admin/users/pending', { token: admin })).data || []) {
  await call('PUT', `/api/admin/users/${u.id}/approve`, { token: admin, body: {} });
}
// Registered but never approved: must not be assignable, and must not be offered open orders.
await call('POST', '/api/auth/register', { body: { username: 'taker_new', password: 'pass1234', role: 'taker' } });

const T = {};
for (const [u] of people) T[u] = await login(u);
const maker = T.maker1;
const allUsers = (await call('GET', '/api/admin/users', { token: admin })).data;
const uid = (u) => allUsers.find((x) => x.username === u).id;
const acc = uid('acc1');

// taker1 and taker2 link Telegram (chats 801, 802); taker3 and taker4 do not.
async function link(token, chatId) {
  const r = await call('POST', '/api/telegram/link', { token });
  await tg.say(chatId, `/start ${new URL(r.data.url).searchParams.get('start')}`);
  return waitFor(async () => (await call('GET', '/api/telegram/status', { token })).data.linked);
}
ok(Boolean(await link(T.taker1, 801)) && Boolean(await link(T.taker2, 802)), 'taker1 and taker2 linked Telegram');
ok(Boolean(await link(T.acc1, 803)), 'the accountant linked Telegram too');

const items = [{ name: 'طحينة', quantity: 2, price: 12.75 }, { name: 'سكر', quantity: 1, price: 4.5 }];
const create = (body) => call('POST', '/api/orders', {
  token: maker,
  body: { title: 'زبون', city: 'نابلس', items, accounterId: acc, ...body },
});
const createOpen = async (title = 'طلب مفتوح') => {
  const r = await create({ title, openToAll: true, assignedTakerIds: [] });
  if (r.status !== 201) throw new Error(`create open: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
// Newest first, so a just-created order is on the first page.
const getOrder = async (id) => {
  const r = await call('GET', '/api/orders/admin?status=all&limit=20', { token: admin });
  const found = r.data.orders.find((o) => o.id === id);
  return found;
};
const openList = async (token = T.taker3) => (await call('GET', '/api/orders/open', { token })).data;

// ---- creating ----------------------------------------------------------------
console.log('Creating');
{
  let r = await create({ assignedTakerIds: [] });
  ok(r.status === 400 && /at least one taker/.test(r.data?.error), 'no taker and not open -> still refused (a forgotten taker is not an open order)', `${r.status}`);
  r = await create({ openToAll: true, assignedTakerIds: [uid('taker1')] });
  ok(r.status === 400 && /cannot also be assigned/.test(r.data?.error), 'open AND assigned -> refused', `${r.status}`);
  r = await create({ openToAll: true, assignedTakerIds: [], accounterId: null });
  ok(r.status === 400 && /accounter/.test(r.data?.error), 'an open order still needs an accountant', `${r.status}`);
  r = await create({ assignedTakerIds: [uid('maker1')] });
  ok(r.status === 400 && r.data?.error === 'Invalid taker selection', 'assigning a maker as a "taker" -> refused', `${r.status} ${r.data?.error}`);
  r = await create({ assignedTakerIds: [99999] });
  ok(r.status === 400 && r.data?.error === 'Invalid taker selection', 'assigning a user id that does not exist -> refused', `${r.status}`);
  r = await create({ assignedTakerIds: [uid('taker_new')] });
  ok(r.status === 400 && r.data?.error === 'Invalid taker selection', 'assigning an unapproved taker -> refused', `${r.status}`);
}

let order1;
{
  const before1 = (await sentTo(801)).length;
  const before2 = (await sentTo(802)).length;
  const beforeAcc = (await sentTo(803)).length;
  order1 = await createOpen('مطعم السعادة');
  ok(order1.status === 'pending' && order1.AssignedTakers.length === 0, 'open order created: pending, nobody assigned');

  const m1 = await newSent(801, before1);
  const m2 = await newSent(802, before2);
  ok(m1.length === 1 && m2.length === 1, 'each linked taker gets exactly one message', `${m1.length}/${m2.length}`);
  const text = m1[0]?.text || '';
  ok(text.includes('طلب مفتوح') && text.includes(`#${order1.id}`) && text.includes('مطعم السعادة') && text.includes('طحينة'),
    'it says "open order" with the number, customer and items');
  ok(!text.includes('12.75') && !text.includes('4.5'), 'and no prices');
  ok(m1[0]?.button?.url === 'http://192.168.1.10:6001/taker/open', 'its button opens the open-orders tab', m1[0]?.button?.url);
  ok((await sentTo(803)).length === beforeAcc, 'the accountant gets nothing for an open order');
}

// ---- who sees it ----------------------------------------------------------------
console.log('\nWho sees it');
{
  const list = await openList(T.taker3);
  const row = list?.orders?.find((o) => o.id === order1.id);
  ok(Boolean(row), 'an unlinked taker sees it in the open list');
  ok(row && row.Items.every((i) => !('price' in i)), 'without prices');
  ok(list.pagination.total >= 1, 'with a total for the badge');
  ok((await call('GET', '/api/orders/open', { token: maker })).status === 403, 'a maker cannot use the open list (403)');
  ok((await call('GET', '/api/orders/open', { token: T.acc1 })).status === 403, 'an accountant cannot either (403)');
  ok((await call('GET', '/api/orders/open')).status === 401, 'nor can anyone without a token (401)');

  const mine = (await call('GET', '/api/orders/taker?status=all', { token: T.taker3 })).data.orders;
  ok(!mine.some((o) => o.id === order1.id), 'it is not in any taker\'s own list before they take it');

  const tick = await call('PATCH', `/api/orders/${order1.id}/items/status`, { token: T.taker3, body: { name: 'سكر', status: 'collected' } });
  ok(tick.status === 403, 'a taker cannot tick items before taking it (403)', `${tick.status}`);
  const edit = await call('PUT', `/api/orders/${order1.id}`, { token: T.taker3, body: { status: 'in-progress' } });
  ok(edit.status === 403, 'nor start it (403)', `${edit.status}`);

  const makers = (await call('GET', '/api/orders/maker', { token: maker })).data.orders;
  ok(makers.some((o) => o.id === order1.id && o.AssignedTakers.length === 0), 'the maker sees it in their active list, unassigned');
}

// ---- taking it -------------------------------------------------------------------
console.log('\nTaking it');
{
  ok((await call('POST', `/api/orders/${order1.id}/claim`, { token: maker })).status === 403, 'a maker cannot take it (403)');
  ok((await call('POST', `/api/orders/${order1.id}/claim`, { token: T.acc1 })).status === 403, 'an accountant cannot take it (403)');
  ok((await call('POST', '/api/orders/999999/claim', { token: T.taker3 })).status === 404, 'taking an order that does not exist -> 404');

  const edits1 = (await editsIn(801)).length;
  const edits2 = (await editsIn(802)).length;
  const sent1 = (await sentTo(801)).length;

  const r = await call('POST', `/api/orders/${order1.id}/claim`, { token: T.taker3 });
  ok(r.status === 200 && r.data.AssignedTakers.map((t) => t.username).join() === 'taker3', 'taker3 takes it', `${r.status}`);
  ok(r.data.Items.every((i) => !('price' in i)), 'the response has no prices');

  const again = await call('POST', `/api/orders/${order1.id}/claim`, { token: T.taker3 });
  ok(again.status === 200 && again.data.AssignedTakers.length === 1, 'tapping again is harmless: still theirs, still one assignment');

  const late = await call('POST', `/api/orders/${order1.id}/claim`, { token: T.taker4 });
  ok(late.status === 409 && late.data?.code === 'ORDER_TAKEN', 'a second taker gets 409 ORDER_TAKEN', `${late.status}`);

  ok(!(await openList(T.taker4)).orders.some((o) => o.id === order1.id), 'it is gone from the open list');
  const mine = (await call('GET', '/api/orders/taker', { token: T.taker3 })).data.orders;
  ok(mine.some((o) => o.id === order1.id), 'and is in taker3\'s own list');

  const tick = await call('PATCH', `/api/orders/${order1.id}/items/status`, { token: T.taker3, body: { name: 'سكر', status: 'collected' } });
  ok(tick.status === 200, 'now taker3 can tick items');

  const notes = (await call('GET', '/api/notifications', { token: maker })).data;
  const list = Array.isArray(notes) ? notes : notes?.notifications || [];
  ok(list.some((n) => n.orderId === order1.id && n.message.includes('taker3')), 'the maker is told in the app who took it');

  const full = await call('GET', `/api/orders/maker?status=all&includeHistory=true`, { token: maker });
  const hist = full.data.orders.find((o) => o.id === order1.id)?.History || [];
  ok(hist.some((h) => h.newDescription === 'Taken by taker3'), 'the order history records who took it');

  const e1 = await newEdits(801, edits1);
  const e2 = await newEdits(802, edits2);
  ok(e1.length === 1 && e2.length === 1, 'the open-order message each linked taker got is edited once', `${e1.length}/${e2.length}`);
  ok(e1[0]?.text.includes('تم أخذ الطلب') && e1[0]?.text.includes('taker3'), 'to say it was taken, and by whom');
  ok(e1[0] && !e1[0].button, 'and its "open the system" button is gone');
  ok((await sentTo(801)).length === sent1, 'no new message is sent for it - the old one is edited instead');
}
{
  // A linked taker who takes it sees their own copy change to "you took it".
  const o = await createOpen('للمجهّز المرتبط');
  await waitFor(async () => (await sentTo(801)).some((m) => m.text.includes(`#${o.id}`)));
  const before = (await editsIn(801)).length;
  await call('POST', `/api/orders/${o.id}/claim`, { token: T.taker1 });
  const e = await newEdits(801, before);
  ok(e[0]?.text.includes('أخذتَ الطلب'), 'the taker who took it reads "you took it" in their own copy');
}
{
  const assigned = await create({ assignedTakerIds: [uid('taker1')] });
  const r = await call('POST', `/api/orders/${assigned.data.id}/claim`, { token: T.taker2 });
  ok(r.status === 409, 'an order assigned by the maker cannot be taken by someone else (409)', `${r.status}`);
  const archived = await create({ status: 'archived', accounterId: null });
  const r2 = await call('POST', `/api/orders/${archived.data.id}/claim`, { token: T.taker2 });
  ok(r2.status === 409, 'an archived order cannot be taken (409)', `${r2.status}`);
}

// ---- the race ----------------------------------------------------------------------
console.log('\nFour takers tap at the same moment');
{
  const ROUNDS = 20;
  const takers = ['taker1', 'taker2', 'taker3', 'taker4'];
  let clean = 0;
  const problems = [];
  for (let round = 0; round < ROUNDS; round++) {
    const o = await createOpen(`سباق ${round}`);
    // Each taker taps twice, all eight requests in flight together.
    const attempts = takers.flatMap((u) => [u, u]);
    const results = await Promise.all(attempts.map(async (u) => ({ u, r: await call('POST', `/api/orders/${o.id}/claim`, { token: T[u] }) })));
    const winners = new Set(results.filter((x) => x.r.status === 200).map((x) => x.u));
    const losers = results.filter((x) => x.r.status === 409);
    const errors = results.filter((x) => ![200, 409].includes(x.r.status));
    const final = await getOrder(o.id);
    const assigned = final.AssignedTakers.map((t) => t.username);
    const good = winners.size === 1 && errors.length === 0 && assigned.length === 1 && winners.has(assigned[0])
      && losers.length === results.length - results.filter((x) => x.r.status === 200).length;
    if (good) clean++;
    else problems.push(`round ${round}: winners=${[...winners]} assigned=${assigned} errors=${errors.map((x) => x.r.status)}`);
  }
  ok(clean === ROUNDS, `${ROUNDS} rounds x 8 simultaneous taps: exactly one taker wins every time`, problems.slice(0, 3).join(' | '));
}
{
  // The maker assigns the order at the same moment a taker takes it: whatever
  // the order of events, the order must end up with the maker's choice only.
  const ROUNDS = 10;
  let consistent = 0;
  const problems = [];
  for (let round = 0; round < ROUNDS; round++) {
    const o = await createOpen(`مدير ضد مجهّز ${round}`);
    const [put] = await Promise.all([
      call('PUT', `/api/orders/${o.id}`, { token: maker, body: { assignedTakerIds: [uid('taker1')] } }),
      call('POST', `/api/orders/${o.id}/claim`, { token: T.taker2 }),
    ]);
    const final = await getOrder(o.id);
    const assigned = final.AssignedTakers.map((t) => t.username).join();
    if (put.status === 200 && assigned === 'taker1') consistent++;
    else problems.push(`round ${round}: put=${put.status} assigned=${assigned}`);
  }
  ok(consistent === ROUNDS, `maker assigns while a taker takes it, ${ROUNDS} rounds: always ends with the maker's choice only`, problems.slice(0, 3).join(' | '));
}

// ---- editing ------------------------------------------------------------------------
console.log('\nEditing');
{
  const o = await createOpen('تعديل المفتوح');
  await waitFor(async () => (await sentTo(801)).some((m) => m.text.includes(`#${o.id}`)));
  const before = (await sentTo(801)).length;
  const r = await call('PUT', `/api/orders/${o.id}`, { token: maker, body: { title: 'اسم جديد' } });
  ok(r.status === 200 && r.data.AssignedTakers.length === 0, 'the maker can edit an open order; it stays open');
  await sleep(800);
  ok((await sentTo(801)).length === before, 'editing it does not offer it to everyone again');

  const bad = await call('PUT', `/api/orders/${o.id}`, { token: maker, body: { status: 'in-progress' } });
  ok(bad.status === 400 && /needs a taker/.test(bad.data?.error), 'it cannot be put "in progress" with nobody on it', `${bad.status}`);
  ok((await getOrder(o.id)).status === 'pending', 'and the refused request changed nothing');

  const editsBefore = (await editsIn(801)).length;
  const newsBefore = (await sentTo(801)).length;
  const assign = await call('PUT', `/api/orders/${o.id}`, { token: maker, body: { assignedTakerIds: [uid('taker1')] } });
  ok(assign.status === 200 && assign.data.AssignedTakers.map((t) => t.username).join() === 'taker1', 'the maker can still assign it to someone');
  const e = await newEdits(801, editsBefore);
  ok(e.some((x) => x.text.includes('لم يعد متاحاً')), 'the open-order messages then say it is no longer available');
  const n = await newSent(801, newsBefore);
  ok(n.length === 1 && n[0].text.includes('طلب جديد'), 'and the taker it went to gets "new order"', n.map((x) => x.text.split('\n')[0]).join(' / '));
  ok(!(await openList()).orders.some((x) => x.id === o.id), 'it leaves the open list');
}
{
  const a = await create({ assignedTakerIds: [uid('taker3')] });
  const id = a.data.id;
  let r = await call('PUT', `/api/orders/${id}`, { token: maker, body: { assignedTakerIds: [] } });
  ok(r.status === 400 && /at least one taker/.test(r.data?.error), 'removing every taker without choosing "open" is refused', `${r.status}`);

  const before = (await sentTo(802)).length;
  r = await call('PUT', `/api/orders/${id}`, { token: maker, body: { openToAll: true } });
  ok(r.status === 200 && r.data.AssignedTakers.length === 0 && r.data.status === 'pending', 'the maker can open an assigned order up to anyone');
  const m = await newSent(802, before);
  ok(m.length === 1 && m[0].text.includes('طلب مفتوح'), 'which offers it to every linked taker');
  ok((await openList()).orders.some((x) => x.id === id), 'and puts it in the open list');
}
{
  const o = await createOpen('إرجاع للمفتوح');
  await call('POST', `/api/orders/${o.id}/claim`, { token: T.taker3 });
  await call('PATCH', `/api/orders/${o.id}/items/status`, { token: T.taker3, body: { name: 'طحينة', status: 'collected' } });
  await call('PUT', `/api/orders/${o.id}`, { token: T.taker3, body: { status: 'in-progress' } });
  const r = await call('PUT', `/api/orders/${o.id}`, { token: maker, body: { openToAll: true } });
  ok(r.status === 200 && r.data.status === 'pending' && r.data.AssignedTakers.length === 0,
    'an order in progress can be released back to anyone - it starts over as pending', `${r.status} ${r.data?.status}`);
  ok(r.data.Items.find((i) => i.name === 'طحينة')?.status === 'collected', 'items already ticked keep their ticks');
  ok((await call('PATCH', `/api/orders/${o.id}/items/status`, { token: T.taker3, body: { name: 'سكر', status: 'collected' } })).status === 403,
    'the taker it was taken from can no longer change it');
}
{
  const o = await createOpen('مجهّز يحاول');
  await call('POST', `/api/orders/${o.id}/claim`, { token: T.taker4 });
  let r = await call('PUT', `/api/orders/${o.id}`, { token: T.taker4, body: { assignedTakerIds: [uid('taker2')] } });
  ok(r.status === 403, 'a taker cannot hand their order to another taker (403)', `${r.status}`);
  r = await call('PUT', `/api/orders/${o.id}`, { token: T.taker4, body: { openToAll: true } });
  ok(r.status === 403, 'or drop it back into the open list (403)', `${r.status}`);
  r = await call('PUT', `/api/orders/${o.id}`, { token: T.taker4, body: { assignedTakerIds: [uid('taker4')], status: 'in-progress' } });
  ok(r.status === 200, 'sending their own assignment back unchanged is fine', `${r.status}`);
}

// ---- archived orders ---------------------------------------------------------------
console.log('\nSending an archived order out open');
{
  const a = await create({ status: 'archived', accounterId: null, title: 'مؤرشف' });
  let r = await call('PUT', `/api/orders/${a.data.id}`, { token: maker, body: { status: 'pending', assignedTakerIds: [], accounterId: acc } });
  ok(r.status === 400, 'with neither takers nor "open" it is refused', `${r.status}`);
  const before = (await sentTo(801)).length;
  r = await call('PUT', `/api/orders/${a.data.id}`, { token: maker, body: { status: 'pending', assignedTakerIds: [], openToAll: true, accounterId: acc } });
  ok(r.status === 200 && r.data.status === 'pending' && r.data.AssignedTakers.length === 0, 'sent out open: pending, nobody assigned');
  const m = await newSent(801, before);
  ok(m.length === 1 && m[0].text.includes('طلب مفتوح'), 'and offered to every linked taker, once');
}

// ---- deleting --------------------------------------------------------------------
console.log('\nDeleting');
{
  const o = await createOpen('سيُحذف');
  await waitFor(async () => (await sentTo(802)).some((m) => m.text.includes(`#${o.id}`)));
  const before = (await editsIn(802)).length;
  const r = await call('DELETE', `/api/orders/${o.id}`, { token: maker });
  ok(r.status === 200, 'the maker deletes an open order');
  const e = await newEdits(802, before);
  ok(e.some((x) => x.text.includes('لم يعد متاحاً')), 'its open-order messages say it is no longer available');

  const assigned = await create({ assignedTakerIds: [uid('taker1'), uid('taker2')] });
  await call('PATCH', `/api/orders/${assigned.data.id}/items/status`, { token: T.taker1, body: { name: 'سكر', status: 'collected' } });
  const d = await call('DELETE', `/api/orders/${assigned.data.id}`, { token: maker });
  ok(d.status === 200 && !(await getOrder(assigned.data.id)), 'an assigned order with history can be deleted too', `${d.status} ${JSON.stringify(d.data)}`);
}

// ---- what reaches takers on an edit --------------------------------------------------
console.log('\nWhat a maker\'s edit sends to takers');
{
  const a = await create({ assignedTakerIds: [uid('taker1')], title: 'رسائل التعديل' });
  const id = a.data.id;
  await waitFor(async () => (await sentTo(801)).some((m) => m.text.includes(`#${id}`)));
  const asSent = items.map(({ name, quantity, price }) => ({ name, quantity, price }));

  let before = (await sentTo(801)).length;
  await call('PUT', `/api/orders/${id}`, { token: maker, body: { title: 'رسائل التعديل', items: asSent } });
  await sleep(1000);
  ok((await sentTo(801)).length === before, 'saving without changing anything sends nothing');

  await call('PUT', `/api/orders/${id}`, { token: maker, body: { items: asSent.map((i) => ({ ...i, price: Number(i.price) + 1 })) } });
  await sleep(1000);
  ok((await sentTo(801)).length === before, 'changing only prices (which takers never see) sends nothing');

  await call('PUT', `/api/orders/${id}`, { token: maker, body: { items: asSent.map((i) => (i.name === 'سكر' ? { ...i, quantity: 3 } : i)) } });
  let m = await newSent(801, before);
  ok(m.length === 1 && m[0].text.includes('تعديل على الطلب'), 'changing a quantity sends one "order updated"');

  before = (await sentTo(801)).length;
  const before2 = (await sentTo(802)).length;
  await call('PUT', `/api/orders/${id}`, { token: maker, body: { assignedTakerIds: [uid('taker1'), uid('taker2')] } });
  const m2 = await newSent(802, before2);
  ok(m2.length === 1 && m2[0].text.includes('طلب جديد'), 'adding a taker sends THEM "new order"');
  await sleep(300);
  ok((await sentTo(801)).length === before, 'and nothing to the taker who was already on it');

  before = (await sentTo(801)).length;
  await call('PUT', `/api/orders/${id}`, { token: admin, body: { city: 'جنين' } });
  m = await newSent(801, before);
  ok(m.length === 1 && m[0].text.includes('تعديل على الطلب'), 'an admin\'s edit reaches the takers the same way');
}

// ---- long customer names ---------------------------------------------------------------
console.log('\nLong customer names');
{
  const long = 'م'.repeat(255);
  const r = await create({ title: long, assignedTakerIds: [uid('taker3')] });
  ok(r.status === 201, 'a 255-character customer name does not break creating an order', `${r.status} ${JSON.stringify(r.data)?.slice(0, 120)}`);
  const o = await createOpen(long);
  const c = await call('POST', `/api/orders/${o.id}/claim`, { token: T.taker3 });
  ok(c.status === 200, 'nor taking an open order with one', `${c.status}`);
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
