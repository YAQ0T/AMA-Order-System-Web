# AMA Order System — Web

Arabic-first (RTL) web client for the AMA Order System, plus the Node/Express API
it talks to. Ported from the Flutter app in `../AMA-Order-System-Flutter`.

```
AMA-Order-System-Web/
├── client/          React 19 + Vite 7 web app
├── server/          Node/Express + MySQL API
├── tools/
│   └── mock-api.js  Fake API for front-end work without a database
└── scripts/         Start helpers for Windows and macOS/Linux
```

---

## Quick start

### 1. Database

Install **MySQL 8.0 or newer** (the MSI installer, not the ZIP). When it asks
about authentication, choose **"Use Strong Password Encryption"** —
that is `caching_sha2_password`, which the `mysql2` driver supports.

Then set your credentials and let the scripts do the rest:

```bash
cd server
cp .env.example .env
```

Fill in `DB_USER` / `DB_PASSWORD` and set a real `JWT_SECRET`. Then:

```bash
npm install
npm run db:create    # creates the database with the correct charset
npm run db:check     # verifies it end to end
```

`db:create` exists so the charset cannot be got wrong. **MySQL's legacy `utf8`
is a 3-byte subset that cannot hold the full Unicode range, and creating the
database through a GUI often accepts a default that is not `utf8mb4` — Arabic
then stores as `????`, which you only notice once there is data worth keeping.**
It is safe to re-run and never drops anything.

`db:check` proves the setup actually works rather than merely looking right. It
writes Arabic to a real table, reads it back, and confirms `DECIMAL` still
arrives as a string and `LIKE` matches Arabic substrings (which is what order
search depends on). It cleans up after itself.

If you would rather create the database by hand:

```sql
CREATE DATABASE ama_order_system
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

The server creates its own tables on first start, and seeds an `admin` /
`admin123` account if no admin exists — **change that password immediately**.

### 2. Server

```bash
cd server
npm install
npm run dev
```

Listens on `http://localhost:6001` (override with `PORT`). It prints the LAN
addresses it is reachable on.

### 3. Client

```bash
cd client
npm install
npm run dev
```

Opens on `http://localhost:5173`. Vite proxies `/api` to the server, so the
browser sees one origin — no CORS, and nothing to configure.

### No database handy?

```bash
node tools/mock-api.js     # port 6001, in-memory seed data
cd client && npm run dev
```

Log in as `admin`, `maker1`, `taker1`, `taker2`, `acc1`, or `newbie` (pending
approval) with any password. This exists so the UI can be worked on without
MySQL; it stores nothing and resets on restart.

---

## Production

Build the client, then let the server serve it:

```bash
cd client && npm run build
cd ../server && npm start
```

The server detects `client/dist` and serves it, with an SPA fallback so deep
links like `/maker/archived` work on refresh. Everything is then on one port.

To host the client separately instead, set `VITE_API_URL` before building — see
`client/.env.example`.

---

## What the app does

Four roles, same as the Flutter app:

| Role | Arabic | Can do |
|---|---|---|
| maker | منشئ الطلبات | Create orders, manage active + archived, bulk-send archived, print, reports |
| taker | المجهّز | See assigned orders, mark items collected/unavailable, add items, advance status |
| accounter | المحاسب | See completed orders, send to ERP, print |
| admin | المدير | Stats, approve/manage users, all orders, activity logs, reports |

Order lifecycle: `pending` → `in-progress` → `completed` → `entered_erp`, with
`archived` as a draft state outside the flow. "النشطة" in the UI means
`pending` + `in-progress`.

### Keyboard shortcuts (order form)

| Key | Action |
|---|---|
| `Ctrl+Enter` | Create an active order |
| `F3` | Create an archived order |
| `F7` | Remove the focused item row |
| `Enter` | Move name → quantity → price → next row |
| `↑` `↓` | Move through item-name suggestions |

**F3 and F7 are claimed from the browser.** F3 is normally Find, and F7 toggles
caret browsing in Firefox. The app calls `preventDefault()` on both because
staff already have the muscle memory from the Flutter app. To hand them back,
remove the entries in `client/src/components/OrderForm.jsx` — the handling is in
one place, see `client/src/lib/shortcuts.js`.

---

## Notes for whoever works on this next

### Arabic / RTL

- The whole app is `dir="rtl"` on `<html>`. Use Tailwind **logical** utilities
  (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `text-start`) — never `ml-`/`mr-`.
- **Anything numeric must be wrapped in `<Ltr>`** (or `dir="ltr"`). Without it,
  bidi reordering turns `#1024` into `1024#` and mangles timestamps. This
  applies to the print output too.
- Numeric inputs run through `normalizeDigits()` so Arabic-Indic digits
  (`٠١٢٣`) and the Arabic decimal separator (`٫`) parse correctly.
- All Arabic strings live in `client/src/lib/labels.js`.
- **Role names are a proposal, not confirmed terminology.** Check
  `ROLES` in `labels.js` against what your staff actually call these jobs.

### Fonts

