import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { fetchJson, postJson } from '../utils/api.js';

const AuthContext = createContext(null);

const ACCESS_TOKEN_KEY = 'neon_access_token';
const REFRESH_TOKEN_KEY = 'neon_refresh_token';
const USER_KEY = 'neon_user';

const loadStored = () => {
  if (typeof window === 'undefined') {
    return { accessToken: null, refreshToken: null, user: null };
  }
  try {
    return {
      accessToken: window.localStorage.getItem(ACCESS_TOKEN_KEY),
      refreshToken: window.localStorage.getItem(REFRESH_TOKEN_KEY),
      user: window.localStorage.getItem(USER_KEY),
    };
  } catch (_error) {
    return { accessToken: null, refreshToken: null, user: null };
  }
};

const persistStored = ({ accessToken, refreshToken, user }) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (accessToken) {
      window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    } else {
      window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    }
    if (refreshToken) {
      window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    } else {
      window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
    if (user) {
      window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(USER_KEY);
    }
  } catch (_error) {
    // ignore storage errors
  }
};

const hydrateUser = (raw) => {
  if (!raw) {
    return null;
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }
  return raw;
};

// Auto-admin bypass for trusted deployments. Set VITE_AUTO_ADMIN_LOGIN=false to require login.
const shouldAutoAdmin = () =>
  String(import.meta.env.VITE_AUTO_ADMIN_LOGIN || 'true').toLowerCase() === 'true';

const AUTO_ADMIN_USER = {
  id: 'auto-admin',
  username: 'admin',
  roles: ['admin'],
  status: 'active',
};

export const AuthProvider = ({ children }) => {
  const stored = loadStored();
  const autoAdmin = shouldAutoAdmin();
  const [accessToken, setAccessToken] = useState(autoAdmin ? null : stored.accessToken);
  const [refreshToken, setRefreshToken] = useState(autoAdmin ? null : stored.refreshToken);
  const [user, setUser] = useState(autoAdmin ? AUTO_ADMIN_USER : hydrateUser(stored.user));
  const [status, setStatus] = useState({ loading: false, error: null });
  const [mfaState, setMfaState] = useState(null);

  const saveSession = useCallback((payload) => {
    const nextAccess = payload?.accessToken || null;
    const nextRefresh = payload?.refreshToken || null;
    const nextUser = payload?.user || null;
    setAccessToken(nextAccess);
    setRefreshToken(nextRefresh);
    setUser(nextUser);
    persistStored({ accessToken: nextAccess, refreshToken: nextRefresh, user: nextUser });
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
    setMfaState(null);
    persistStored({ accessToken: null, refreshToken: null, user: null });
  }, []);

  const login = useCallback(async ({ username, password }) => {
    if (autoAdmin) {
      setAccessToken(null);
      setRefreshToken(null);
      setUser(AUTO_ADMIN_USER);
      setStatus({ loading: false, error: null });
      return { success: true };
    }
    setStatus({ loading: true, error: null });
    try {
      const response = await postJson('/api/client/login', { username, password });
      if (response?.mfaRequired) {
        setMfaState({
          challengeToken: response.challengeToken,
          methods: response.methods || ['totp'],
        });
        setStatus({ loading: false, error: null });
        return { mfaRequired: true };
      }
      if (response?.success) {
        saveSession(response);
      }
      setStatus({ loading: false, error: null });
      return response;
    } catch (error) {
      setStatus({ loading: false, error: error?.message || 'Login failed' });
      return { success: false, error: error?.message || 'Login failed' };
    }
  }, [autoAdmin, saveSession]);

  const completeMfa = useCallback(async (code) => {
    if (autoAdmin) {
      return { success: true };
    }
    if (!mfaState?.challengeToken) {
      return { success: false, error: 'Missing challenge' };
    }
    setStatus({ loading: true, error: null });
    try {
      const response = await postJson('/api/client/login/mfa', {
        challengeToken: mfaState.challengeToken,
        code,
      });
      if (response?.success) {
        saveSession(response);
        setMfaState(null);
      }
      setStatus({ loading: false, error: null });
      return response;
    } catch (error) {
      setStatus({ loading: false, error: error?.message || 'Verification failed' });
      return { success: false, error: error?.message || 'Verification failed' };
    }
  }, [autoAdmin, mfaState, saveSession]);

  const refresh = useCallback(async () => {
    if (autoAdmin) {
      return null;
    }
    if (!refreshToken) {
      return null;
    }
    try {
      const response = await postJson('/api/client/refresh', { refreshToken });
      if (response?.success) {
        saveSession({ ...response, user });
      }
      return response;
    } catch (_error) {
      return null;
    }
  }, [autoAdmin, refreshToken, saveSession, user]);

  const logout = useCallback(async () => {
    if (autoAdmin) {
      setUser(AUTO_ADMIN_USER);
      setStatus({ loading: false, error: null });
      return;
    }
    try {
      if (accessToken) {
        await postJson(
          '/api/client/logout',
          {},
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );
      }
    } catch (_error) {
      // best-effort logout
    }
    clearSession();
  }, [accessToken, autoAdmin, clearSession]);

  const fetchProfile = useCallback(async () => {
    if (autoAdmin) {
      return AUTO_ADMIN_USER;
    }
    if (!accessToken) {
      return null;
    }
    try {
      const response = await fetchJson('/api/client/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (response?.user) {
        setUser(response.user);
        persistStored({ accessToken, refreshToken, user: response.user });
      }
      return response?.user || null;
    } catch (_error) {
      return null;
    }
  }, [accessToken, autoAdmin, refreshToken, user]);

  const value = useMemo(
    () => ({
      accessToken,
      refreshToken,
      user,
      status,
      mfaState,
      isAuthenticated: autoAdmin || Boolean(accessToken),
      login,
      completeMfa,
      refresh,
      logout,
      fetchProfile,
    }),
    [
      autoAdmin,
      accessToken,
      refreshToken,
      user,
      status,
      mfaState,
      login,
      completeMfa,
      refresh,
      logout,
      fetchProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
