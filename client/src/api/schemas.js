import { z } from 'zod';

/**
 * Runtime shapes for every API response we consume.
 *
 * This is the safety net that TypeScript would otherwise give us. The important
 * job it does is coercion, not just validation:
 *
 *   - Postgres DECIMAL comes back through Sequelize as a STRING. OrderItem.quantity
 *     has a getter that coerces to Number, but `price` does NOT - so price arrives
 *     as "12.50". Without the coerce below, `price * quantity` silently produces
 *     garbage. See server/models/OrderItem.js.
 *   - Takers never receive `price` at all (server/routes/order_helpers.js
 *     getItemAttributesForRole strips it), so it must be optional, not just nullable.
 */

const nullableNumber = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

export const userSchema = z
  .object({
    id: z.coerce.number(),
    username: z.string().default(''),
    role: z.string().default(''),
    isApproved: z.boolean().optional(),
    approved: z.boolean().optional(),
    prefersDark: z.boolean().optional(),
    createdAt: z.string().nullable().optional(),
    approvedAt: z.string().nullable().optional(),
  })
  .transform((u) => ({
    ...u,
    isApproved: u.isApproved ?? u.approved ?? false,
    prefersDark: u.prefersDark ?? false,
  }));

export const orderItemSchema = z.object({
  id: z.coerce.number(),
  name: z.string().default(''),
  quantity: z.coerce.number().default(0),
  // Optional because takers don't get it; nullable because it can be unset.
  price: nullableNumber.optional(),
  status: z.enum(['collected', 'unavailable']).nullable().default(null),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
});

export const orderLogSchema = z.object({
  id: z.coerce.number(),
  previousDescription: z.string().default(''),
  newDescription: z.string().default(''),
  createdAt: z.string().nullable().optional(),
  changedBy: z.coerce.number().nullable().optional(),
  Editor: z
    .object({ id: z.coerce.number(), username: z.string() })
    .nullable()
    .optional(),
});

export const ORDER_STATUSES = [
  'pending',
  'in-progress',
  'completed',
  'archived',
  'entered_erp',
];

export const orderSchema = z.object({
  id: z.coerce.number(),
  title: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  status: z.string().default('pending'),
  city: z.string().nullable().default(null),
  makerId: z.coerce.number().nullable().optional(),
  accounterId: z.coerce.number().nullable().optional(),
  // MySQL BOOLEAN is TINYINT(1): accept 1/0 as well as true/false.
  isOnline: z.preprocess((v) => v === true || v === 1 || v === '1', z.boolean()).default(false),
  isUrgent: z.preprocess((v) => v === true || v === 1 || v === '1', z.boolean()).default(false),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  Maker: userSchema.nullable().optional(),
  Accounter: userSchema.nullable().optional(),
  AssignedTakers: z.array(userSchema).default([]),
  Items: z.array(orderItemSchema).default([]),
  History: z.array(orderLogSchema).default([]),
});

export const paginationSchema = z.object({
  total: z.coerce.number().default(0),
  limit: z.coerce.number().default(20),
  offset: z.coerce.number().default(0),
});

/** Role endpoints return { orders, pagination }; some legacy ones return a bare array. */
export const orderListSchema = z
  .union([
    z.object({ orders: z.array(orderSchema), pagination: paginationSchema.optional() }),
    z.array(orderSchema),
  ])
  .transform((data) =>
    Array.isArray(data)
      ? { orders: data, pagination: { total: data.length, limit: data.length, offset: 0 } }
      : { orders: data.orders, pagination: data.pagination ?? { total: data.orders.length, limit: 20, offset: 0 } }
  );

export const notificationSchema = z.object({
  id: z.coerce.number(),
  message: z.string().default(''),
  isRead: z.boolean().default(false),
  type: z.string().default('info'),
  orderId: z.coerce.number().nullable().optional(),
  createdAt: z.string().nullable().optional(),
});

// The person on a log entry. Lenient on purpose - only the name is shown, and
// the stats used to send nothing else (the strict user check then failed).
const logUserSchema = z
  .object({
    id: z.coerce.number().optional(),
    username: z.string().default(''),
    role: z.string().optional(),
  })
  .nullable()
  .optional();

export const activityLogSchema = z
  .object({
    id: z.coerce.number().optional(),
    // /api/admin/logs/all mixes 'activity' entries with 'order_change' ones.
    type: z.string().optional(),
    action: z.string().default(''),
    targetType: z.string().nullable().default(null),
    targetId: z.coerce.number().nullable().optional(),
    details: z.unknown().nullable().optional(),
    ipAddress: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    User: logUserSchema,
    user: logUserSchema, // older servers named it in lower case on /logs/all
  })
  .transform(({ user, ...log }) => ({ ...log, User: log.User ?? user ?? null }));

/**
 * A list of log entries, each checked on its own: an entry the app cannot
 * read is left out (and logged), instead of failing the whole list. One bad
 * entry used to empty the log page and zero every count on the admin overview.
 */
export const activityListSchema = z
  .array(z.unknown())
  .default([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const result = activityLogSchema.safeParse(entry);
      if (result.success) return [result.data];
      console.error('[api] log entry skipped:', result.error.issues, entry);
      return [];
    })
  );

export const statsSchema = z.object({
  totalUsers: z.coerce.number().default(0),
  pendingApprovals: z.coerce.number().default(0),
  totalOrders: z.coerce.number().default(0),
  activeOrders: z.coerce.number().default(0),
  usersByRole: z.record(z.string(), z.coerce.number()).default({}),
  recentActivity: activityListSchema,
});

export const authResponseSchema = z.object({
  token: z.string(),
  user: userSchema,
  // Login only: the admin signed in with the seeded default password.
  mustChangePassword: z.boolean().optional(),
});

/**
 * Parse defensively: if the server sends something unexpected we log it and
 * fall back rather than blanking the screen. An order-entry tool being slightly
 * wrong beats it being blank.
 */
export function parseOr(schema, data, fallback, context = 'response') {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  console.error(`[api] ${context} failed validation:`, result.error.issues, data);
  return fallback;
}
