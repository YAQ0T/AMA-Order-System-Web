/**
 * A fake Telegram Bot API for integration tests.
 *
 * The server under test is started with TELEGRAM_API_BASE pointing here, so it
 * talks to this instead of api.telegram.org. Implements just what the server
 * uses - getMe, deleteWebhook, getUpdates (long polling), sendMessage and
 * editMessageText - plus control endpoints the test uses to act as a Telegram
 * user and to see what the bot sent:
 *
 *   POST /_test/update        { chatId, text, username?, chatType? }  user sends a message
 *   GET  /_test/sent          every message the bot has sent (as first sent)
 *   GET  /_test/edits         every edit the bot made to a message it sent
 *   POST /_test/block         { chatId }   sends to this chat fail with 403
 *   POST /_test/reject-buttons { on }      reject URL buttons with 400
 */
const http = require('http');

const BOT = { id: 900001, is_bot: true, first_name: 'AMA Test', username: 'ama_test_bot' };

function startFakeTelegram() {
    const updates = [];
    const sent = [];
    const edits = [];
    const blocked = new Set();
    const waiters = [];
    let nextUpdateId = 1;
    let nextMessageId = 1;
    let rejectButtons = false;

    const reply = (res, status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
    };
    const ok = (res, result) => reply(res, 200, { ok: true, result });
    const fail = (res, code, description) => reply(res, code, { ok: false, error_code: code, description });

    const pendingFrom = (offset) => updates.filter((u) => u.update_id >= offset);

    const flushWaiters = () => {
        for (let i = waiters.length - 1; i >= 0; i--) {
            const w = waiters[i];
            const ready = pendingFrom(w.offset);
            if (ready.length) {
                clearTimeout(w.timer);
                waiters.splice(i, 1);
                ok(w.res, ready);
            }
        }
    };

    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
            let body = {};
            try { body = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
            const url = new URL(req.url, 'http://x');

            // ---- control endpoints ----
            if (url.pathname === '/_test/update') {
                const chatId = Number(body.chatId);
                updates.push({
                    update_id: nextUpdateId++,
                    message: {
                        message_id: nextMessageId++,
                        date: Math.floor(Date.now() / 1000),
                        chat: { id: chatId, type: body.chatType || 'private' },
                        from: { id: chatId, is_bot: false, first_name: 'Tester', username: body.username },
                        text: body.text,
                    },
                });
                flushWaiters();
                return ok(res, true);
            }
            if (url.pathname === '/_test/sent') return ok(res, sent);
            if (url.pathname === '/_test/edits') return ok(res, edits);
            if (url.pathname === '/_test/block') { blocked.add(String(body.chatId)); return ok(res, true); }
            if (url.pathname === '/_test/reject-buttons') { rejectButtons = Boolean(body.on); return ok(res, true); }

            // ---- Bot API: /bot<token>/<method> ----
            const m = url.pathname.match(/^\/bot([^/]+)\/(\w+)$/);
            if (!m) return fail(res, 404, 'Not Found');
            const [, token, method] = m;
            if (token !== 'test-token') return fail(res, 401, 'Unauthorized');

            switch (method) {
                case 'getMe':
                    return ok(res, BOT);
                case 'deleteWebhook':
                    return ok(res, true);
                case 'getUpdates': {
                    const offset = Number(body.offset) || 0;
                    // Telegram confirms (drops) updates below the offset.
                    while (updates.length && updates[0].update_id < offset) updates.shift();
                    const ready = pendingFrom(offset);
                    if (ready.length) return ok(res, ready);
                    // Long poll: hold the request until an update arrives.
                    const waitMs = Math.min(Number(body.timeout) || 0, 25) * 1000;
                    const waiter = { offset, res, timer: setTimeout(() => {
                        const i = waiters.indexOf(waiter);
                        if (i >= 0) waiters.splice(i, 1);
                        ok(res, []);
                    }, waitMs) };
                    waiters.push(waiter);
                    return undefined;
                }
                case 'sendMessage': {
                    const chatId = String(body.chat_id);
                    if (blocked.has(chatId)) return fail(res, 403, 'Forbidden: bot was blocked by the user');
                    if (rejectButtons && body.reply_markup) return fail(res, 400, 'Bad Request: BUTTON_URL_INVALID');
                    const messageId = nextMessageId++;
                    sent.push({
                        chatId,
                        messageId,
                        text: body.text,
                        parseMode: body.parse_mode,
                        button: body.reply_markup?.inline_keyboard?.[0]?.[0] || null,
                        at: Date.now(),
                    });
                    return ok(res, { message_id: messageId, chat: { id: Number(chatId) }, text: body.text });
                }
                case 'editMessageText': {
                    const chatId = String(body.chat_id);
                    const original = sent.find((m) => m.chatId === chatId && m.messageId === Number(body.message_id));
                    if (!original) return fail(res, 400, 'Bad Request: message to edit not found');
                    edits.push({
                        chatId,
                        messageId: original.messageId,
                        text: body.text,
                        parseMode: body.parse_mode,
                        button: body.reply_markup?.inline_keyboard?.[0]?.[0] || null,
                        at: Date.now(),
                    });
                    return ok(res, { message_id: original.messageId, chat: { id: Number(chatId) }, text: body.text });
                }
                default:
                    return fail(res, 404, `Method ${method} not implemented in fake`);
            }
        });
    });

    return new Promise((resolve) => {
        server.listen(0, () => {
            const { port } = server.address();
            resolve({
                url: `http://localhost:${port}`,
                close: () => {
                    for (const w of waiters) { clearTimeout(w.timer); try { ok(w.res, []); } catch { /* closed */ } }
                    server.close();
                },
            });
        });
    });
}

module.exports = { startFakeTelegram };
