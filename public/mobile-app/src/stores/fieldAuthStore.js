import { create } from 'zustand';

const FIELD_TOKEN_KEY = 'field_token';
const FIELD_EMPLOYEE_KEY = 'field_employee';

export const useFieldAuthStore = create((set, get) => ({
  token: localStorage.getItem(FIELD_TOKEN_KEY) || null,
  employee: JSON.parse(localStorage.getItem(FIELD_EMPLOYEE_KEY) || 'null'),
  loading: false,
  error: null,
  // 'idle' | 'need_pin_setup' | 'need_pin' | 'authenticated'
  status: localStorage.getItem(FIELD_TOKEN_KEY) ? 'authenticated' : 'idle',

  // Step 1: Request SMS code
  requestCode: async (phone) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/field/auth/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка отправки кода');
      set({ loading: false });
      return data;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  // Step 2: Verify SMS code
  verifyCode: async (phone, code) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/field/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Неверный код');

      localStorage.setItem(FIELD_TOKEN_KEY, data.token);
      localStorage.setItem(FIELD_EMPLOYEE_KEY, JSON.stringify(data.employee));

      set({
        token: data.token,
        employee: data.employee,
        status: 'authenticated', // PIN removed — direct login after SMS
        loading: false,
      });
      return data;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  // Step 3a: Setup PIN (first time)
  setupPin: async (pin) => {
    set({ loading: true, error: null });
    try {
      const token = get().token;
      const res = await fetch('/api/field/auth/setup-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка установки PIN');

      set({ status: 'authenticated', loading: false });
      return data;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  // Step 3b: Verify PIN (returning user)
  verifyPin: async (pin) => {
    set({ loading: true, error: null });
    try {
      const token = get().token;
      const res = await fetch('/api/field/auth/verify-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Неверный PIN');

      set({ status: 'authenticated', loading: false });
      return data;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  // PIN login (JWT expired, employee_id known)
  pinLogin: async (pin) => {
    set({ loading: true, error: null });
    try {
      const employee = get().employee;
      if (!employee?.id) throw new Error('Необходима SMS-авторизация');

      const res = await fetch('/api/field/auth/pin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employee.id, pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка входа');

      localStorage.setItem(FIELD_TOKEN_KEY, data.token);
      localStorage.setItem(FIELD_EMPLOYEE_KEY, JSON.stringify(data.employee));

      set({
        token: data.token,
        employee: data.employee,
        status: 'authenticated',
        loading: false,
      });
      return data;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  // Subscribe to push notifications
  subscribePush: async () => {
    try {
      const token = get().token;
      if (!token) return;

      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      const reg = await navigator.serviceWorker.ready;

      // Get VAPID key
      const vapidRes = await fetch('/api/push/vapid-key');
      const { publicKey } = await vapidRes.json();
      if (!publicKey) return;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const subJson = sub.toJSON();
      await fetch('/api/field/auth/push-subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
        }),
      });
    } catch (err) {
      // Non-critical — don't break login flow
    }
  },

  // Logout
  logout: () => {
    const token = localStorage.getItem(FIELD_TOKEN_KEY);
    if (token) {
      fetch('/api/field/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem(FIELD_TOKEN_KEY);
    localStorage.removeItem(FIELD_EMPLOYEE_KEY);
    set({ token: null, employee: null, status: 'idle', error: null });
  },

  // Check if session is still valid
  checkSession: async () => {
    const token = get().token;
    if (!token) {
      // No token but have employee → need PIN login
      if (get().employee?.id) {
        set({ status: 'need_pin' });
      }
      return;
    }

    try {
      const res = await fetch('/api/field/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        set({ status: 'authenticated' });
      } else {
        // Token expired
        localStorage.removeItem(FIELD_TOKEN_KEY);
        set({ token: null, status: get().employee ? 'need_pin' : 'idle' });
      }
    } catch {
      set({ status: get().employee ? 'need_pin' : 'idle' });
    }
  },

  clearError: () => set({ error: null }),
}));

// Helper: convert VAPID key
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
