import { api } from './client';
import { statsSchema, userSchema, activityLogSchema, orderSchema, parseOr } from './schemas';
import { z } from 'zod';

const userListSchema = z.array(userSchema);
const logListSchema = z.array(activityLogSchema);
const orderListSchema = z.array(orderSchema);

export async function fetchStats() {
  const data = await api.get('/api/admin/stats');
  return parseOr(
    statsSchema,
    data,
    { totalUsers: 0, pendingApprovals: 0, totalOrders: 0, activeOrders: 0, usersByRole: {}, recentActivity: [] },
    'stats'
  );
}

export async function fetchUsers() {
  const data = await api.get('/api/admin/users');
  return parseOr(userListSchema, data, [], 'users');
}

export async function fetchPendingUsers() {
  const data = await api.get('/api/admin/users/pending');
  return parseOr(userListSchema, data, [], 'pendingUsers');
}

export async function approveUser(id) {
  return api.put(`/api/admin/users/${id}/approve`, {});
}

export async function deleteUser(id) {
  return api.delete(`/api/admin/users/${id}`);
}

/** Resolves to { activeAssignments }: orders still waiting on this person. */
export async function deactivateUser(id) {
  return api.put(`/api/admin/users/${id}/deactivate`, {});
}

export async function resetUserPassword(id, newPassword) {
  return api.put(`/api/admin/users/${id}/password`, { newPassword });
}

export async function fetchAdminOrders() {
  const data = await api.get('/api/admin/orders');
  return parseOr(orderListSchema, data, [], 'adminOrders');
}

export async function deleteAdminOrder(id) {
  return api.delete(`/api/admin/orders/${id}`);
}

const backupSchema = z.object({
  name: z.string(),
  size: z.coerce.number().default(0),
  createdAt: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
});

const backupsResponseSchema = z.object({
  status: z
    .object({
      auto: z.boolean().default(false),
      dir: z.string().nullable().optional(),
      copyDir: z.string().nullable().optional(),
      keepDays: z.coerce.number().optional(),
      running: z.boolean().default(false),
      lastSuccess: z.object({ name: z.string(), at: z.string(), size: z.coerce.number() }).passthrough().nullable().optional(),
      lastError: z.object({ message: z.string(), at: z.string() }).nullable().optional(),
      lastCopyError: z.object({ message: z.string(), at: z.string() }).nullable().optional(),
    })
    .passthrough(),
  backups: z.array(backupSchema).default([]),
});

export async function fetchBackups() {
  const data = await api.get('/api/admin/backups');
  return parseOr(backupsResponseSchema, data, { status: { auto: false, running: false }, backups: [] }, 'backups');
}

export async function createBackup() {
  return api.post('/api/admin/backups');
}

/** Save a backup file to the admin's computer. */
export async function downloadBackup(name) {
  const blob = await api.download(`/api/admin/backups/${encodeURIComponent(name)}/download`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function fetchActivityLogs({ limit = 50, all = false } = {}) {
  const path = all ? '/api/admin/logs/all' : '/api/admin/logs';
  const data = await api.get(path, { limit });
  return parseOr(logListSchema, data, [], 'activityLogs');
}
