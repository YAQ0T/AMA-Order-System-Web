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

## What still needs testing — and how

These cannot be checked without your real environment. Roughly in order of risk.

### 1. Everything above, against real MySQL

The mock copies response *shapes*, not Sequelize. Re-run the item-status test in
particular: mark three items in one order in quick succession, then reload and
confirm all three stuck. That is the bug you found, and the real server is
slower than the mock, so the race window is wider.

Also confirm:
- `History` (سجل التعديلات) populates and reads sensibly — the server writes an
  `OrderLog` row per item change, so expect it to be **noisy**
- Pagination totals are right (the server uses `distinct: true` with joins,
  which can miscount)
- **Arabic saved and read back correctly.** Create an order with an Arabic
  customer name and item, then reload. If you see `????`, the database was not
  created with utf8mb4 - drop it and recreate with the statement in
  `server/.env.example`.

### 2. Email — the one that can embarrass you

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

### 4. Multi-user concurrency

I tested one browser. Untested: two takers on the same order at once. Given the
server rebuilds the whole item list on every write, **two takers marking
different items in the same order simultaneously will very likely clobber each
other** — the per-order queue only serialises within one browser tab.

To test: two machines, same order, both mark different items within a second.
If it loses ticks, the fix belongs on the server (see below).

### 5. Web push

Needs HTTPS and real VAPID keys. `http://192.168.x.x` will **not** work —
browsers refuse service workers outside a secure context.

1. `npx web-push generate-vapid-keys` → `server/.env`
2. Serve over HTTPS or test on `localhost`
3. Bell menu → "تفعيل إشعارات المتصفح"

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

## Known server issue — the root cause of the bug you found

`routes/orders.js` updates items like this:

```js
await OrderItem.destroy({ where: { orderId: order.id }, transaction });
// ...
await OrderItem.bulkCreate(orderItems, { transaction });
```

Every save **deletes every item row and recreates them with new IDs**. Consequences:

1. **Any item ID a client holds is dead** the moment anything in that order is
   written. This is what made marking a second item clear the first. The web
   client is now immune — it keys everything by item *name*, which is what the
   server itself matches on and which `sanitizeItems` guarantees is unique
   within an order.
2. **`PATCH /api/items/:itemId/status` is effectively unusable** — the ID is
   stale almost immediately. The web client does not use it. The old React front
   did.
3. Item `createdAt` is lost on every save.
4. Two clients writing the same order concurrently will clobber each other
   regardless of what either client does.

I did **not** change this. It is the core write path of the server
and I could not test it against a real database from here. The proper fix is to
diff the incoming list against existing rows and `update` / `create` / `destroy`
only what changed, keyed by name — which would also fix (4) and make the
`OrderLog` far less noisy. Worth doing, but it deserves its own change with real
data behind it.
