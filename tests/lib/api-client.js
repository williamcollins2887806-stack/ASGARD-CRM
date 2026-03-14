/**
 * HTTP API client for setup/verification/cleanup operations
 */

const { API_URL, TIMEOUTS } = require('../config');

class ApiClient {
  constructor(token) {
    this.token = token;
    this._fetch = null;
  }

  async _getFetch() {
    if (!this._fetch) {
      this._fetch = (await import('node-fetch')).default;
    }
    return this._fetch;
  }

  async request(method, endpoint, body = null) {
    const fetch = await this._getFetch();
    const url = `${API_URL}${endpoint}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      timeout: TIMEOUTS.apiCall,
    };
    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const resp = await fetch(url, options);
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    return { status: resp.status, ok: resp.ok, data };
  }

  async get(endpoint) { return this.request('GET', endpoint); }
  async post(endpoint, body) { return this.request('POST', endpoint, body); }
  async put(endpoint, body) { return this.request('PUT', endpoint, body); }
  async delete(endpoint) { return this.request('DELETE', endpoint); }

  // --- Convenience methods for test data ---

  async createRecord(table, data) {
    return this.post(`/data/${table}`, data);
  }

  async getRecord(table, id) {
    return this.get(`/data/${table}/${id}`);
  }

  async deleteRecord(table, id) {
    return this.delete(`/data/${table}/${id}`);
  }

  async listRecords(table, query = '') {
    return this.get(`/data/${table}${query ? '?' + query : ''}`);
  }

  // --- Specific entity methods ---

  async createTender(data) {
    return this.post('/tenders', data);
  }

  async getTenders(query = '') {
    return this.get(`/tenders${query ? '?' + query : ''}`);
  }

  async updateTender(id, data) {
    return this.put(`/tenders/${id}`, data);
  }

  async createWork(data) {
    return this.post('/works', data);
  }

  async getWorks(query = '') {
    return this.get(`/works${query ? '?' + query : ''}`);
  }

  async updateWork(id, data) {
    return this.put(`/works/${id}`, data);
  }
}

module.exports = { ApiClient };