Noto Sans Arabic and Noto Naskh Arabic are self-hosted in `client/public/fonts/`
(the same TTFs the Flutter app ships) rather than loaded from Google Fonts, so
the app works on a LAN with no internet. They are TTF; converting to WOFF2 would
cut roughly 200 KB each if you want the win.

### Printing

Printing is done by the **browser**, not a JS PDF library — see
`client/src/print/printOrders.js`. The document is rendered into a hidden iframe
and printed from there.

This is deliberate. jsPDF and pdfmake do not do Arabic shaping, so ligatures
break and letters render in isolated forms. The browser's layout engine shapes
Arabic correctly for free, and Ctrl+P → "Save as PDF" still produces a real PDF.
If you later need server-generated PDFs for email attachments, render the same
HTML with Puppeteer on the Node side.

### The `price` trap

`DECIMAL` comes back through Sequelize as a **string** (the driver is configured
with `decimalNumbers: false` to keep it that way).
`OrderItem.quantity` has a getter that coerces to Number; **`price` does not**,
so it arrives as `"12.50"`. Every response is parsed through Zod schemas in
`client/src/api/schemas.js`, which coerce it. Do not bypass that layer — this is
the runtime safety net standing in for TypeScript.

Related: takers never receive `price` at all (the server strips it in
`order_helpers.js`), so it is optional, not merely nullable.

### How item writes work — read this before touching them

There are two kinds of item write, and they go to **different endpoints on
purpose**. Mixing them up is how ticks get lost.

| Write | Endpoint | Sends |
|---|---|---|
| Tick / untick one item | `PATCH /api/orders/:id/items/status` | `{ name, status }` |
| Add, remove, re-quantify, re-price | `PUT /api/orders/:id` | the full item list, **without `status`** |

**Why ticks have their own endpoint.** `PUT` replaces the order's whole item
list with whatever arrives. When two takers work the same order, each sends the
list as they last saw it, so the second write undoes the first. Tested against
MySQL: done the old way, two takers ticking different items at the same moment
lost a tick in **20 out of 20** rounds. The `PATCH` endpoint updates a single
row, so it cannot touch an item it was not asked about: **0 out of 20**.

**Why `PUT` omits `status`.** When the key is absent, the server keeps each
item's current status, read *after* it locks the order row. So if a taker ticks
an item while a maker has the edit window open, saving the edit keeps the tick
instead of overwriting it with the window's stale copy. `itemsPayload` never
sends `status`. The one exception is `OrderEditModal`: a **renamed** item is new
as far as the server is concerned, so it carries its status across explicitly.

**Items are identified by name, never by id.** `PUT` rebuilds items with
`OrderItem.destroy` + `bulkCreate`, so every item gets a new id on every order
edit, and any id the browser holds goes stale. Name is what the server matches
on, and `sanitizeItems` guarantees it is unique within an order. The client keys
items by name everywhere: the status buttons, both edit modals, React list keys,
and the busy-state set. (The `PATCH` endpoint does not rotate ids, but `PUT`
still does.)

Regression tests for all three rules are in `src/api/schemas.test.js`. Do not
"fix" them by putting `id` or `status` back into `itemsPayload`.

Taps are queued per order in `useUpdateItemStatus`, so two taps on the same item
(tick, then untick) land in the order they were made, with an optimistic update
so each tap shows instantly.

### Reports are computed client-side

The server has no aggregate endpoint and caps pages at 20 rows, so
`fetchAllOrders` walks the whole history 20 at a time. Fine for hundreds of
orders, slow in the thousands. A `GET /api/orders/report?from=&to=` doing the
aggregation in SQL would be the fix.

---

## Changes made to the server copy

`server/` started as a copy of
`../AMA-Order-System-Flutter/AMA-Order-System/server` and is **a fork, not a
symlink** — changes on one side do not reach the other. What was changed:

### Converted from PostgreSQL to MySQL

1. **`pg` + `pg-hstore` → `mysql2`**, dialect switched in `db.js`.
2. **`Op.iLike` → `Op.like` (5 places).** `iLike` is Postgres-only. MySQL's
   `utf8mb4_unicode_ci` collation is already case-insensitive, so plain `LIKE`
   does the same job — but only with a case-insensitive collation.
3. **`PushSubscription.endpoint`: `TEXT` → `STRING(512)`.** MySQL cannot put a
   UNIQUE index on TEXT without a prefix length; `sync()` failed outright.
4. **utf8mb4 pinned everywhere** (connection, `define`, dialectOptions), because
   latin1 silently destroys Arabic.
5. **`decimalNumbers: false`** so DECIMAL still arrives as a string, matching the
   old Postgres behaviour the client already handles.

### Fixed a startup bug that would have hit you on the first run

`syncDatabase()` called `describeTable('Orders')` before `sequelize.sync()`, inside
the same `try`. On a **fresh database that call throws** (the table does not exist
yet), which jumped to the `catch` — so `sync()` never ran, no tables were created,
and no admin was seeded. The server started anyway and every request failed.

This was present on Postgres too; it only stayed hidden because the existing
database already had tables. Now: connect → sync → legacy column check → seed,
each independently guarded.

