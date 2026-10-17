# Testing

## Automated

```bash
cd client && npm test      # 57 unit tests
cd client && npm run lint
```

Covers the pure logic that is easy to break and hard to notice: Arabic-Indic
digit parsing, the DECIMAL-as-string price coercion, report aggregation, the
print document (RTL, LTR isolation, HTML escaping, status labels), and the
Arabic translation of server errors, order history and notifications.

## Testing the UI without a database

```bash
scripts\start-mock.cmd
```

Log in as `admin`, `maker1`, `taker1`, `taker2`, `acc1`, or `newbie` (pending
approval) with any password.

The mock deliberately reproduces the real server's awkward behaviours, because
an in-memory mock that "just works" hides exactly the bugs worth finding:

- `price` comes back as a **string**, as Sequelize serialises DECIMAL
- takers receive **no** `price` field at all
- **item IDs rotate on every save**, because the real server does
  `OrderItem.destroy` + `bulkCreate`
- taker writes have their prices **restored by name** server-side
- list endpoints cap `limit` at 20

### Simulating a slow server

An in-memory mock answers in under a millisecond and hides every race condition.
To find concurrency bugs, add latency:

```bash
set MOCK_LATENCY=400 && node tools\mock-api.js
```

400ms is roughly what the real server takes: the item update runs
`destroy` + `bulkCreate` + several `OrderLog` inserts inside a transaction.
**The "marking a second item clears the first" bug was invisible at 0ms latency
and reproduced immediately at 400ms.** Use this whenever you touch anything that
writes.

---

## What has been verified end-to-end

Against the mock, driving the real UI:

| Area | Verified |
|---|---|
| Auth | Login, signup, pending-approval redirect, logout, session restore on reload |
| Role guards | Taker asking for `/admin/users`, `/maker/archived`, `/accounter/erp` all bounce to `/taker` |
| Deep links | `/maker/archived` survives a hard refresh |
| Maker | Create active + archived, validation (no taker/accounter blocks an active order), Ctrl+Enter, F3, form reset |
| Maker | Edit order: city, price, quantity — taker's item statuses survive intact |
| Maker | Archived tab: city grouping in canonical order, multi-select, bulk send assigns taker + accounter and flips to pending |
| Taker | Item status marking — single, rapid (5 taps, 0ms apart), and mixed collected/unavailable |
| Taker | Add item, edit quantity, duplicate name rejected, existing statuses preserved |
| Taker | No price column (server strips the field) |
| Lifecycle | pending → in-progress → completed → entered_erp across three roles |
| Lifecycle | Completed orders vanish from the taker even with `status=all` |
| Accounter | Completed and ERP tabs, send-to-ERP moves the order between them |
| Admin | Stats, approve user (UI updates without refresh), user table, activity logs |
| Reports | Paged through all 47 orders, aggregated sold/unavailable/takers/customers |
| Print | Screenshotted: Arabic shaped, RTL table, numbers LTR-isolated, red strikethrough for unavailable, page breaks |
| Dark mode | Round-trips to the server, matches the Flutter palette exactly |
| Arabic digits | `٢٫٥` → 2.5 and `١٢` → 12 in every numeric input |
| Pagination | 47 orders across 3 pages at the server's 20-row cap |
| Production | Server serves `client/dist`, SPA fallback on deep links, survives no database |

---

## Verified against the real server and MySQL 26.7

Run with `npm run test:integration` in `server/` — **329 checks across six suites**
(api 66, concurrency 34, telegram 45, open-orders 77, backup 47, security 60).
It creates a throwaway database, runs everything against the real routes and
real MySQL, and drops it afterwards — your own database is never touched. Test
servers also write their backups and order logs to a throwaway folder, and
never take automatic backups.

