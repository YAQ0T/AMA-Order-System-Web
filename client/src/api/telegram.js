import { api } from './client';

/** { enabled, botUsername, linked, telegramUsername, linkedAt } */
export function fetchTelegramStatus() {
  return api.get('/api/telegram/status');
}

/** { url, expiresAt } - a one-time t.me link that completes the link on Start. */
export function createTelegramLink() {
  return api.post('/api/telegram/link', {});
}

export function unlinkTelegram() {
  return api.delete('/api/telegram/link');
}
