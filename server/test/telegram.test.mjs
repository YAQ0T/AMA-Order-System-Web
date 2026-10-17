// Telegram notifications, against the REAL server + MySQL and a FAKE Telegram
// API (fake-telegram.js). Run through `npm run test:integration`, which starts
// both and passes their addresses in. Expects an empty database.
const BASE = process.argv[2];
const TG = process.argv[3];
if (!BASE || !TG) {
  console.error('usage: node telegram.test.mjs <server-url> <fake-telegram-url>');
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

const tgPost = (path, body) =>
  fetch(TG + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const tg = {
  // A Telegram user sends the bot a message.
  say: (chatId, text, extra = {}) => tgPost('/_test/update', { chatId, text, ...extra }),
  sent: async () => (await (await fetch(TG + '/_test/sent')).json()).result,
  block: (chatId) => tgPost('/_test/block', { chatId }),
  rejectButtons: (on) => tgPost('/_test/reject-buttons', { on }),
};
const toChat = async (chatId) => (await tg.sent()).filter((m) => m.chatId === String(chatId));

async function waitFor(fn, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  return null;
}
// Resolve with the messages that reached `chatId` after `before` of them existed.
const newMessages = async (chatId, before, { wait = 6000, settle = 400 } = {}) => {
  await waitFor(async () => (await toChat(chatId)).length > before, wait);
  await sleep(settle); // let any duplicate arrive, so "exactly one" is meaningful
  return (await toChat(chatId)).slice(before);
};

console.log(`\nTelegram notifications - real server ${BASE}, fake Telegram ${TG}\n`);

// ---- setup -----------------------------------------------------------------
const admin = await login('admin', 'admin123');
for (const [u, role] of [['maker1', 'maker'], ['taker1', 'taker'], ['taker2', 'taker'], ['acc1', 'accounter']]) {
  await call('POST', '/api/auth/register', { body: { username: u, password: 'pass1234', role } });
}
for (const u of (await call('GET', '/api/admin/users/pending', { token: admin })).data || []) {
  await call('PUT', `/api/admin/users/${u.id}/approve`, { token: admin, body: {} });
}
const [maker, taker1, taker2] = await Promise.all(['maker1', 'taker1', 'taker2'].map((u) => login(u)));
const takers = (await call('GET', '/api/auth/takers', { token: maker })).data;
const tid = (u) => takers.find((t) => t.username === u).id;
const acc = (await call('GET', '/api/auth/accounters', { token: maker })).data[0].id;

const createOrder = async (title, items, assigned = ['taker1', 'taker2'], extra = {}) => {
  const r = await call('POST', '/api/orders', {
    token: maker,
    body: { title, city: 'جنين', items, assignedTakerIds: assigned.map(tid), accounterId: acc, ...extra },
  });
  if (r.status >= 300) throw new Error(`create: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.id;
};
const status = async (token) => (await call('GET', '/api/telegram/status', { token })).data;

// ---- linking ---------------------------------------------------------------
console.log('Linking');
let code;
{
  const s = await status(taker1);
  ok(s.enabled === true && s.linked === false, 'feature on, taker not linked yet');
  ok(s.botUsername === 'ama_test_bot', 'bot username learned from getMe', s.botUsername);

  const r = await call('POST', '/api/telegram/link', { token: taker1 });
  const m = /^https:\/\/t\.me\/ama_test_bot\?start=([A-Za-z0-9_-]{24})$/.exec(r.data?.url || '');
  ok(r.status === 200 && m, 'link endpoint returns a t.me link with a 24-char code', r.data?.url);
  code = m?.[1];
  ok(r.data?.appUrl === `tg://resolve?domain=ama_test_bot&start=${code}`, 'and a tg:// link that opens the app directly');

  let before = (await toChat(7001)).length;
  await tg.say(7001, '/start not-a-real-code');
  const bad = await newMessages(7001, before);
  ok(bad.some((x) => x.text.includes('غير صالح')), 'unknown code -> bot says the link is invalid');

  before = (await toChat(7002)).length;
  await tg.say(7002, 'مرحبا');
  const help = await newMessages(7002, before);
  ok(help.some((x) => x.text.includes('ربط تيليغرام')), 'a random message gets instructions');

  await tg.say(-100123, `/start ${code}`, { chatType: 'group' });
  await sleep(1200);
  ok((await toChat(-100123)).length === 0 && !(await status(taker1)).linked, 'the code is ignored in a group chat');

  before = (await toChat(555)).length;
  await tg.say(555, `/start ${code}`, { username: 'taker_one' });
  const linked = await waitFor(async () => (await status(taker1)).linked);
  ok(Boolean(linked), 'tapping Start with the code links the account');
  ok((await status(taker1)).telegramUsername === 'taker_one', 'Telegram username recorded');
  const confirm = await newMessages(555, before);
  ok(confirm.some((x) => x.text.includes('تم ربط') && x.text.includes('taker1')), 'bot confirms in Arabic, naming the account');

  before = (await toChat(999)).length;
  await tg.say(999, `/start ${code}`);
  const reused = await newMessages(999, before);
  ok(reused.some((x) => x.text.includes('غير صالح')), 'the same code cannot be used twice');
}

// ---- new order -------------------------------------------------------------
console.log('\nNew order');
let orderId;
{
  const before = (await toChat(555)).length;
  orderId = await createOrder('زبون <b>تجريبي</b> & شركاه', [
    { name: 'طحينة', quantity: 2.5, price: 12.75 },
    { name: 'زيت زيتون', quantity: 1, price: 99.25 },
  ]);
  const msgs = await newMessages(555, before);
  const text = msgs[0]?.text || '';
  ok(msgs.length === 1, 'linked taker gets exactly one message', `${msgs.length}`);
  ok(text.includes('طلب جديد') && text.includes(`#${orderId}`), 'it says "new order" with the order number');
  ok(text.includes('جنين') && text.includes('طحينة') && text.includes('زيت زيتون') && text.includes('2.5'),
    'with the city, item names and quantities');
  ok(!text.includes('12.75') && !text.includes('99.25'), 'and NO prices');
  ok(text.includes('&lt;b&gt;تجريبي&lt;/b&gt;') && text.includes('&amp; شركاه'), 'typed-in HTML is escaped, cannot break formatting');
  ok(msgs[0]?.parseMode === 'HTML', 'sent as HTML');
  ok(msgs[0]?.button?.url === 'http://192.168.1.10:6001/taker', 'carries an "open the system" button from APP_URL', JSON.stringify(msgs[0]?.button));

  const all = (await tg.sent()).filter((x) => x.text.includes(`#${orderId}`));
  ok(all.every((x) => x.chatId === '555'), 'only the linked taker is messaged on Telegram');
}

{
  await tg.rejectButtons(true);
  const before = (await toChat(555)).length;
  await createOrder('بدون زر', [{ name: 'شاي', quantity: 1, price: 1 }], ['taker1']);
  const msgs = await newMessages(555, before);
  ok(msgs.length === 1 && msgs[0].button === null, 'if Telegram rejects the button, the message still goes out without it');
  await tg.rejectButtons(false);
}

{
  const before = (await toChat(555)).length;
  const items = Array.from({ length: 17 }, (_, i) => ({ name: `صنف ${i + 1}`, quantity: 1, price: 1 }));
  await createOrder('طلب طويل', items, ['taker1']);
  const msgs = await newMessages(555, before);
  ok(msgs[0]?.text.includes('و2 أصناف أخرى'), 'a 17-item order lists 15 and says "and 2 more"');
}

// ---- edits and send-outs ---------------------------------------------------
console.log('\nEdits');
{
  const before = (await toChat(555)).length;
  await call('PUT', `/api/orders/${orderId}`, { token: maker, body: { title: 'زبون معدّل' } });
  const msgs = await newMessages(555, before);
  ok(msgs.length === 1 && msgs[0].text.includes('تعديل على الطلب') && msgs[0].text.includes('زبون معدّل'),
    "maker's edit -> one \"order updated\" message");
}
{
  const a = await call('POST', '/api/orders', {
    token: maker,
    body: { title: 'مسودة', city: 'الخليل', status: 'archived', items: [{ name: 'ماء', quantity: 1, price: 1 }] },
  });
  await sleep(800);
  const before = (await toChat(555)).length;
  await call('PUT', `/api/orders/${a.data.id}`, {
    token: maker,
    body: { status: 'pending', assignedTakerIds: [tid('taker1')], accounterId: acc },
  });
  const msgs = await newMessages(555, before);
  ok(msgs.length === 1 && msgs[0].text.includes('طلب جديد') && !msgs[0].text.includes('تعديل'),
    'sending out an archived order -> one "new order" message, not also "updated"');
}
{
  const before = (await toChat(555)).length;
  await call('PUT', `/api/orders/${orderId}`, { token: taker1, body: { status: 'in-progress' } });
  await call('PATCH', `/api/orders/${orderId}/items/status`, { token: taker1, body: { name: 'طحينة', status: 'collected' } });
  await sleep(1500);
  ok((await toChat(555)).length === before, "the taker's own actions do not message them");
}

// ---- accountant ------------------------------------------------------------
console.log('\nAccountant');
{
  const accTok = await login('acc1');
  ok((await status(accTok)).canLink === true, 'accountants may link');

  const r = await call('POST', '/api/telegram/link', { token: accTok });
  let before = (await toChat(888)).length;
  await tg.say(888, `/start ${new URL(r.data.url).searchParams.get('start')}`, { username: 'the_accountant' });
  await waitFor(async () => (await status(accTok)).linked);
  const welcome = await newMessages(888, before);
  ok(welcome.some((x) => x.text.includes('ERP')), 'the welcome message tells the accountant what will arrive (ERP-ready orders)');

  const oid = await createOrder('مخبز الأمل', [
    { name: 'طحين', quantity: 5, price: 33.33 },
    { name: 'خميرة', quantity: 2, price: 7.77 },
  ], ['taker1']);
  await call('PATCH', `/api/orders/${oid}/items/status`, { token: taker1, body: { name: 'خميرة', status: 'unavailable' } });

  before = (await toChat(888)).length;
  await call('PUT', `/api/orders/${oid}`, { token: taker1, body: { status: 'in-progress' } });
  await sleep(1200);
  ok((await toChat(888)).length === before, 'starting an order does not message the accountant');

  const takerBefore = (await toChat(555)).length;
  await call('PUT', `/api/orders/${oid}`, { token: taker1, body: { status: 'completed' } });
  const msgs = await newMessages(888, before);
  const text = msgs[0]?.text || '';
  ok(msgs.length === 1, 'completing it sends the accountant exactly one message', `${msgs.length}`);
  ok(text.includes('جاهز للإدخال على ERP') && text.includes(`#${oid}`) && text.includes('مخبز الأمل'),
    'it says the order is ready for ERP, with number and customer');
  ok(text.includes('<s>خميرة') && text.includes('❌ غير متوفر') && text.includes('1⁩ غير متوفر'),
    'the unavailable item is struck through and counted, so it is not billed');
  ok(!text.includes('33.33') && !text.includes('7.77'), 'no prices in the message');
  ok(msgs[0]?.button?.url === 'http://192.168.1.10:6001/accounter', "its button opens the accountant's page", JSON.stringify(msgs[0]?.button));
  ok((await toChat(555)).length === takerBefore, 'the taker who completed it is not messaged');

  const afterReady = (await toChat(888)).length;
  await call('PUT', `/api/orders/${oid}`, { token: accTok, body: { status: 'entered_erp' } });
  await sleep(1200);
  ok((await toChat(888)).length === afterReady, "entering it into ERP sends nothing (that was the accountant's own action)");

  // Unlinked accountant: completion only shows in the app.
  await call('DELETE', '/api/telegram/link', { token: accTok });
  await sleep(500);
  const quiet = (await toChat(888)).length;
  const o2 = await createOrder('بعد فك ربط المحاسب', [{ name: 'ملح', quantity: 1, price: 1 }], ['taker1']);
  await call('PUT', `/api/orders/${o2}`, { token: taker1, body: { status: 'in-progress' } });
  await call('PUT', `/api/orders/${o2}`, { token: taker1, body: { status: 'completed' } });
  await sleep(1500);
  ok((await toChat(888)).length === quiet, 'an unlinked accountant gets nothing on Telegram');
}

console.log('\nWho may link');
{
  ok((await status(maker)).canLink === false, 'makers are told they cannot link (the app hides the card)');
  const m = await call('POST', '/api/telegram/link', { token: maker });
  ok(m.status === 403, 'a maker asking for a link gets 403', `got ${m.status}`);
  const a = await call('POST', '/api/telegram/link', { token: admin });
  ok(a.status === 403, 'so does an admin', `got ${a.status}`);
}

// ---- unlinking -------------------------------------------------------------
console.log('\nUnlinking');
{
  const before = (await toChat(555)).length;
  const r = await call('DELETE', '/api/telegram/link', { token: taker1 });
  ok(r.status === 200 && !(await status(taker1)).linked, 'unlink from the app');
  const bye = await newMessages(555, before);
  ok(bye.some((x) => x.text.includes('فك ربط')), 'bot tells the chat it was unlinked');

  const mid = (await toChat(555)).length;
  await createOrder('بعد فك الربط', [{ name: 'سكر', quantity: 1, price: 1 }], ['taker1']);
  await sleep(1500);
  ok((await toChat(555)).length === mid, 'no more Telegram messages after unlinking');
}
{
  const r = await call('POST', '/api/telegram/link', { token: taker1 });
  const newCode = new URL(r.data.url).searchParams.get('start');
  await tg.say(556, `/start ${newCode}`);
  await waitFor(async () => (await status(taker1)).linked);
  await tg.block(556);
  await createOrder('بوت محظور', [{ name: 'أرز', quantity: 1, price: 1 }], ['taker1']);
  const unlinked = await waitFor(async () => !(await status(taker1)).linked);
  ok(Boolean(unlinked), 'if the taker blocks the bot, they are unlinked automatically (and prompted to link again)');
}
{
  // A user with no orders can be deleted even with Telegram linked (the link
  // row must not block it). One who has worked on orders is deactivated
  // instead - deleting would erase their history.
  await call('POST', '/api/auth/register', { body: { username: 'taker_new', password: 'pass1234', role: 'taker' } });
  const pending = (await call('GET', '/api/admin/users/pending', { token: admin })).data || [];
  const fresh = pending.find((u) => u.username === 'taker_new');
  await call('PUT', `/api/admin/users/${fresh.id}/approve`, { token: admin, body: {} });
  const freshToken = await login('taker_new');
  const r = await call('POST', '/api/telegram/link', { token: freshToken });
  await tg.say(778, `/start ${new URL(r.data.url).searchParams.get('start')}`);
  await waitFor(async () => (await status(freshToken)).linked);
  const del = await call('DELETE', `/api/admin/users/${fresh.id}`, { token: admin });
  ok(del.status === 200, 'admin can delete a user (with no orders) who has Telegram linked', `got ${del.status} ${JSON.stringify(del.data)}`);

  const r2 = await call('POST', '/api/telegram/link', { token: taker2 });
  await tg.say(777, `/start ${new URL(r2.data.url).searchParams.get('start')}`);
  await waitFor(async () => (await status(taker2)).linked);
  const refused = await call('DELETE', `/api/admin/users/${tid('taker2')}`, { token: admin });
  ok(refused.status === 409, 'a linked taker who has worked on orders cannot be deleted (409)', `got ${refused.status}`);
  const off = await call('PUT', `/api/admin/users/${tid('taker2')}/deactivate`, { token: admin, body: {} });
  ok(off.status === 200, 'but can be deactivated', `got ${off.status}`);
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
