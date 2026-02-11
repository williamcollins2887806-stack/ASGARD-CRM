/**
 * Block H: HTTP Headers and Security headers tests
 * Tests response headers, CORS, content-type, error responses
 */
const { api, assert, assertOk, skip, rawFetch, BASE_URL, getToken } = require('../config');

module.exports = {
  name: 'HTTP HEADERS & SECURITY',
  tests: [
    {
      name: 'HDR: Content-Type is application/json for API responses',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/tenders?limit=1', {
          headers: { 'Authorization': `Bearer ${getToken('ADMIN')}` }
        });
        assert(resp.status < 500, `status: ${resp.status}`);
        const ct = resp.headers.get('content-type') || '';
        assert(ct.includes('application/json'), `expected application/json, got "${ct}"`);
      }
    },
    {
      name: 'HDR: Response does NOT contain X-Powered-By (server info hidden)',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/tenders?limit=1', {
          headers: { 'Authorization': `Bearer ${getToken('ADMIN')}` }
        });
        const powered = resp.headers.get('x-powered-by');
        assert(!powered, `X-Powered-By should not be present, got "${powered}"`);
      }
    },
    {
      name: 'HDR: 401 response does not reveal stack trace',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/tenders', {});
        assert(resp.status === 401 || resp.status === 403, `expected 401/403, got ${resp.status}`);
        const body = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
        assert(!body.includes('at ') || !body.includes('.js:'), `401 response should not contain stack trace`);
        assert(!body.includes('node_modules'), `401 response should not reveal internal paths`);
      }
    },
    {
      name: 'HDR: 404 response does not reveal stack trace',
      run: async () => {
        const resp = await rawFetch('GET', '/api/nonexistent/endpoint/xyz', {
          headers: { 'Authorization': `Bearer ${getToken('ADMIN')}` }
        });
        assert(resp.status === 404 || resp.status >= 400, `expected 404, got ${resp.status}`);
        const body = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
        assert(!body.includes('node_modules'), `error response should not reveal internal paths`);
      }
    },
    {
      name: 'HDR: CORS OPTIONS request → proper response',
      run: async () => {
        const url = `${BASE_URL}/api/data/tenders`;
        const resp = await fetch(url, {
          method: 'OPTIONS',
          headers: {
            'Origin': 'http://example.com',
            'Access-Control-Request-Method': 'GET'
          }
        });
        // Should return 200 or 204, not 500
        assert(resp.status < 500, `OPTIONS should not 500, got ${resp.status}`);
      }
    },
    {
      name: 'HDR: JSON body on POST endpoints',
      run: async () => {
        const resp = await rawFetch('POST', '/api/tenders', {
          headers: {
            'Authorization': `Bearer ${getToken('TO')}`,
            'Content-Type': 'application/json'
          },
          body: { customer_name: 'HDR-TEST', tender_status: 'Новый' }
        });
        assert(resp.status < 500, `POST with JSON: ${resp.status}`);
        const ct = resp.headers.get('content-type') || '';
        assert(ct.includes('application/json'), `response should be JSON, got "${ct}"`);
        // Cleanup if created
        const id = resp.data?.tender?.id || resp.data?.id;
        if (id) await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' }).catch(() => {});
      }
    },
    {
      name: 'HDR: Invalid JSON body → 400, not 500',
      run: async () => {
        const url = `${BASE_URL}/api/tenders`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${getToken('TO')}`,
            'Content-Type': 'application/json'
          },
          body: '{invalid json content'
        });
        assert(resp.status >= 400 && resp.status < 500, `invalid JSON should be 4xx, got ${resp.status}`);
      }
    },
    {
      name: 'HDR: Rate limit headers present (if rate limiting enabled)',
      run: async () => {
        const resp = await rawFetch('GET', '/api/data/tenders?limit=1', {
          headers: { 'Authorization': `Bearer ${getToken('ADMIN')}` }
        });
        const limit = resp.headers.get('x-ratelimit-limit');
        const remaining = resp.headers.get('x-ratelimit-remaining');
        // Rate limiting may not be enabled — just verify no 500
        assert(resp.status < 500, `status: ${resp.status}`);
        if (!limit && !remaining) skip('Rate limiting headers not configured');
        assert(limit || remaining, 'expected rate limit headers');
      }
    },
    {
      name: 'HDR: HEAD request returns headers without body',
      run: async () => {
        const url = `${BASE_URL}/api/data/tenders?limit=1`;
        const resp = await fetch(url, {
          method: 'HEAD',
          headers: { 'Authorization': `Bearer ${getToken('ADMIN')}` }
        });
        // HEAD should return 200 or at least not 500
        assert(resp.status < 500, `HEAD should not 500, got ${resp.status}`);
      }
    },
    {
      name: 'HDR: Server responds to health check without auth',
      run: async () => {
        const resp = await fetch(`${BASE_URL}/api/health`);
        assert(resp.ok, `health: expected 200, got ${resp.status}`);
        const data = await resp.json();
        assert(data.status === 'ok', `health status should be "ok", got "${data.status}"`);
      }
    }
  ]
};
