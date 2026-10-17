import { create } from 'zustand';
import { setAuthToken, setUnauthorizedHandler } from '../api/client';
import * as authApi from '../api/auth';

const TOKEN_KEY = 'ama.token';
const USER_KEY = 'ama.user';

/**
 * The JWT lives in localStorage, matching how the Flutter app uses
 * SharedPreferences. Worth knowing: the server issues 365-day tokens, so a
 * token lifted via XSS stays valid for a year. See the README security notes.
 */
function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function decodeJwt(token) {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return JSON.parse(decodeURIComponent(escape(atob(padded))));
  } catch {
    return null;
  }
}

function applyTheme(prefersDark) {
  document.documentElement.classList.toggle('dark', Boolean(prefersDark));
}

export const useAuth = create((set, get) => ({
  user: null,
  token: null,
  initializing: true,
  error: null,

  isAuthenticated: () => Boolean(get().token && get().user),
  isApproved: () => Boolean(get().user?.isApproved),

  /** Restore a session on page load, then refresh the profile in the background. */
  init: async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      set({ initializing: false });
      return;
    }

    setAuthToken(token);

    // Show the cached user immediately so a reload doesn't flash the login page.
    const cached = readStoredUser() || (() => {
      const claims = decodeJwt(token);
      return claims
        ? {
            id: claims.id,
            username: claims.username,
            role: claims.role,
            isApproved: claims.isApproved ?? false,
            prefersDark: false,
          }
        : null;
    })();

    if (cached) {
      applyTheme(cached.prefersDark);
      set({ token, user: cached });
    }
    set({ initializing: false });

    // Then confirm against the server. A failure here is not a logout - the
    // server may just be briefly unreachable on the LAN.
    try {
      const fresh = await authApi.me();
      localStorage.setItem(USER_KEY, JSON.stringify(fresh));
      applyTheme(fresh.prefersDark);
      set({ user: fresh });
    } catch {
      /* keep the cached session */
    }
  },

  login: async (username, password) => {
    set({ error: null });
    const { token, user } = await authApi.login(username, password);
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    setAuthToken(token);
    applyTheme(user.prefersDark);
    set({ token, user });
    return user;
  },

  signup: async (username, password, role) => {
    set({ error: null });
    return authApi.register(username, password, role);
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setAuthToken(null);
    applyTheme(false);
    set({ token: null, user: null, error: null });
  },

  /** Optimistic theme toggle with rollback, like the Flutter setThemePreference. */
  setTheme: async (prefersDark) => {
    const previous = get().user;
    if (!previous) return;

    const optimistic = { ...previous, prefersDark };
    applyTheme(prefersDark);
    localStorage.setItem(USER_KEY, JSON.stringify(optimistic));
    set({ user: optimistic });

    try {
      const updated = await authApi.updateTheme(prefersDark);
      localStorage.setItem(USER_KEY, JSON.stringify(updated));
      applyTheme(updated.prefersDark);
      set({ user: updated });
    } catch (err) {
      applyTheme(previous.prefersDark);
      localStorage.setItem(USER_KEY, JSON.stringify(previous));
      set({ user: previous });
      throw err;
    }
  },
}));

// A dead token should drop us back to the login screen rather than leaving the
// UI stuck on endless failing requests.
setUnauthorizedHandler(() => {
  const { token } = useAuth.getState();
  if (token) useAuth.getState().logout();
});
