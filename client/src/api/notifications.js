import { api } from './client';
import { notificationSchema, parseOr } from './schemas';
import { z } from 'zod';

const listSchema = z.array(notificationSchema);

export async function fetchNotifications() {
  const data = await api.get('/api/notifications');
  return parseOr(listSchema, data, [], 'notifications');
}

export async function markRead(id) {
  return api.put(`/api/notifications/${id}/read`, {});
}

export async function markAllRead() {
  return api.put('/api/notifications/read-all', {});
}

export async function fetchVapidKey() {
  try {
    const data = await api.get('/api/notifications/vapid-public-key');
    return data?.enabled ? data.key : null;
  } catch {
    return null;
  }
}

export async function subscribePush(subscription) {
  return api.post('/api/notifications/subscribe', subscription);
}
