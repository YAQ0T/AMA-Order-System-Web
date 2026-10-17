/**
 * Telegram notifications for takers and accountants.
 *
 * Why Telegram rather than browser push: web push proved unreliable on exactly
 * the phones that matter here - Samsung puts the browser to sleep to save
 * battery, and iPhone only allows it from a home-screen web app. Telegram is a
 * native app, so its notifications travel the same reliable path as any chat.
 *
 * Uses LONG POLLING (the server asks Telegram for new messages) rather than a
 * webhook (Telegram calls the server). That is what lets this work with no
 * HTTPS, no domain and no port forwarding: every connection is outbound.
 *
 * Delivery: Telegram is the ONLY channel that reaches a phone - the system
 * sends no email. A taker who has not linked Telegram, or whose send fails,
 * still gets the in-app notification (the bell) that every assignment creates,
 * but nothing on their phone. That is why the app nags unlinked takers.
 *
 * Config: TELEGRAM_BOT_TOKEN in server/.env. Unset = feature off.
 *         APP_URL (optional) adds an "open the system" button to messages.
 *         TELEGRAM_API_BASE (optional) points at a fake API in tests.
 */
const crypto = require('crypto');
const { Op } = require('sequelize');

const LINK_CODE_TTL_MS = 15 * 60 * 1000;
const MAX_ITEMS_IN_MESSAGE = 15;
const POLL_TIMEOUT_S = 25;

let botUsername = null;
let polling = false;
let pollAbort = null;
let warnedConflict = false;

