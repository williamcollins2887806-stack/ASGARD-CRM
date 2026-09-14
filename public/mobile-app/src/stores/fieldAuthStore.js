import { create } from 'zustand';

const FIELD_TOKEN_KEY = 'field_token';
const FIELD_EMPLOYEE_KEY = 'field_employee';
const FIELD_HAS_PIN_KEY = 'field_has_pin';
/** Бамп → сброс только JWT. Профиль и «PIN создан» на устройстве сохраняем. */
const FIELD_AUTH_EPOCH_KEY = 'field_auth_epoch';
const FIELD_AUTH_EPOCH = '6'; // 6: SMS XOR PIN; эпоха не трёт has_pin

function readEmployee() {
  try {
    return JSON.parse(localStorage.getItem(FIELD_EMPLOYEE_KEY) || 'null');
  } catch {
    return null;
  }
}

function hasPinLocal() {
  return localStorage.getItem(FIELD_HAS_PIN_KEY) === '1';
}

function setHasPinLocal(yes) {
  if (yes) localStorage.setItem(FIELD_HAS_PIN_KEY, '1');
  else localStorage.removeItem(FIELD_HAS_PIN_KEY);
}

function applyAuthEpoch() {
  if (localStorage.getItem(FIELD_AUTH_EPOCH_KEY) === FIELD_AUTH_EPOCH) return;
  // Только JWT: иначе после обновления приложения снова гонят на SMS+PIN
  localStorage.removeItem(FIELD_TOKEN_KEY);
  localStorage.setItem(FIELD_AUTH_EPOCH_KEY, FIELD_AUTH_EPOCH);
}

applyAuthEpoch();

const initialToken = localStorage.getItem(FIELD_TOKEN_KEY) || null;
const initialEmployee = readEmployee();

/**
 * Устройство помнит работника + PIN → только ввод PIN (без SMS).
 * Иначе idle → телефон/SMS → создание PIN (если ещё нет).
 */
function initialStatus() {
  // Валидный JWT в LS = уже прошли PIN в этой сессии устройства
  if (initialToken) return 'authenticated';
  if (hasPinLocal() && initialEmployee?.id) return 'need_pin';
  return 'idle';
}

export const useFieldAuthStore = create((set, get) => ({
  token: initialToken,
  employee: initialEmployee,
  loading: false,
  error: null,
  pendingResetPin: false,
  // 'idle' | 'need_pin_setup' | 'need_pin' | 'authenticated'
  status: initialStatus(),

  checkPhone: async (phone) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/field/auth/check-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка проверки номера');
      set({ loading: false });
      return data;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  /** Телефон с PIN на сервере → экран PIN, без SMS. */
  rememberForPin: (employee) => {
    if (!employee?.id) return;
    localStorage.setItem(FIELD_EMPLOYEE_KEY, JSON.stringify(employee));
    setHasPinLocal(true);
    localStorage.removeItem(FIELD_TOKEN_KEY);
    set({
      employee,
      token: null,
      status: 'need_pin',
      error: null,
      pendingResetPin: false,
    });
  },

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

  verifyCode: async (phone, code, { resetPin = false } = {}) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/field/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          code,
          reset_pin: resetPin || get().pendingResetPin,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Неверный код');

      localStorage.setItem(FIELD_TOKEN_KEY, data.token);
      localStorage.setItem(FIELD_EMPLOYEE_KEY, JSON.stringify(data.employee));

      // authenticated | need_pin_setup (сервер больше не шлёт need_pin после SMS)
      let status = data.status;
      if (status !== 'authenticated' && status !== 'need_pin_setup') {
        status = data.has_pin ? 'authenticated' : 'need_pin_setup';
      }

      if (status === 'authenticated' || data.has_pin) {
        setHasPinLocal(true);
      } else {
        setHasPinLocal(false);
      }

      set({
        token: data.token,
        employee: data.employee,
        status,
        pendingResetPin: false,
        loading: false,
      });
      return data;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

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

      setHasPinLocal(true);
      set({ status: 'authenticated', loading: false });
      return data;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

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
      if (!res.ok) {
        const err = new Error(data.error || 'Неверный PIN');
        err.status = res.status;
        throw err;
      }

      setHasPinLocal(true);
      set({ status: 'authenticated', loading: false });
      return data;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  pinLogin: async (pin) => {
    set({ loading: true, error: null });
    try {
      const employee = get().employee || readEmployee();
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
      setHasPinLocal(true);

      set({
        token: data.token,
        employee: data.employee,
        status: 'authenticated',
        loading: false,
      });
      return data;
    } catch (err) {
      if (/PIN не установлен|SMS/i.test(err.message || '')) {
        setHasPinLocal(false);
      }
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  /** Забыл PIN: SMS с reset + новый PIN. */
  beginForgotPin: () => {
    localStorage.removeItem(FIELD_TOKEN_KEY);
    setHasPinLocal(false);
    set({
      token: null,
      status: 'idle',
      pendingResetPin: true,
      error: null,
    });
  },

  /** JWT умер — остаёмся на PIN-экране, без SMS. */
  clearExpiredToken: () => {
    localStorage.removeItem(FIELD_TOKEN_KEY);
    const employee = get().employee || readEmployee();
    if (hasPinLocal() && employee?.id) {
      set({ token: null, employee, status: 'need_pin', error: null });
    } else {
      set({ token: null, status: 'idle', error: null });
    }
  },

  subscribePush: async () => {
    try {
      const token = get().token;
      if (!token) return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      const reg = await navigator.serviceWorker.ready;
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
    } catch {
      /* non-critical */
    }
  },

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
    setHasPinLocal(false);
    set({
      token: null,
      employee: null,
      status: 'idle',
      error: null,
      pendingResetPin: false,
    });
  },

  checkSession: async () => {
    applyAuthEpoch();
    const employee = get().employee || readEmployee();
    const token = get().token || localStorage.getItem(FIELD_TOKEN_KEY);

    if (hasPinLocal() && employee?.id) {
      set({
        employee,
        token: token || null,
        status: 'need_pin',
      });
      return;
    }

    set({
      employee: employee || null,
      token: null,
      status: 'idle',
    });
  },

  clearError: () => set({ error: null }),
}));

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
