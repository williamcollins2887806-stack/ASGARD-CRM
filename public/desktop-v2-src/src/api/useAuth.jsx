import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { closeGlobalSSE } from '@/hooks/useGlobalSSE';
import { closeAllConductorStreams } from '@/hooks/useConductorRunStream';

const AuthCtx = createContext({ user: null, token: null, ready: false, logout: () => {} });

function readToken() {
  try { return localStorage.getItem('asgard_token') || ''; } catch { return ''; }
}
function readUser() {
  try {
    const raw = localStorage.getItem('asgard_user');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(readToken());
  const [user, setUser] = useState(readUser());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token) { setReady(true); return; }
    let cancel = false;
    fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancel) return;
        if (data && data.user) {
          setUser(data.user);
          try { localStorage.setItem('asgard_user', JSON.stringify(data.user)); } catch { /* noop */ }
        } else {
          setUser(null);
          setToken('');
        }
      })
      .catch(() => {})
      .finally(() => !cancel && setReady(true));
    return () => { cancel = true; };
  }, [token]);

  const logout = useCallback(() => {
    // G-7 localStorage audit: сносим всё user-bound, оставляем UI-prefs (тема, sidebar).
    // Сохраняем: asgard_v2_theme, asgard_theme (legacy), asgard_v2_sb_collapsed,
    //           proc_view_v2, wh_eq_view, permits_last_check (system-wide).
    // Чистим: asgard_token (JWT), asgard_user (PII: email/login/name/patronymic),
    //         asgard_v2_home_layout_*, mc_last_run_id, mc_last_event_id_*.
    try {
      localStorage.removeItem('asgard_token');
      localStorage.removeItem('asgard_user');
      // legacy токен от vanilla
      localStorage.removeItem('auth_token');
      // user-specific UI-prefs
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith('asgard_v2_home_layout_')) toRemove.push(k);
        else if (k === 'mc_last_run_id') toRemove.push(k);
        else if (k.startsWith('mc_last_event_id_')) toRemove.push(k);
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
      // session-storage cleanup (return_url, chunk-reload marker)
      try {
        sessionStorage.removeItem('asgard_return_url');
      } catch { /* noop */ }
    } catch { /* noop */ }
    setToken('');
    setUser(null);
    // Рвём глобальный SSE-канал — иначе после logout он попытается
    // переподключиться с протухшим токеном и засыплет backend 401-ами.
    try { closeGlobalSSE(); } catch { /* noop */ }
    try { closeAllConductorStreams(); } catch { /* noop */ }
    // CRIT-фикс: было `href='/#/welcome'` — при logout юзер /v2/ уходил в vanilla v1.
    // Теперь hash сохраняет текущий префикс (/v2/welcome).
    window.location.hash = '#/welcome';
  }, []);

  return <AuthCtx.Provider value={{ user, token, ready, logout }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
