# Testing

## Automated

```bash
cd client && npm test      # 51 unit tests
cd client && npm run lint
```

Covers the pure logic that is easy to break and hard to notice: Arabic-Indic
digit parsing, the DECIMAL-as-string price coercion, report aggregation, and the
print document (RTL, LTR isolation, HTML escaping, status labels).

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

Run with `npm run test:integration` in `server/` (see below). It creates a
throwaway database, runs everything against the real routes and real MySQL, and
drops it afterwards — your own database is never touched.

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

---

## What still needs testing — and how

These cannot be checked without your real environment. Roughly in order of risk.

### 1. Email — the one that can embarrass you

**Nothing in my testing sent a single email.** The server sends on order create,
order update, and bulk send. Before real use:

1. Set `EMAIL_USER` / `EMAIL_PASSWORD` in `server/.env` (Gmail needs an App
   Password, not the account password)
2. Create one order assigned to a taker **whose email is your own**
3. Confirm the mail arrives, and that the Arabic renders correctly in the mail
   client — not just the browser

Then test bulk send with **two** archived orders, not ten. Bulk send is one PUT
per order, so ten orders is ten emails. Check whether takers want one mail per
order or one digest; the server has a `/api/orders/bulk-email` endpoint for the
digest shape that the web client does not currently call.

Also check the maker email policy behaves as agreed: ticking items should send
**nothing**; the maker should get one email when a taker **starts** the order and
one when they **finish** it.

### 2. Printing on your actual printer

I verified the print HTML renders correctly on screen. I could not verify paper.

- Print one order and check the margins on A4
- Confirm Arabic is not clipped at the right edge
- Print an order with an **unavailable** item — it uses a red tint and
  strikethrough, which needs "Background graphics" enabled in the print dialog.
  If your staff print in black and white, tell me and I will switch to a
  pattern or a bold marker that survives mono printing.
- Print an order with 20+ items to check the page break and that the table
  header repeats

### 3. Two real devices on the LAN

Two takers ticking the same order is **fixed and verified** against MySQL (see
the table above). What is left is the human version: two phones on your
network, same order, both ticking different items as fast as they can. It
should simply work. If it does not, that is a real bug — tell me.

One limitation remains, and it is much rarer: two people making a
**structural** edit to the same order at the same moment — for example both
adding an item within the same second. Those still go through `PUT`, which
replaces the whole item list, so one of the two additions can be lost. Ticks are
not affected. See the end of this file.

### 4. Web push

Needs HTTPS and real VAPID keys. `http://192.168.x.x` will **not** work —
browsers refuse service workers outside a secure context.

1. `npx web-push generate-vapid-keys` → `server/.env`
2. Serve over HTTPS or test on `localhost`
3. Bell menu → "تفعيل إشعارات المتصفح"

### 5. Scale

Everything was tested with 47 orders. Reports page through the **entire**
history 20 rows at a time, so at a few thousand orders expect it to crawl. Test
with a realistic year of data before trusting the Reports tab.

### 6. The Arabic itself

I am not a native speaker and I guessed at your internal terminology. Sit a
maker and a taker in front of it for ten minutes. In particular:

- The four role names (منشئ الطلبات / المجهّز / المحاسب / المدير) — all in
  `client/src/lib/labels.js`
- `تم التجهيز` vs `غير متوفر` for item statuses
- Whether `حفظ كمؤرشف` reads as "save as draft" to them

### 7. F3 and F7

Ask a maker whether stealing these from the browser feels right. F3 is normally
Find and F7 toggles caret browsing in Firefox.

### 8. Their actual browsers and devices

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
