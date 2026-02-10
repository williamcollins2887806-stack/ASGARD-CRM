/**
 * RATE LIMIT — Verify rate limit headers and behavior
 */
const {
  api, assert, assertOk, rawFetch,
  BASE_URL
} = require('../config');

module.exports = {
  name: 'RATE LIMIT (deep)',
  tests: [
    {
      name: 'RATE-1: 10 quick GET /api/tenders → all 200',
      run: async () => {
        const promises = Array.from({ length: 10 }, () =>
          api('GET', '/api/tenders', { role: 'TO' })
        );
        const results = await Promise.all(promises);
        for (const r of results) {
          assertOk(r, 'rate limit burst GET');
        }
      }
    },
    {
      name: 'RATE-2: 5 quick GET /api/works → all 200',
      run: async () => {
        const promises = Array.from({ length: 5 }, () =>
          api('GET', '/api/works', { role: 'PM' })
        );
        const results = await Promise.all(promises);
        for (const r of results) {
          assertOk(r, 'rate limit burst works');
        }
      }
    },
    {
      name: 'RATE-3: Response has rate limit headers',
      run: async () => {
        const resp = await rawFetch('GET', '/api/tenders', {
          headers: { 'Authorization': `Bearer ${require('../config').getToken('TO')}` }
        });
        assert(resp.status === 200, `expected 200, got ${resp.status}`);
        const rl = resp.headers.get('x-ratelimit-limit');
        const rr = resp.headers.get('x-ratelimit-remaining');
        assert(rl !== null, 'x-ratelimit-limit header should be present');
        assert(rr !== null, 'x-ratelimit-remaining header should be present');
      }
    },
    {
      name: 'RATE-4: x-ratelimit-remaining is a number >= 0',
      run: async () => {
        const resp = await rawFetch('GET', '/api/tenders', {
          headers: { 'Authorization': `Bearer ${require('../config').getToken('TO')}` }
        });
        const rr = resp.headers.get('x-ratelimit-remaining');
        assert(rr !== null, 'x-ratelimit-remaining should be present');
        const num = parseInt(rr, 10);
        assert(!isNaN(num) && num >= 0, `x-ratelimit-remaining should be >= 0, got ${rr}`);
      }
    },
    {
      name: 'RATE-5: x-ratelimit-limit >= 100 (reasonable limit)',
      run: async () => {
        const resp = await rawFetch('GET', '/api/tenders', {
          headers: { 'Authorization': `Bearer ${require('../config').getToken('TO')}` }
        });
        const rl = resp.headers.get('x-ratelimit-limit');
        assert(rl !== null, 'x-ratelimit-limit should be present');
        const num = parseInt(rl, 10);
        assert(!isNaN(num) && num >= 100, `x-ratelimit-limit should be >= 100, got ${rl}`);
      }
    }
  ]
};
