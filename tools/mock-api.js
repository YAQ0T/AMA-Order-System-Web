/**
 * Mock API for front-end development without PostgreSQL.
 *
 * Serves the same routes and response shapes as server/, including the quirks
 * that matter to the client:
 *   - `price` is returned as a STRING, the way Sequelize serialises DECIMAL
 *   - takers get no `price` field at all
 *   - list endpoints return { orders, pagination } and cap limit at 20
 *   - status values use 'in-progress' with a hyphen
 *
 * Run:  node tools/mock-api.js      (listens on 6001 by default)
 * Then: cd client && npm run dev
 *
 * This is a development aid only. It is not used in production and stores
 * nothing - restart it and you are back to the seed data.
 */

const http = require('http');

const PORT = Number(process.env.PORT) || 6001;

// Artificial latency, in ms. The real server does destroy + bulkCreate + several
// OrderLog inserts inside a transaction, which takes well over 100ms against
// Postgres on a LAN. An in-memory mock answers instantly and hides every race
// condition, so set this when testing concurrency:
//   MOCK_LATENCY=400 node tools/mock-api.js
const LATENCY = Number(process.env.MOCK_LATENCY) || 0;
const delay = () => (LATENCY ? new Promise((r) => setTimeout(r, LATENCY)) : Promise.resolve());

const CITIES = ['نابلس', 'الخليل', 'جنين', 'طولكرم', 'بديا', 'قلقيليا', 'رامالله', 'بيت لحم', 'الداخل'];

const users = [
  { id: 1, username: 'admin', role: 'admin', isApproved: true, prefersDark: false },
  { id: 2, username: 'maker1', role: 'maker', isApproved: true, prefersDark: false },
  { id: 3, username: 'taker1', role: 'taker', isApproved: true, prefersDark: false },
  { id: 4, username: 'taker2', role: 'taker', isApproved: true, prefersDark: false },
  { id: 5, username: 'acc1', role: 'accounter', isApproved: true, prefersDark: false },
  { id: 6, username: 'newbie', role: 'maker', isApproved: false, prefersDark: false },
];

const PRODUCTS = ['طحينة', 'زيت زيتون', 'أرز بسمتي', 'سكر', 'حليب', 'جبنة بيضاء', 'زعتر', 'عدس', 'برغل', 'شاي'];

let nextOrderId = 1;
let nextItemId = 1;

