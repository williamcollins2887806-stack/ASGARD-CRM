/**
 * Field Worker API client
 * Uses field_token (separate from CRM asgard_token)
 * Base: /api/field
 */

const BASE_URL = '/api/field';
const TOKEN_KEY = 'field_token';

class FieldApiClient {
  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    };

    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.href = '/m/field-login';
      throw new Error('Сессия истекла');
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || err.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  get(endpoint) {
    return this.request(endpoint);
  }

  post(endpoint, data) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  put(endpoint, data) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
}

export const fieldApi = new FieldApiClient();
