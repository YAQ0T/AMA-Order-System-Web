/**
 * Thin fetch wrapper around the Node API.
 *
 * Base URL resolution mirrors the Flutter ApiClient: an explicit VITE_API_URL
 * wins, otherwise we use the current origin. In dev, Vite proxies /api to the
 * Node server (see vite.config.js) and in production the Node server serves the
 * built client - so in both cases same-origin is the right default.
 *
 * Note: the old React front defaulted to port 3004, which is stale. The server
 * defaults to 6001 now.
 */

const configured = (import.meta.env.VITE_API_URL || '').trim();

function resolveBaseUrl() {
  if (!configured) return '';
  if (configured.includes('localhost') || configured.includes('127.0.0.1')) {
    // A localhost value is almost always a leftover from another machine's
    // config; prefer the origin we were actually served from.
    return '';
  }
  return configured.replace(/\/$/, '');
}

export const API_BASE_URL = resolveBaseUrl();

let authToken = null;
let onUnauthorized = null;

export function setAuthToken(token) {
  authToken = token || null;
}

/** Registered by the auth store so a 401/403 can bounce the user to login. */
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function buildUrl(path, query) {
  const url = `${API_BASE_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request(method, path, { query, body, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    // Network-level failure: server down, wrong port, blocked by firewall.
    throw new ApiError('تعذّر الاتصال بالخادم', 0, { cause: String(cause) });
  }

  // 401/403 on an authenticated call means the token is gone or stale.
  if ((response.status === 401 || response.status === 403) && authToken && onUnauthorized) {
    // Only bounce on 401, or on a 403 from the token check (not a role denial,
    // which legitimately returns 403 with a JSON body).
    const isTokenFailure = response.status === 401 || response.headers.get('content-length') === '0';
    if (isTokenFailure) onUnauthorized();
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && (data.error || data.message)) ||
      (typeof data === 'string' && data) ||
      `خطأ ${response.status}`;
    throw new ApiError(message, response.status, data);
  }

  return data;
}

export const api = {
  get: (path, query, opts) => request('GET', path, { query, ...opts }),
  post: (path, body, opts) => request('POST', path, { body, ...opts }),
  put: (path, body, opts) => request('PUT', path, { body, ...opts }),
  patch: (path, body, opts) => request('PATCH', path, { body, ...opts }),
  delete: (path, opts) => request('DELETE', path, { ...opts }),
};