| Area | Verified |
|---|---|
| Setup | `db:check`: auth plugin, utf8mb4, Arabic round-trip, DECIMAL as string, Arabic `LIKE` |
| Startup | Fresh database: tables created, admin seeded (this used to fail — see README) |
| Security | Item, takers and suggestions endpoints reject requests without a token |
| Auth | Register, unapproved login blocked, admin approval, role guards on admin routes |
| Arabic | Title, description, city and item names survive MySQL intact |
| Prices | DECIMAL arrives as a string; taker writes never wipe prices |
| Taker ticks | 3 quick taps all persist; item ids no longer rotate on a tick |
| **Two takers** | **4 simultaneous ticks from 2 takers, 20 rounds: 0 lost** (old way: 20 of 20 lost) |
| Maker vs taker | Maker saves an edit while a taker ticks, 20 rounds: both changes survive |
| Taker vs taker | One adds an item while the other ticks, 20 rounds: tick, item and prices survive |
| Rename | A renamed item keeps its status |
| Authorization | Unassigned taker, accounter and another maker's order → 403; completed order → 409 |
| Notifications | Ticks create none; an order status change notifies the maker once |
| History | Each tick recorded once; repeating the same status adds nothing |
| Lifecycle | pending → in-progress → completed → entered_erp, with the accounter guard |
| Search | Arabic substring search and item suggestions |
| Archived | Create without assignment, activation guard, send, delete |
| UI | Real browser on the real server: 5 rapid taps → 5 single-item calls, all saved |
| UI | Maker's edit window open while another taker unticks: the untick survives |
| **Telegram** | Run against a fake Telegram API (`server/test/fake-telegram.js`) that the server cannot tell apart from the real one |
| Telegram linking | One-time 24-char code; works once; ignored in group chats; invalid code and stray messages get Arabic replies |
| Telegram messages | Exactly one per event; customer, city, items, quantities; **no prices** (a deliberate price leak fails the suite) |
| Telegram safety | Typed-in HTML escaped; a rejected button falls back to a plain message; 17-item order says "and 2 more" |
| Telegram routing | Only linked takers are messaged; sending out an archived order sends "new order", not also "updated"; a taker's own actions send nothing |
| Telegram lifecycle | Unlink from the app; blocking the bot unlinks automatically; deleting a linked user works |
| Telegram UI | Real browser: link → open Telegram → Start → card turns green on its own, with toasts for link and unlink |
| Telegram accountant | Welcome says ERP orders will arrive; starting an order sends nothing; completing it sends exactly one "ready for ERP" with the unavailable item struck through and counted, no prices, button to `/accounter`; entering ERP sends nothing; unlinked accountant gets nothing (disabling the send fails 4 checks) |
| Telegram roles | Makers and admins are told they cannot link, and get 403 if they try |
| **Open orders** | Create / send out / open up / assign / release; refused without a taker *and* without "open"; takers see them without prices and cannot tick or start them before taking |
| **Open-order race** | **4 takers tapping twice each at the same moment, 20 rounds: exactly one winner every time.** With the row lock removed the same test has all four winning |
| Maker vs taker on an open order | Maker assigns while a taker takes it, 10 rounds: always ends with the maker's choice only |
| Open orders on Telegram | Every linked taker gets one "open order" message (no prices, button to the open tab); once taken it is edited to "taken by …" / "you took it" / "no longer available"; no duplicate messages |
| Edit messages | A save that changes nothing, or only prices, sends nothing; a new taker gets "new order", the others nothing; admin edits notify like maker edits |
| **Backups** | Admin-only; complete file with every table; Arabic, exact prices and quantities; no plain passwords; path tricks cannot download other files |
| **Restore** | Refuses while the system runs, a cut-off file, and a non-AMA file (nothing changed after each refusal); takes a safety backup; brings back a deleted order with items, ticks, takers, history; logins work; new orders keep unique numbers; a value with \ ; and ' survives. Naive quoting in the dump fails 9 of these checks |
| Backup while working | A backup taken while 8 orders are being created succeeds and blocks nobody |
| Retention | Newest 5, one per day for 30 days, one per month for a year, safety copies 30 days |
| **Sign-up** | Role "admin" refused (and no admin created); short names/passwords refused; duplicate name in other letter case refused |
| **Sessions** | Broken / forged-with-old-default-secret tokens get 401; a deleted or deactivated user's open session ends at once; a password change logs out other devices |
| **Deactivate vs delete** | Deleting a maker with orders or a taker with history is refused and changes nothing; deactivating keeps history, blocks login, hides them from makers; activating restores access |
| **Passwords** | Default admin password flagged; wrong current password is a 400, not a logout; admin reset ends the user's sessions; makers cannot reset |
| Input limits | Over-long names, descriptions, out-of-range quantities and prices, unknown cities: 400 with a clear message, on create and edit |
| Search | "%" and "_" are matched literally |
| Login throttling | 8 wrong passwords lock that name for 15 minutes; others can still log in |
| **Launcher (Windows)** | Start with nothing running (installs/builds as needed, waits for the database, prints the phone address without the VirtualBox adapter); start when already running; start with MySQL unreachable (clear message, nothing left running); stop; restore cancelled (nothing changed) |

---

## What still needs testing — and how

These cannot be checked without your real environment. Roughly in order of risk.

### 0. The new things, on your machines

1. **Open orders on real phones.** Create an order with «مفتوح لأي مجهّز».
   Two takers' phones should get "🔓 طلب مفتوح". One taps «خذ الطلب» in the app:
   the other phone's message should change to "تم أخذ الطلب".
2. **Backups somewhere else.** Set `BACKUP_COPY_DIR` in `server/.env` to a
   USB drive or a OneDrive/Google Drive folder, restart, then Admin ›
   النسخ الاحتياطي › «خذ نسخة احتياطية الآن» and check the file appears there too.
3. **A real restore, once, before you need it.** On a quiet day: Stop AMA,
   Restore AMA, pick yesterday's backup, check the data, then (if you want
   today's data back) restore the "before-restore" copy the same way.
4. **The Mac files.** Not testable here (no Mac). Double-click
   `Start AMA (Mac).command` on the Mac. If macOS blocks it: right-click ›
   Open. If it says "permission denied": `chmod +x *.command` once in Terminal.
5. **Change the admin password** if it is still `admin123` - the red banner
   shows until you do.

