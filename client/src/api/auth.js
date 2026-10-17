import { api } from './client';
import { authResponseSchema, userSchema, parseOr } from './schemas';
import { z } from 'zod';

export async function login(username, password) {
  const data = await api.post('/api/auth/login', { username, password });
  return authResponseSchema.parse(data);
}

export async function register(username, password, role) {
  return api.post('/api/auth/register', { username, password, role });
}

export async function me() {
  const data = await api.get('/api/auth/me');
  return userSchema.parse(data.user);
}

export async function updateTheme(prefersDark) {
  const data = await api.put('/api/auth/theme', { prefersDark });
  return userSchema.parse(data.user);
}

const userListSchema = z.array(userSchema);

export async function fetchTakers() {
  const data = await api.get('/api/auth/takers');
  return parseOr(userListSchema, data, [], 'takers');
}

export async function fetchAccounters() {
  const data = await api.get('/api/auth/accounters');
  return parseOr(userListSchema, data, [], 'accounters');
}