const token = () => process.env.TELEGRAM_BOT_TOKEN || '';
const apiBase = () => (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
const enabled = () => Boolean(token());
const getBotUsername = () => botUsername;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lazy require: db.js is loaded by index.js before this module is used, and
// requiring it at the top would make this file awkward to load on its own.
const models = () => require('../db');

/**
 * Call a Bot API method. Errors carry Telegram's error_code so callers can
 * tell "user blocked the bot" (403) from "network down". The token is part of
 * the URL, so it is never included in any error or log message.
 */
async function api(method, params = {}, { timeoutMs = 15_000, signal } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
        let res;
        try {
            res = await fetch(`${apiBase()}/bot${token()}/${method}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
                signal: controller.signal,
            });
        } catch (cause) {
            const err = new Error(controller.signal.aborted ? `${method} timed out` : `cannot reach Telegram (${cause.cause?.code || cause.name})`);
            err.code = 'NETWORK';
            throw err;
        }
        const data = await res.json().catch(() => ({}));
        if (!data.ok) {
            const err = new Error(data.description || `${method} failed (HTTP ${res.status})`);
            err.code = data.error_code || res.status;
            err.retryAfter = data.parameters?.retry_after;
            throw err;
        }
        return data.result;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}

async function ensureBotUsername() {
    if (botUsername) return botUsername;
    const me = await api('getMe');
    botUsername = me.username;
    return botUsername;
}

// ---------------------------------------------------------------------------
// Messages (Arabic). User-supplied text is HTML-escaped because messages are
// sent with parse_mode HTML.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Order numbers sit inside right-to-left text, where bidi reordering can turn
// "#123" into "123#". Unicode isolates keep them intact, the same job the
// web app's <Ltr> wrapper does.
const ltr = (s) => `⁦${s}⁩`;

const formatQty = (n) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return String(n);
    return x % 1 === 0 ? String(Math.trunc(x)) : String(x);
};

function orderDetails(order, actor) {
    const items = order.Items || [];
    // Item names and quantities only - takers never see prices.
    const lines = items.slice(0, MAX_ITEMS_IN_MESSAGE).map((i) => `• ${esc(i.name)} × ${ltr(formatQty(i.quantity))}`);
    if (items.length > MAX_ITEMS_IN_MESSAGE) {
        lines.push(`… و${items.length - MAX_ITEMS_IN_MESSAGE} أصناف أخرى`);
    }

    return [
        `👤 الزبون: <b>${esc(order.title || '—')}</b>`,
        `📍 المدينة: ${esc(order.city || '—')}`,
        actor ? `✍️ من: ${esc(actor.username)}` : null,
        order.description ? `📝 ${esc(order.description)}` : null,
        '',
        `📦 الأصناف (${ltr(items.length)}):`,
        ...lines,
    ].filter((l) => l !== null);
}

function orderAssignedMessage(order, maker) {
    return [`🆕 <b>طلب جديد ${ltr(`#${order.id}`)}</b>`, '', ...orderDetails(order, maker)].join('\n');
}

function orderUpdatedMessage(order, editor) {
    return [`✏️ <b>تعديل على الطلب ${ltr(`#${order.id}`)}</b>`, '', ...orderDetails(order, editor)].join('\n');
}

/** An order left open to any taker: the first to take it in the app gets it. */
function openOrderMessage(order, maker) {
    return [
        `🔓 <b>طلب مفتوح ${ltr(`#${order.id}`)}</b>`,
        'أول مجهّز يأخذه من النظام يصبح له.',
        '',
        ...orderDetails(order, maker),
    ].join('\n');
}

/**
 * What an open-order message is edited into once the order is no longer open,
 * so takers do not go looking for an order someone else already has.
 * `takenBy` is null when it closed for another reason (the maker assigned it
 * to someone, archived it or deleted it).
 */
function openOrderClosedMessage(orderId, details, { takenBy, isRecipient }) {
    let header;
    if (takenBy && isRecipient) header = `✅ <b>أخذتَ الطلب ${ltr(`#${orderId}`)}</b> — تجده في «طلباتي».`;
    else if (takenBy) header = `🔒 <b>تم أخذ الطلب ${ltr(`#${orderId}`)}</b> — أخذه ${esc(takenBy)}`;
    else header = `🚫 <b>الطلب ${ltr(`#${orderId}`)} لم يعد متاحاً</b>`;
    return [header, '', ...details].join('\n');
}

/**
 * For the accountant: an order is completed and waiting to be entered into
 * ERP. What they need at a glance is which order, and which items did NOT go
 * out. Prices are left out on purpose: the app shows them, and a total in a
 * notification would have to decide whether unavailable items count - a
 * billing rule that belongs in the app, not in a chat message.
 */
function orderReadyForErpMessage(order) {
    const items = order.Items || [];
    const unavailable = items.filter((i) => i.status === 'unavailable');
    const takers = (order.AssignedTakers || []).map((t) => t.username).filter(Boolean);

    const lines = items.slice(0, MAX_ITEMS_IN_MESSAGE).map((i) => {
        const line = `${esc(i.name)} × ${ltr(formatQty(i.quantity))}`;
        return i.status === 'unavailable' ? `• <s>${line}</s> ❌ غير متوفر` : `• ${line}`;
    });
    if (items.length > MAX_ITEMS_IN_MESSAGE) {
        lines.push(`… و${items.length - MAX_ITEMS_IN_MESSAGE} أصناف أخرى`);
    }

    const count = `📦 الأصناف (${ltr(items.length)})`
        + (unavailable.length ? ` — ${ltr(unavailable.length)} غير متوفر` : '')
        + ':';

    return [
        `✅ <b>طلب جاهز للإدخال على ERP ${ltr(`#${order.id}`)}</b>`,
        '',
        `👤 الزبون: <b>${esc(order.title || '—')}</b>`,
        `📍 المدينة: ${esc(order.city || '—')}`,
        takers.length ? `🧺 ${takers.length > 1 ? 'المجهّزون' : 'المجهّز'}: ${esc(takers.join('، '))}` : null,
        '',
        count,
        ...lines,
    ].filter((l) => l !== null).join('\n');
}

const HELP_TEXT = [
    'مرحباً 👋',
    'لربط حسابك: افتح نظام الطلبات من حسابك واضغط «ربط تيليغرام».',
].join('\n');

const EXPIRED_TEXT = [
    '⚠️ رابط الربط غير صالح أو منتهي الصلاحية.',
    'ارجع لنظام الطلبات واضغط «ربط تيليغرام» مرة أخرى.',
].join('\n');

/** `path` is the page the button opens: /taker for takers, /accounter for accountants. */
function openButton(path = '/taker') {
    const url = (process.env.APP_URL || '').trim().replace(/\/$/, '');
    return url ? { text: 'فتح نظام الطلبات', url: `${url}${path}` } : null;
}

// Roles that receive Telegram messages. Makers deliberately do not: they work
// at a desk with the app open, and the bell is enough. Admins likewise.
const LINKABLE_ROLES = new Set(['taker', 'accounter']);
const canLink = (role) => LINKABLE_ROLES.has(role);

// ---------------------------------------------------------------------------
// Sending

async function sendMessage(chatId, html, { button } = {}) {
    const params = { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true };
    if (button) params.reply_markup = { inline_keyboard: [[{ text: button.text, url: button.url }]] };
    try {
        return await api('sendMessage', params);
    } catch (err) {
        // Telegram rejects URL buttons it does not like (a LAN address in
        // APP_URL, for instance). A message without the button beats no
        // message, so retry once without it.
        if (button && err.code === 400 && /button|url/i.test(err.message)) {
            delete params.reply_markup;
            return api('sendMessage', params);
        }
        throw err;
    }
}

/**
 * Send without throwing. Resolves to the sent message (truthy) when Telegram
 * accepted it, or false.
 * A chat that blocked the bot or no longer exists is unlinked, so the app shows
 * that taker the "link Telegram" prompt again instead of pretending they are
 * still reachable.
 */
async function safeSend(chatId, html, options = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            return (await sendMessage(chatId, html, options)) || true;
        } catch (err) {
            if (err.code === 429 && err.retryAfter && attempt === 0) {
                await sleep(Math.min(err.retryAfter, 30) * 1000);
                continue;
            }
            if (err.code === 403 || (err.code === 400 && /chat not found/i.test(err.message))) {
                try {
                    await models().TelegramLink.update(
                        { chatId: null, linkedAt: null },
                        { where: { chatId: String(chatId) } }
                    );
                } catch (dbErr) {
                    console.error('[telegram] could not unlink chat:', dbErr.message);
                }
                console.warn(`[telegram] chat ${chatId} can no longer be reached (${err.message}) - unlinked`);
                return false;
            }
            console.error(`[telegram] send to ${chatId} failed: ${err.message}`);
            return false;
        }
    }
    return false;
}

/**
 * Split users into those reachable on Telegram and everyone else.
 */
async function partitionByTelegram(users) {
    const list = users || [];
    if (!enabled() || list.length === 0) return { linked: [], unlinked: list };

    const links = await models().TelegramLink.findAll({
        where: { userId: list.map((u) => u.id), chatId: { [Op.ne]: null } },
        attributes: ['userId', 'chatId'],
    });
    const chatByUser = new Map(links.map((l) => [l.userId, l.chatId]));
    return {
        linked: list.filter((u) => chatByUser.has(u.id)).map((user) => ({ user, chatId: chatByUser.get(user.id) })),
        unlinked: list.filter((u) => !chatByUser.has(u.id)),
    };
}

/**
 * Message each user on Telegram if they have linked it. Resolves to the users
 * it could NOT reach (not linked, or the send failed); they only have the
 * in-app notification. `path` is where the message's button leads.
 */
async function deliverTo(users, buildText, { path = '/taker' } = {}) {
    const { linked, unlinked } = await partitionByTelegram(users);
    const failed = [];
    const button = openButton(path);
    await Promise.all(
        linked.map(async ({ user, chatId }) => {
            const ok = await safeSend(chatId, buildText(user), { button });
            if (!ok) failed.push(user);
        })
    );
    return [...unlinked, ...failed];
}

// ---------------------------------------------------------------------------
// Open orders

// The messages sent for each open order, so they can be edited to say "taken"
// once someone takes it. Kept in memory only: after a server restart, older
// open-order messages simply stay as they were - the app is the source of
// truth and refuses a second taker either way.
const openBroadcasts = new Map(); // orderId -> { details, messages: [{ userId, chatId, messageId }] }

/**
 * Tell every approved, linked taker that an order is open. Resolves to the
 * number of takers it reached.
 */
async function broadcastOpenOrder(order, maker) {
    if (!enabled()) return 0;
    const { User } = models();
    const takers = await User.findAll({
        where: { role: 'taker', isApproved: true },
        attributes: ['id', 'username'],
    });
    const { linked } = await partitionByTelegram(takers);
    if (linked.length === 0) return 0;

    const text = openOrderMessage(order, maker);
    const button = openButton('/taker/open');
    const messages = [];
    await Promise.all(
        linked.map(async ({ user, chatId }) => {
            const sent = await safeSend(chatId, text, { button });
            if (sent && sent.message_id) messages.push({ userId: user.id, chatId, messageId: sent.message_id });
        })
    );
    if (messages.length) {
        openBroadcasts.set(Number(order.id), { details: orderDetails(order, maker), messages });
    }
    return messages.length;
}

/**
 * The order is no longer open: edit the messages broadcastOpenOrder sent.
 * `takenBy` is the taker who took it ({ id, username }), or null.
 */
async function closeOpenOrder(orderId, takenBy = null) {
    const entry = openBroadcasts.get(Number(orderId));
    if (!entry) return;
    openBroadcasts.delete(Number(orderId));
    await Promise.all(
        entry.messages.map(({ userId, chatId, messageId }) =>
            // No reply_markup: the edit drops the "open the system" button.
            api('editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: openOrderClosedMessage(orderId, entry.details, {
                    takenBy: takenBy?.username || null,
                    isRecipient: Boolean(takenBy) && takenBy.id === userId,
                }),
                parse_mode: 'HTML',
                disable_web_page_preview: true,
            }).catch((err) => {
                // Deleted by the user, or too old to edit. Nothing to do.
                console.warn(`[telegram] could not update open-order message in ${chatId}: ${err.message}`);
            })
        )
    );
}

// ---------------------------------------------------------------------------
// Linking

/**
 * Issue a single-use code and the t.me link that carries it. Opening the link
 * and tapping Start sends "/start <code>" to the bot, which completes the link.
 */
async function createLinkCode(userId) {
    const username = await ensureBotUsername();
    // 18 random bytes -> 24 base64url chars; Telegram allows [A-Za-z0-9_-]
    // up to 64 characters in a start parameter.
    const code = crypto.randomBytes(18).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);

    const { TelegramLink } = models();
    const [link] = await TelegramLink.findOrCreate({ where: { userId }, defaults: { userId } });
    await link.update({ linkCode: code, linkCodeExpiresAt: expiresAt });

    return {
        // tg:// opens the Telegram app directly on iPhone and Android, with no
        // browser hop; the https link is the fallback if it does not open.
        appUrl: `tg://resolve?domain=${username}&start=${code}`,
        url: `https://t.me/${username}?start=${code}`,
        expiresAt,
    };
}

async function handleUpdate(update) {
    const msg = update.message;
    // Private chats only: if someone adds the bot to a group, ignore it.
    if (!msg || !msg.chat || msg.chat.type !== 'private') return;

    const chatId = String(msg.chat.id);
    const match = (msg.text || '').trim().match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{1,64}))?$/);

    if (!match || !match[1]) {
        await safeSend(chatId, HELP_TEXT);
        return;
    }

    const { TelegramLink, User } = models();
    const link = await TelegramLink.findOne({ where: { linkCode: match[1] } });
    if (!link || !link.linkCodeExpiresAt || link.linkCodeExpiresAt < new Date()) {
        await safeSend(chatId, EXPIRED_TEXT);
        return;
    }

    await link.update({
        chatId,
        telegramUsername: msg.from?.username || null,
        linkedAt: new Date(),
        linkCode: null, // single use
        linkCodeExpiresAt: null,
    });

    const user = await User.findByPk(link.userId, { attributes: ['username', 'role'] });
    const whatComesHere = user?.role === 'accounter'
        ? 'ستصلك هنا الطلبات المكتملة الجاهزة للإدخال على ERP.'
        : 'ستصلك هنا الطلبات الجديدة وأي تعديل عليها.';
    await safeSend(chatId, [
        `✅ تم ربط حسابك <b>${esc(user?.username || '')}</b> بنجاح.`,
        whatComesHere,
    ].join('\n'));
}