const makeOrder = (index) => {
  const statuses = ['pending', 'in-progress', 'completed', 'archived', 'entered_erp'];
  const status = statuses[index % statuses.length];
  const itemCount = 2 + (index % 4);
  const id = nextOrderId++;

  const items = Array.from({ length: itemCount }, (_, i) => {
    const itemStatuses = [null, 'collected', 'unavailable'];
    return {
      id: nextItemId++,
      name: PRODUCTS[(index + i) % PRODUCTS.length],
      quantity: i % 3 === 0 ? 1.5 : i + 1,
      // DECIMAL arrives as a string from Sequelize - this is the trap the
      // client's Zod schema coerces away.
      price: ((i + 2) * 3.25).toFixed(2),
      status: status === 'pending' ? null : itemStatuses[(index + i) % 3],
      createdAt: new Date(Date.now() - index * 8.64e7).toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  const created = new Date(Date.now() - index * 8.64e7);
  // Every tenth order is left open to any taker (pending, nobody assigned).
  const open = status === 'pending' && index % 10 === 0;

  return {
    id,
    title: `زبون رقم ${id}`,
    description: index % 3 === 0 ? 'ملاحظة على الطلب: يرجى التسليم صباحاً' : null,
    status,
    city: CITIES[index % CITIES.length],
    makerId: 2,
    accounterId: status === 'archived' ? null : 5,
    createdAt: created.toISOString(),
    updatedAt: created.toISOString(),
    Maker: users[1],
    Accounter: status === 'archived' ? null : users[4],
    AssignedTakers: status === 'archived' || open ? [] : [users[2], ...(index % 2 ? [users[3]] : [])],
    Items: items,
    History:
      index % 2 === 0
        ? [
            {
              id: 1000 + index,
              previousDescription: 'الحالة السابقة: قيد الانتظار',
              newDescription: 'تم تحديث الأصناف بواسطة المجهّز',
              createdAt: new Date(Date.now() - 3.6e6).toISOString(),
              changedBy: 3,
              Editor: { id: 3, username: 'taker1' },
            },
          ]
        : [],
  };
};

const orders = Array.from({ length: 47 }, (_, i) => makeOrder(i));

const activityLogs = Array.from({ length: 60 }, (_, i) => ({
  id: i + 1,
  action: ['order_created', 'order_updated', 'user_login', 'user_approved', 'order_status_changed'][i % 5],
  targetType: i % 3 === 0 ? 'user' : 'order',
  targetId: (i % 20) + 1,
  details: { note: 'mock entry', index: i },
  ipAddress: '127.0.0.1',
  createdAt: new Date(Date.now() - i * 3.6e6).toISOString(),
  User: users[i % users.length],
}));

const mockBackups = [1, 2, 3].map((daysAgo) => {
  const d = new Date(Date.now() - daysAgo * 8.64e7);
  d.setHours(9, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    name: `ama-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_09-00-00.sql.gz`,
    size: 46_000 - daysAgo * 900,
    createdAt: d.toISOString(),
    label: null,
  };
});

const notifications = [
  { id: 1, message: 'تم إسناد طلب جديد إليك', isRead: false, type: 'info', orderId: 1, createdAt: new Date().toISOString() },
  { id: 2, message: 'تم إكمال الطلب #3', isRead: true, type: 'success', orderId: 3, createdAt: new Date(Date.now() - 8.64e7).toISOString() },
];

// A fake token that encodes the user id, so /me can resolve it.
const tokenFor = (user) => `mock.${Buffer.from(JSON.stringify({ id: user.id, username: user.username, role: user.role, isApproved: user.isApproved })).toString('base64url')}.sig`;

const userFromToken = (auth) => {
  if (!auth?.startsWith('Bearer ')) return null;
  const parts = auth.slice(7).split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return users.find((u) => u.id === claims.id) || null;
  } catch {
    return null;
  }
};

/** Strip `price` for takers, exactly as getItemAttributesForRole does. */
const forRole = (order, role) => {
  if (role !== 'taker') return order;
  return {
    ...order,
    Items: order.Items.map(({ price, ...rest }) => rest),
  };
};

const ACTIVE = ['pending', 'in-progress'];

function filterOrders(role, user, query) {
  let list = orders;

  if (role === 'maker') list = list.filter((o) => o.makerId === user.id);
  if (role === 'accounter') {
    list = list.filter((o) => o.accounterId === user.id && ['completed', 'entered_erp'].includes(o.status));
  }
  if (role === 'taker') {
    list = list.filter(
      (o) => o.AssignedTakers.some((t) => t.id === user.id) && !['completed', 'entered_erp'].includes(o.status)
    );
  }

  const status = query.get('status');
  if (status === 'active') list = list.filter((o) => ACTIVE.includes(o.status));
  else if (status && status !== 'all') list = list.filter((o) => o.status === status);
  else if (!status) list = list.filter((o) => ACTIVE.includes(o.status));

  const city = query.get('city');
  if (city) list = list.filter((o) => o.city === city);

  const search = (query.get('search') || '').trim().toLowerCase();
  if (search) {
    list = list.filter((o) =>
      [o.title, o.description, o.city].some((f) => (f || '').toLowerCase().includes(search))
    );
  }

  const limit = Math.min(Number(query.get('limit')) || 20, 20);
  const offset = Number(query.get('offset')) || 0;

  return {
    orders: list.slice(offset, offset + limit).map((o) => forRole(o, role)),
    pagination: { total: list.length, limit, offset },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname, searchParams } = url;

  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const send = async (status, body) => {
    await delay();
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  const readBody = () =>
    new Promise((resolve) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          resolve({});
        }
      });
    });

  const user = userFromToken(req.headers.authorization);
  const needsAuth = () => {
    if (!user) {
      res.writeHead(401).end();
      return true;
    }
    return false;
  };

  // ---- auth ----
  // Any password works, except that the admin logging in with "admin123" is
  // flagged to change it, as the real server does (routes/auth.js).
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const { username, password } = await readBody();
    const found = users.find((u) => u.username === username);
    if (!found) return send(401, { error: 'Invalid credentials' });
    if (!found.isApproved && found.role !== 'admin') {
      if (found.approvedAt) return send(403, { error: 'This account has been deactivated', deactivated: true });
      return send(403, { error: 'Account pending admin approval', requiresApproval: true });
    }
    return send(200, {
      token: tokenFor(found),
      user: found,
      mustChangePassword: found.role === 'admin' && password === 'admin123' && !found.passwordChanged,
    });
  }

  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const { username, role, password } = await readBody();
    if (!['maker', 'taker', 'accounter'].includes(role)) return send(400, { error: 'Invalid role' });
    if (!password || String(password).length < 6) return send(400, { error: 'Password must be at least 6 characters' });
    if (users.some((u) => u.username.toLowerCase() === String(username).toLowerCase())) {
      return send(409, { error: 'Username already taken' });
    }
    const created = { id: users.length + 1, username, role, isApproved: false, prefersDark: false };
    users.push(created);
    return send(201, { message: 'User created successfully', requiresApproval: true });
  }

  if (pathname === '/api/auth/password' && req.method === 'PUT') {
    if (needsAuth()) return undefined;
    const { currentPassword, newPassword } = await readBody();
    if (!newPassword || String(newPassword).length < 6) return send(400, { error: 'Password must be at least 6 characters' });
    if (currentPassword === 'wrong') return send(400, { error: 'Current password is incorrect' });
    user.passwordChanged = true;
    return send(200, { token: tokenFor(user), user });
  }

  if (pathname === '/api/auth/me') {
    if (needsAuth()) return undefined;
    return send(200, { user });
  }

  if (pathname === '/api/auth/theme' && req.method === 'PUT') {
    if (needsAuth()) return undefined;
    const { prefersDark } = await readBody();
    user.prefersDark = Boolean(prefersDark);
    return send(200, { user });
  }

  if (pathname === '/api/auth/takers') {
    if (needsAuth()) return undefined;
    return send(200, users.filter((u) => u.role === 'taker' && u.isApproved).map(({ id, username, role }) => ({ id, username, role })));
  }

  if (pathname === '/api/auth/accounters') {
    if (needsAuth()) return undefined;
    return send(200, users.filter((u) => u.role === 'accounter' && u.isApproved).map(({ id, username, role }) => ({ id, username, role })));
  }

  // ---- orders ----
  const roleRoutes = {
    '/api/orders/maker': 'maker',
    '/api/orders/taker': 'taker',
    '/api/orders/admin': 'admin',
    '/api/orders/accounter': 'accounter',
  };

  if (roleRoutes[pathname] && req.method === 'GET') {
    if (needsAuth()) return undefined;
    return send(200, filterOrders(roleRoutes[pathname], user, searchParams));
  }

  if (pathname === '/api/orders/suggestions') {
    if (needsAuth()) return undefined;
    const q = (searchParams.get('q') || '').toLowerCase();
    return send(200, [...new Set(orders.map((o) => o.title))].filter((t) => t.toLowerCase().includes(q)).slice(0, 6));
  }

  if (pathname === '/api/orders' && req.method === 'GET') {
    if (needsAuth()) return undefined;
    return send(200, filterOrders(user.role, user, searchParams));
  }

  if (pathname === '/api/orders' && req.method === 'POST') {
    if (needsAuth()) return undefined;
    const body = await readBody();
    const archived = body.status === 'archived';
    const hasTakers = (body.assignedTakerIds || []).length > 0;
    if (!archived && body.openToAll === true && hasTakers) {
      return send(400, { error: 'An open order cannot also be assigned to takers' });
    }
    if (!archived && body.openToAll !== true && !hasTakers) {
      return send(400, { error: 'Active orders require at least one taker' });
    }
    const created = {
      ...makeOrder(orders.length),
      id: nextOrderId++,
      title: body.title,
      description: body.description ?? null,
      city: body.city,
      status: body.status === 'archived' ? 'archived' : 'pending',
      makerId: user.id,
      accounterId: body.accounterId ?? null,
      createdAt: new Date().toISOString(),
      Maker: user,
      Accounter: users.find((u) => u.id === body.accounterId) || null,
      AssignedTakers: archived ? [] : users.filter((u) => (body.assignedTakerIds || []).includes(u.id)),
      History: [],
      Items: (body.items || []).map((item) => ({
        id: nextItemId++,
        name: item.name,
        quantity: Number(item.quantity),
        price: item.price == null ? null : Number(item.price).toFixed(2),
        status: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    };
    orders.unshift(created);
    return send(201, created);
  }

  // Open orders: pending with nobody assigned, oldest first - like
  // fetchOpenOrders in server/routes/order_helpers.js.
  if (pathname === '/api/orders/open' && req.method === 'GET') {
    if (needsAuth()) return undefined;
    if (user.role !== 'taker') return send(403, { error: 'Only takers can view open orders' });
    const open = orders
      .filter((o) => o.status === 'pending' && o.AssignedTakers.length === 0)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const limit = Math.min(Number(searchParams.get('limit')) || 20, 20);
    const offset = Number(searchParams.get('offset')) || 0;
    return send(200, {
      orders: open.slice(offset, offset + limit).map((o) => forRole(o, 'taker')),
      pagination: { total: open.length, limit, offset },
    });
  }

  // First come, first served - mirrors POST /api/orders/:id/claim.
  const claimMatch = pathname.match(/^\/api\/orders\/(\d+)\/claim$/);
  if (claimMatch && req.method === 'POST') {
    if (needsAuth()) return undefined;
    if (user.role !== 'taker') return send(403, { error: 'Only takers can take open orders' });
    const order = orders.find((o) => o.id === Number(claimMatch[1]));
    if (!order) return send(404, { error: 'Order not found' });
    const mine = order.AssignedTakers.some((t) => t.id === user.id);
    if (!mine) {
      if (order.status !== 'pending' || order.AssignedTakers.length > 0) {
        return send(409, { error: 'This order has already been taken', code: 'ORDER_TAKEN' });
      }
      order.AssignedTakers = [user];
    }
    return send(200, forRole(order, 'taker'));
  }

  const orderMatch = pathname.match(/^\/api\/orders\/(\d+)$/);
  if (orderMatch) {
    if (needsAuth()) return undefined;
    const id = Number(orderMatch[1]);
    const index = orders.findIndex((o) => o.id === id);
    if (index === -1) return send(404, { error: 'Order not found' });

    if (req.method === 'DELETE') {
      orders.splice(index, 1);
      return send(200, { message: 'deleted' });
    }

    if (req.method === 'PUT') {
      const body = await readBody();
      const order = orders[index];

      // Open orders, as in routes/orders.js: openToAll clears the takers; an
      // active order may only be left without one when that was asked for
      // (or it already was open); an order in progress released this way
      // starts over as pending.
      const wantsOpen = body.openToAll === true;
      if (wantsOpen && (body.assignedTakerIds || []).length > 0) {
        return send(400, { error: 'An open order cannot also be assigned to takers' });
      }
      const wasOpen = order.status === 'pending' && order.AssignedTakers.length === 0;
      const nextTakers = wantsOpen
        ? []
        : Array.isArray(body.assignedTakerIds)
          ? users.filter((u) => body.assignedTakerIds.includes(u.id))
          : order.AssignedTakers;
      const nextStatus = body.status || order.status;
      let release = false;
      if (['pending', 'in-progress'].includes(nextStatus) && nextTakers.length === 0) {
        release = !body.status && order.status === 'in-progress' && wantsOpen;
        if (!release && (nextStatus === 'in-progress' || (!wantsOpen && !wasOpen))) {
          return send(400, { error: 'Active orders require at least one taker' });
        }
      }

      if (body.title !== undefined) order.title = body.title;
      if (body.description !== undefined) order.description = body.description;
      if (body.city !== undefined) order.city = body.city;
      if (body.status !== undefined) order.status = body.status;
      if (body.accounterId !== undefined) {
        order.accounterId = body.accounterId;
        order.Accounter = users.find((u) => u.id === body.accounterId) || null;
      }
      if (wantsOpen || Array.isArray(body.assignedTakerIds)) order.AssignedTakers = nextTakers;
      if (release) order.status = 'pending';
      if (Array.isArray(body.items)) {
        // Faithful to the real server: routes/orders.js destroys every
        // OrderItem row and bulkCreates replacements, so item IDs ROTATE on
        // every update. Any ID the client is holding dies here. The server
        // matches items by NAME, not ID - see statusProvidedByName.
        //
        // Takers never receive prices, so they cannot send them back. The real
        // server restores each price from the existing row (by name) on a
        // taker's write; without that, every taker tap would erase the order's
        // prices. Replicated here so the behaviour can actually be tested.
        const priceByName = new Map(
          (order.Items || []).map((i) => [String(i.name).toLowerCase(), i.price ?? null])
        );
        // Like the real server: when an item arrives WITHOUT a `status` key,
        // keep the status it already has. The client omits status on
        // structural edits so a tick made meanwhile is not overwritten.
        const statusByName = new Map((order.Items || []).map((i) => [i.name, i.status ?? null]));
        const isTaker = user.role === 'taker';

        order.Items = body.items.map((item) => {
          const key = String(item.name).toLowerCase();
          const price = isTaker
            ? priceByName.get(key) ?? null
            : item.price == null
              ? null
              : Number(item.price).toFixed(2);
          const status = Object.prototype.hasOwnProperty.call(item, 'status')
            ? item.status ?? null
            : statusByName.get(item.name) ?? null;
          return {
            id: nextItemId++,
            name: item.name,
            quantity: Number(item.quantity),
            price,
            status,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        });
      }
      order.updatedAt = new Date().toISOString();
      return send(200, forRole(order, user.role));
    }
  }

  // Single-item status change: mirrors PATCH /api/orders/:id/items/status.
  // Updates one row and does NOT rotate ids (unlike PUT), with the same
  // authorization rule as the real server.
  const itemStatusMatch = pathname.match(/^\/api\/orders\/(\d+)\/items\/status$/);
  if (itemStatusMatch && req.method === 'PATCH') {
    if (needsAuth()) return undefined;
    const order = orders.find((o) => o.id === Number(itemStatusMatch[1]));
    if (!order) return send(404, { error: 'Order not found' });

    const allowed =
      user.role === 'admin' ||
      order.makerId === user.id ||
      order.AssignedTakers.some((t) => t.id === user.id);
    if (!allowed) return send(403, { error: 'Not authorized to edit this order' });
    if (user.role === 'taker' && ['completed', 'entered_erp'].includes(order.status)) {
      return send(409, { error: `Order is ${order.status} and can no longer be changed` });
    }

    const body = await readBody();
    if (!Object.prototype.hasOwnProperty.call(body, 'status')) {
      return send(400, { error: 'status is required (use null to clear it)' });
    }
    if (![null, 'collected', 'unavailable'].includes(body.status)) {
      return send(400, { error: 'Invalid status value' });
    }
    const item = order.Items.find((i) => i.name === body.name);
    if (!item) return send(404, { error: `Item "${body.name}" not found in this order` });

    item.status = body.status;
    item.updatedAt = new Date().toISOString();
    return send(200, forRole(order, user.role));
  }

  // ---- telegram ----
  // The mock has no bot, so report the feature as off; the client then hides
  // the "link Telegram" card. The real flow is covered by
  // server/test/telegram.test.mjs against a fake Telegram API.
  if (pathname === '/api/telegram/status') {
    if (needsAuth()) return undefined;
    return send(200, { enabled: false, canLink: false, botUsername: null, linked: false, telegramUsername: null, linkedAt: null });
  }

  // ---- items ----
  if (pathname === '/api/items/suggestions') {
    if (needsAuth()) return undefined;
    const q = (searchParams.get('q') || '').toLowerCase();
    return send(200, PRODUCTS.filter((p) => p.toLowerCase().includes(q)).slice(0, 6));
  }

  // ---- notifications ----
  if (pathname === '/api/notifications/vapid-public-key') {
    return send(200, { key: null, enabled: false });
  }
  if (pathname === '/api/notifications' && req.method === 'GET') {
    if (needsAuth()) return undefined;
    return send(200, notifications);
  }
  if (pathname === '/api/notifications/read-all' && req.method === 'PUT') {
    notifications.forEach((n) => (n.isRead = true));
    return send(200, { message: 'ok' });
  }
  if (/^\/api\/notifications\/\d+\/read$/.test(pathname) && req.method === 'PUT') {
    const id = Number(pathname.split('/')[3]);
    const n = notifications.find((x) => x.id === id);
    if (n) n.isRead = true;
    return send(200, n || {});
  }

  // ---- admin ----
  if (pathname === '/api/admin/stats') {
    if (needsAuth()) return undefined;
    return send(200, {
      totalUsers: users.length,
      pendingApprovals: users.filter((u) => !u.isApproved).length,
      totalOrders: orders.length,
      activeOrders: orders.filter((o) => ACTIVE.includes(o.status)).length,
      usersByRole: users.reduce((acc, u) => ({ ...acc, [u.role]: (acc[u.role] || 0) + 1 }), {}),
      recentActivity: activityLogs.slice(0, 8),
    });
  }
  // Pending = never approved; approved once but not now = deactivated
  // (approvedAt set), exactly as in routes/admin.js.
  if (pathname === '/api/admin/users/pending') {
    if (needsAuth()) return undefined;
    return send(200, users.filter((u) => !u.isApproved && !u.approvedAt && u.role !== 'admin'));
  }
  if (pathname === '/api/admin/users') {
    if (needsAuth()) return undefined;
    return send(200, users.map(({ passwordChanged, ...u }) => ({
      ...u,
      approvedAt: u.approvedAt ?? (u.isApproved ? '2026-01-01T00:00:00.000Z' : null),
    })));
  }
  if (/^\/api\/admin\/users\/\d+\/approve$/.test(pathname)) {
    const id = Number(pathname.split('/')[4]);
    const u = users.find((x) => x.id === id);
    if (u) {
      u.isApproved = true;
      u.approvedAt = new Date().toISOString();
    }
    return send(200, { message: 'approved' });
  }
  if (/^\/api\/admin\/users\/\d+\/deactivate$/.test(pathname) && req.method === 'PUT') {
    const id = Number(pathname.split('/')[4]);
    const u = users.find((x) => x.id === id);
    if (!u) return send(404, { error: 'User not found' });
    if (u.role === 'admin') return send(400, { error: 'An admin account cannot be deactivated' });
    u.isApproved = false;
    u.approvedAt = u.approvedAt || new Date().toISOString();
    const activeAssignments = orders.filter((o) => ACTIVE.includes(o.status) && o.AssignedTakers.some((t) => t.id === id)).length;
    return send(200, { message: 'User deactivated', activeAssignments });
  }
  if (/^\/api\/admin\/users\/\d+\/password$/.test(pathname) && req.method === 'PUT') {
    const { newPassword } = await readBody();
    if (!newPassword || String(newPassword).length < 6) return send(400, { error: 'Password must be at least 6 characters' });
    return send(200, { message: 'Password changed' });
  }
  // Like the real server: only someone who never worked on an order can be deleted.
  if (/^\/api\/admin\/users\/\d+$/.test(pathname) && req.method === 'DELETE') {
    const id = Number(pathname.split('/')[4]);
    const i = users.findIndex((x) => x.id === id);
    if (i === -1) return send(404, { error: 'User not found' });
    const worked = orders.some((o) => o.makerId === id || o.accounterId === id || o.AssignedTakers.some((t) => t.id === id));
    if (worked) {
      return send(409, {
        error: 'This user has orders or history, so deleting them would erase it. Deactivate the account instead.',
        code: 'USER_HAS_HISTORY',
      });
    }
    users.splice(i, 1);
    return send(200, { message: 'deleted' });
  }
  if (pathname === '/api/admin/logs' || pathname === '/api/admin/logs/all') {
    if (needsAuth()) return undefined;
    const limit = Number(searchParams.get('limit')) || 50;
    return send(200, activityLogs.slice(0, limit));
  }

  // ---- backups (shape of server/routes/backups.js; no real files) ----
  if (pathname === '/api/admin/backups') {
    if (needsAuth()) return undefined;
    if (user.role !== 'admin') return send(403, { error: 'Admin access required' });
    if (req.method === 'POST') {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const name = `ama-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-manual.sql.gz`;
      const entry = { name, size: 48_000 + mockBackups.length * 1_500, createdAt: d.toISOString(), label: 'manual' };
      mockBackups.unshift(entry);
      return send(201, { ...entry, tables: { Orders: orders.length, Users: users.length } });
    }
    const latest = mockBackups[0];
    return send(200, {
      status: {
        auto: true,
        dir: 'C:\\AMA\\backups',
        copyDir: null,
        keepDays: 30,
        running: false,
        lastSuccess: latest ? { name: latest.name, at: latest.createdAt, size: latest.size } : null,
        lastError: null,
        lastCopyError: null,
      },
      backups: mockBackups,
    });
  }
  const backupDownload = pathname.match(/^\/api\/admin\/backups\/([^/]+)\/download$/);
  if (backupDownload) {
    if (needsAuth()) return undefined;
    if (user.role !== 'admin') return send(403, { error: 'Admin access required' });
    const name = decodeURIComponent(backupDownload[1]);
    if (!mockBackups.some((b) => b.name === name)) return send(404, { error: 'Backup not found' });
    await delay();
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${name}"` });
    res.end(require('zlib').gzipSync('-- AMA Order System backup\n-- (mock)\n-- Backup complete\n'));
    return undefined;
  }

  if (pathname === '/api/health') return send(200, { ok: true, mock: true });

  return send(404, { error: `No mock route for ${req.method} ${pathname}` });
});

server.listen(PORT, () => {
  console.log(`Mock AMA API listening on http://localhost:${PORT}`);
  console.log('Log in with any of:', users.map((u) => u.username).join(', '), '(any password)');
});
