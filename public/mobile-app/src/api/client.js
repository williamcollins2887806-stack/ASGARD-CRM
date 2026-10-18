import { reportClientError } from '@/lib/reportClientError';

const BASE_URL = '/api';

function isFieldSurface() {
  if (typeof window === 'undefined') return false;
  const p = window.location.pathname || '';
  return p.startsWith('/m/field') || p === '/m/field-login';
}

function isPinRequiredMessage(body = {}) {
  const msg = `${body.message || ''} ${body.error || ''}`;
  return /PIN|пин/i.test(msg);
}

async function markNeedPin() {
  try {
    const { useAuthStore } = await import('@/stores/authStore');
    useAuthStore.setState({ pinStatus: 'need_pin', loading: false });
  } catch { /* store may be unavailable outside app shell */ }
}

function handleAuthFailure(clearTokenFn, status, options = {}) {
  const skipRedirect = options.skipAuthRedirect === true || isFieldSurface();
  clearTokenFn();
  if (!skipRedirect) {
    window.location.href = '/m/welcome';
  }
  const err = new Error(status === 401 ? 'Unauthorized' : 'Session expired');
  err.status = status;
  throw err;
}

/** 403 «нужен PIN» — уводим на /pin без сброса сессии; прочий 403 — просто
 *  «нет прав» на модуль (токен валиден). Сессию сбрасываем ТОЛЬКО на 401. */
async function handleUnauthorizedResponse(response, clearTokenFn, options = {}) {
  const skipRedirect = options.skipAuthRedirect === true || isFieldSurface();

  if (response.status === 401) {
    handleAuthFailure(clearTokenFn, 401, options);
  }

  if (response.status === 403) {
    const body = await response.json().catch(() => ({}));
    if (isPinRequiredMessage(body)) {
      await markNeedPin();
      if (!skipRedirect) {
        const path = window.location.pathname || '';
        if (!path.startsWith('/m/pin') && path !== '/m/pin') {
          window.location.href = '/m/pin';
        }
      }
      const err = new Error(body.message || body.error || 'Требуется подтверждение PIN');
      err.status = 403;
      err.body = body;
      err.code = 'NEED_PIN';
      throw err;
    }
    // ВАЖНО (17.10.2026): 403 — это НЕ истёкшая сессия, а валидный токен без прав
    // на конкретный модуль/роль. Истёкший или отозванный токен сервер отдаёт как 401
    // (fastify.authenticate → catch → 401), поэтому стирать токен и выбрасывать на
    // /m/welcome здесь нельзя. Иначе один экран без прав для роли (например
    // /api/payroll-dashboard/* для DIRECTOR_DEV) разлогинивал пользователя целиком.
    // Отдаём ошибку вызывающему коду — он показывает пустое состояние/заглушку.
    const err = new Error(body.message || body.error || 'Недостаточно прав');
    err.status = 403;
    err.body = body;
    throw err;
  }
}

class ApiClient {
  getToken() {
    return localStorage.getItem('asgard_token');
  }

  setToken(token) {
    localStorage.setItem('asgard_token', token);
  }

  clearToken() {
    localStorage.removeItem('asgard_token');
  }

  async request(endpoint, options = {}) {
    const { skipAuthRedirect, ...fetchOptions } = options;
    const token = this.getToken();
    const headers = {
      ...(fetchOptions.body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
      ...fetchOptions.headers,
    };

    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...fetchOptions,
      headers,
    });

    if (response.status === 401 || response.status === 403) {
      await handleUnauthorizedResponse(response, () => this.clearToken(), { skipAuthRedirect });
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      // Человекочитаемое: «что случилось» + «что делать» (поле hint от сервера).
      const parts = [];
      if (error.message) parts.push(String(error.message));
      else if (error.error && typeof error.error === 'string') parts.push(String(error.error));
      if (error.hint) parts.push(String(error.hint));
      const err = new Error(parts.length ? parts.join(' ') : `Ошибка запроса (${response.status}). Повторите действие.`);
      err.status = response.status;
      err.body = error;
      if (response.status >= 500) {
        reportClientError({
          source: 'm',
          kind: 'api',
          message: err.message,
          endpoint: `${BASE_URL}${endpoint}`,
          status: response.status,
        });
      }
      throw err;
    }

    return await response.json();
  }

  extractRows(response) {
    if (Array.isArray(response)) return response;
    if (response?.rows) return response.rows;
    if (response?.data) return response.data;
    if (response?.items) return response.items;
    if (response && typeof response === 'object') {
      for (const key of Object.keys(response)) {
        if (Array.isArray(response[key])) return response[key];
      }
    }
    return [];
  }

  get(endpoint, options = {}) {
    return this.request(endpoint, options);
  }

  post(endpoint, data, options = {}) {
    return this.request(endpoint, {
      method: 'POST',
      ...(data !== undefined && { body: JSON.stringify(data) }),
      ...options,
    });
  }

  // Загрузка файла (multipart) — НЕ ставим Content-Type, браузер задаёт boundary сам.
  async postForm(endpoint, formData, options = {}) {
    const { skipAuthRedirect } = options;
    const token = this.getToken();
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { ...(token && { Authorization: `Bearer ${token}` }) },
      body: formData,
    });
    if (response.status === 401 || response.status === 403) {
      await handleUnauthorizedResponse(response, () => this.clearToken(), { skipAuthRedirect });
    }
    if (!response.ok) {
      const e = await response.json().catch(() => ({}));
      const parts = [];
      if (e.message) parts.push(String(e.message));
      else if (e.error && typeof e.error === 'string') parts.push(String(e.error));
      if (e.hint) parts.push(String(e.hint));
      const err = new Error(parts.length ? parts.join(' ') : `Ошибка запроса (${response.status}). Повторите действие.`);
      err.status = response.status;
      err.body = e;
      if (response.status >= 500) {
        reportClientError({
          source: 'm',
          kind: 'api',
          message: err.message,
          endpoint: `${BASE_URL}${endpoint}`,
          status: response.status,
        });
      }
      throw err;
    }
    return await response.json();
  }

  put(endpoint, data, options = {}) {
    return this.request(endpoint, {
      method: 'PUT',
      ...(data !== undefined && { body: JSON.stringify(data) }),
      ...options,
    });
  }

  patch(endpoint, data, options = {}) {
    return this.request(endpoint, {
      method: 'PATCH',
      ...(data !== undefined && { body: JSON.stringify(data) }),
      ...options,
    });
  }

  delete(endpoint, options = {}) {
    return this.request(endpoint, { method: 'DELETE', ...options });
  }
}

export const api = new ApiClient();