Also: schema alteration is now opt-in via `DB_ALTER=true`. It used to run on
every start, which on MySQL can accumulate duplicate indexes until a table hits
the 64-key limit.

### Fixed takers losing each other's work

Added **`PATCH /api/orders/:id/items/status`** (`routes/order_items.js`), which
sets one item's status by name in a single-row update, under the same order row
lock `PUT` uses. Two takers on the same order can no longer undo each other.
Same authorization as `PUT` (admin, the order's own maker, or an assigned taker);
takers get `409` on a completed order. Each change is written to the order
history and the activity log, and repeating an unchanged status writes nothing.

**Email policy changed with it.** A taker's `PUT` used to email the maker on
*every* save — and since every tick was a save, that was one email per item.
Now the maker is emailed only when a taker changes the **order status** (starts
or finishes it). Ticks send no email and no in-app notification. A taker adding
an item or changing a quantity still raises an in-app notification, but no email.

### Security and operational fixes

6. **Added authentication to three open endpoints.** `PATCH /api/items/:itemId/status`
   and `GET /api/items/suggestions` had no auth at all, meaning anyone who could
   reach the server could change any item's status without a token.
   `GET /api/auth/takers` and `/accounters` were also open and returned the user
   list. All now require a valid JWT.

   Authentication alone was not enough for the item endpoint: any logged-in
   user could still change any item on **any** order, including orders not
   assigned to them. It now goes through the same authorization, lock and
   history logging as the new order-scoped endpoint.
7. **Moved the VAPID keys to environment variables.** They were hardcoded in
   `utils/push.js`, including the private key, and are in the Flutter repo's git
   history. Generate a fresh pair with `npx web-push generate-vapid-keys`.
8. **Email no longer dials Gmail on startup when unconfigured.** It used to
   connect to smtp.gmail.com on every boot even with blank credentials, print a
   stack trace, and delay startup. All sends now route through one guard.
9. **Serves the built client** from `client/dist`, with an SPA fallback.
10. **Added `GET /api/health`** and `GET /api/notifications/vapid-public-key`.
11. **Replaced the hardcoded `10.10.10.110` startup log** with real interface
    detection.

### Still worth fixing (not changed)

- `JWT_SECRET` falls back to the literal string `your-secret-key` in
  `middleware/auth.js` when unset.
- Tokens last **365 days** and are stored in `localStorage`, so one lifted via
  XSS stays valid for a year.
- CORS reflects any origin with `credentials: true`.
- The seeded `admin` / `admin123` is documented publicly in the Flutter README.

### A bug fixed in the client

The database enum is `'in-progress'` (hyphen), but both the Flutter PDF builder
and the old React print component switch on `'in_progress'` (underscore), so
that case never matched and in-progress orders printed the raw English string.
The web client uses the hyphenated key throughout.

---

## Commands

| Where | Command | What |
|---|---|---|
| `client/` | `npm run dev` | Dev server on 5173, proxies `/api` |
| `client/` | `npm run build` | Production build into `dist/` |
| `client/` | `npm run preview` | Serve the built output |
| `client/` | `npm run lint` | ESLint |
| `client/` | `npm test` | Unit tests (51) |
| `server/` | `npm run db:create` | Create the database with utf8mb4 |
| `server/` | `npm run db:check` | Verify connection, charset and Arabic round-trip |
| `server/` | `npm run test:integration` | 92 checks against the real server + MySQL, on a throwaway database |
| `server/` | `npm run dev` | API with nodemon |
| `server/` | `npm start` | API |
| root | `node tools/mock-api.js` | Fake API, no database |

### Scripts

| Script | What |
|---|---|
| `scripts\start-dev.cmd` | API + client, each in its own window |
| `scripts\stop-dev.cmd` | Stops both |
| `scripts\start-mock.cmd` | Mock API + client, no database needed |
| `scripts\stop-mock.cmd` | Stops both |
| `scripts/start-dev.sh` | Same as start-dev, macOS/Linux/Git Bash |
| `scripts/stop-dev.sh` | Same as stop-dev |
| `scripts/build.sh` | Production build of the client |

The stop scripts work by **port** (6001 and 5173), not PID files — the same
fallback approach as `stop_ama.command` in the Flutter repo. That means they
also clean up servers you started by hand or left behind after closing a
terminal. They check the process is actually `node.exe` before killing it, so
they will not take down something unrelated sitting on those ports.

`stop-dev` and `stop-mock` do the same thing; both names exist so whichever
start script you used has an obvious counterpart. You cannot run start-dev and
start-mock at the same time anyway — they both want port 6001.

## Testing

See [TESTING.md](TESTING.md) for what has been verified end-to-end, what still
needs your real environment, and how to reproduce concurrency bugs using the
mock's latency knob.

```bash
cd client && npm test
```

## Web push

Optional. Needs VAPID keys in `server/.env` and a **secure context** in the
browser: `https://` or `localhost`. A plain `http://192.168.x.x` LAN address
will not work — service workers and the Notification API are refused there.
Without push the app is otherwise identical; in-app notifications still poll.
