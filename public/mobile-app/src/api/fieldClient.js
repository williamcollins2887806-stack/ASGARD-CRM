/**
 * Field Worker API client
 * Uses field_token (separate from CRM asgard_token)
 * Base: /api/field
 */

import { reportClientError } from '@/lib/reportClientError';

const BASE_URL = '/api/field';
const TOKEN_KEY = 'field_token';

class FieldApiClient {
  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    };

    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      const rememberedPin = localStorage.getItem('field_has_pin') === '1';
      let hasEmployee = false;
      try {
        hasEmployee = !!JSON.parse(localStorage.getItem('field_employee') || 'null')?.id;
      } catch { /* */ }
      try {
        const { useFieldAuthStore } = await import('@/stores/fieldAuthStore');
        useFieldAuthStore.getState().clearExpiredToken();
      } catch { /* */ }
      // Устройство с PIN — снова PIN, не телефон/SMS
      window.location.href = rememberedPin && hasEmployee
        ? '/m/field/pin-entry'
        : '/m/field-login';
      throw new Error('Сессия истекла');
    }

    if (response.status === 403) {
      const err = await response.json().catch(() => ({}));
      if (err.code === 'NEED_PIN_SETUP') {
        try {
          const { useFieldAuthStore } = await import('@/stores/fieldAuthStore');
          useFieldAuthStore.setState({ status: 'need_pin_setup' });
        } catch { /* */ }
        window.location.href = '/m/field/pin-setup';
        throw new Error(err.error || 'Сначала создайте PIN');
      }
      const e = new Error(err.error || err.message || 'Нет доступа');
      e.status = 403;
      e.body = err;
      throw e;
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const e = new Error(err.error || err.message || `HTTP ${response.status}`);
      e.status = response.status;
      e.body = err;
      if (response.status >= 500) {
        reportClientError({
          source: 'm',
          kind: 'api',
          message: e.message,
          endpoint: `${BASE_URL}${endpoint}`,
          status: response.status,
        });
      }
      throw e;
    }

    return response.json();
  }

  get(endpoint) {
    return this.request(endpoint);
  }

  post(endpoint, data) {
    return this.request(endpoint, {
      method: 'POST',
      ...(data !== undefined && { body: JSON.stringify(data) }),
    });
  }

  put(endpoint, data) {
    return this.request(endpoint, {
      method: 'PUT',
      ...(data !== undefined && { body: JSON.stringify(data) }),
    });
  }

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
}

export const fieldApi = new FieldApiClient();