### 1. Telegram with a real bot and real phones

Everything was verified against a fake Telegram API. The real bot
(`@AMA_Orders_Bot`) is configured and the server connects to it, but no real
phone has been linked yet. On the same Wi-Fi as the server, open
`http://<server-ip>:6001` on the phone (the server log prints the address),
then:

1. As a taker on an **iPhone**: log in, tap **ربط تيليغرام**, then
   **فتح تيليغرام**. Telegram should open straight on the bot. Tap Start.
   The card in the system should turn green within a few seconds.
2. Do the same as a second taker on a **Samsung**.
3. As the maker, create an order assigned to both. Each phone should get the
   message with the phone **locked** and Telegram **closed** — that is the case
   web push kept failing.
4. Link an **accountant** the same way, then have a taker finish an order
   assigned to that accountant. The accountant should get "جاهز للإدخال على ERP".
5. If **فتح تيليغرام** does nothing on a phone, try the "لم يُفتح التطبيق؟" link
   under it and tell me which phone it was. If the page does not load on the
   phone at all, Windows Firewall is blocking port 6001.

### 2. Every taker is actually linked

There is no email any more, so a taker who has not linked Telegram gets
**nothing on their phone** — they only see new orders when they open the app.
Before relying on it, log in as each taker once and make sure the card at the
top of their page is green ("الطلبات تصلك على تيليغرام").

### 3. Printing on your actual printer

I verified the print HTML renders correctly on screen. I could not verify paper.

- Print one order and check the margins on A4
- Confirm Arabic is not clipped at the right edge
- Print an order with an **unavailable** item — it uses a red tint and
  strikethrough, which needs "Background graphics" enabled in the print dialog.
  If your staff print in black and white, tell me and I will switch to a
  pattern or a bold marker that survives mono printing.
- Print an order with 20+ items to check the page break and that the table
  header repeats

### 4. Two real devices on the LAN

Two takers ticking the same order is **fixed and verified** against MySQL (see
the table above). What is left is the human version: two phones on your
network, same order, both ticking different items as fast as they can. It
should simply work. If it does not, that is a real bug — tell me.

One limitation remains, and it is much rarer: two people making a
**structural** edit to the same order at the same moment — for example both
adding an item within the same second. Those still go through `PUT`, which
replaces the whole item list, so one of the two additions can be lost. Ticks are
not affected. See the end of this file.

### 5. Web push — nothing to test

Switched off in the UI after it proved unreliable on Samsung and iPhone;
takers use Telegram instead. Only relevant if you turn `OFFER_BROWSER_PUSH`
back on, in which case it needs HTTPS and VAPID keys (see README).

### 6. Scale

Everything was tested with 47 orders. Reports page through the **entire**
history 20 rows at a time, so at a few thousand orders expect it to crawl. Test
with a realistic year of data before trusting the Reports tab.

### 7. The Arabic itself

I am not a native speaker and I guessed at your internal terminology. Sit a
maker and a taker in front of it for ten minutes. In particular:

- The four role names (منشئ الطلبات / المجهّز / المحاسب / المدير) — all in
  `client/src/lib/labels.js`
- `تم التجهيز` vs `غير متوفر` for item statuses
- Whether `حفظ كمؤرشف` reads as "save as draft" to them

### 8. F3 and F7

Ask a maker whether stealing these from the browser feels right. F3 is normally
Find and F7 toggles caret browsing in Firefox.

### 9. Their actual browsers and devices

Tested in one Chromium engine at desktop width. Check whatever your staff
actually use, and a phone if takers work from one.

---

## The server's item rewrite, and what is left of it

`PUT /api/orders/:id` updates items like this:

```js
await OrderItem.destroy({ where: { orderId: order.id }, transaction });
// ...
await OrderItem.bulkCreate(orderItems, { transaction });
```

Every structural save **deletes every item row and recreates them with new
IDs**. That was the root of both bugs found so far. Where things stand:

| Consequence | Status |
|---|---|
| A held item id goes stale, so a tick misses or wipes another | **Fixed** — the client identifies items by name everywhere |
| Two takers ticking the same order undo each other | **Fixed** — ticks use `PATCH /api/orders/:id/items/status`, a single-row update. 0 of 20 lost, against 20 of 20 before |
| A maker's edit overwrites ticks made while the edit window was open | **Fixed** — structural edits no longer send `status`, so the server keeps the live value |
| `PATCH /api/items/:itemId/status` let any user change any order | **Fixed** — same authorization as the new endpoint |
| Two people make a **structural** edit to one order in the same second | **Still possible.** Each `PUT` carries the full list, so one person's added item can disappear. Rare, and ticks are unaffected |
| Item `createdAt` is reset on every structural save | Still true. Nothing in the app reads it |

The remaining fix is to make `PUT` diff the incoming list against the existing
rows and `update` / `create` / `destroy` only what changed, keyed by name. That
would close the structural-edit race, keep ids stable, and make the order
history quieter. It is a rewrite of the server's main write path, so it is
worth doing only if the structural-edit race turns out to happen in practice.
