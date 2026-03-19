const BASE_URL = '/api';

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

    if (response.status === 401 || response.status === 403) {
      this.clearToken();
      window.location.href = '/welcome';
      throw new Error(response.status === 401 ? 'Unauthorized' : 'Session expired');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `HTTP ${response.status}`);
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

export const api = new ApiClient();