async function notifyUnlinked(chatId) {
    await safeSend(chatId, 'تم فك ربط حسابك من نظام الطلبات. لن تصلك إشعارات هنا بعد الآن.');
}

// ---------------------------------------------------------------------------
// Polling

async function pollLoop() {
    let offset = 0;
    let backoff = 0;

    while (polling) {
        try {
            await ensureBotUsername();
            const updates = await api(
                'getUpdates',
                { offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message'] },
                { timeoutMs: (POLL_TIMEOUT_S + 10) * 1000, signal: pollAbort.signal }
            );
            backoff = 0;
            warnedConflict = false;

            for (const update of updates) {
                offset = update.update_id + 1;
                try {
                    await handleUpdate(update);
                } catch (err) {
                    console.error('[telegram] failed to handle an update:', err.message);
                }
            }
        } catch (err) {
            if (!polling) break;

            if (err.code === 401 || err.code === 404) {
                console.error('[telegram] Telegram rejected the bot token - check TELEGRAM_BOT_TOKEN in server/.env. Telegram notifications are OFF until the server restarts.');
                polling = false;
                break;
            }
            if (err.code === 409 && !warnedConflict) {
                warnedConflict = true;
                console.warn('[telegram] Another program is already receiving updates for this bot (a second server, or a webhook). Only one may run at a time.');
            }

            backoff = Math.min(backoff ? backoff * 2 : 2_000, 60_000);
            await sleep(backoff);
        }
    }
}

async function start() {
    if (!enabled()) {
        console.log('[telegram] TELEGRAM_BOT_TOKEN not set - Telegram notifications are disabled.');
        return;
    }
    if (polling) return;

    try {
        await ensureBotUsername();
        // Polling and webhooks are mutually exclusive on Telegram's side.
        await api('deleteWebhook', { drop_pending_updates: false });
        console.log(`[telegram] bot @${botUsername} is ready`);
    } catch (err) {
        console.error(`[telegram] cannot reach the bot yet (${err.message}) - will keep retrying`);
    }

    polling = true;
    pollAbort = new AbortController();
    pollLoop();
}

function stop() {
    polling = false;
    pollAbort?.abort();
}

module.exports = {
    enabled,
    canLink,
    start,
    stop,
    getBotUsername,
    createLinkCode,
    deliverTo,
    partitionByTelegram,
    notifyUnlinked,
    broadcastOpenOrder,
    closeOpenOrder,
    orderAssignedMessage,
    orderUpdatedMessage,
    orderReadyForErpMessage,
};
