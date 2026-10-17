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

export async function updateUserEmail(id, email) {
  return api.put(`/api/admin/users/${id}/email`, { email });
}

export async function deleteUser(id) {
  return api.delete(`/api/admin/users/${id}`);
}

export async function fetchAdminOrders() {
  const data = await api.get('/api/admin/orders');
  return parseOr(orderListSchema, data, [], 'adminOrders');
}

export async function deleteAdminOrder(id) {
  return api.delete(`/api/admin/orders/${id}`);
}

export async function fetchActivityLogs({ limit = 50, all = false } = {}) {
  const path = all ? '/api/admin/logs/all' : '/api/admin/logs';
  const data = await api.get(path, { limit });
  return parseOr(logListSchema, data, [], 'activityLogs');
}
