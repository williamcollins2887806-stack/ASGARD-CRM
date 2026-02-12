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
      name: 'RATE-3: Response has rate limit headers (or localhost whitelisted)',
      run: async () => {
        const resp = await rawFetch('GET', '/api/tenders', {
          headers: { 'Authorization': `Bearer ${require('../config').getToken('TO')}` }
        });
        assert(resp.status === 200, `expected 200, got ${resp.status}`);
        const rl = resp.headers.get('x-ratelimit-limit');
        const rr = resp.headers.get('x-ratelimit-remaining');
        // Localhost may be whitelisted from rate limit — headers absent is OK
        const isLocalhost = BASE_URL.includes('localhost') || BASE_URL.includes('127.0.0.1');
        if (!isLocalhost) {
          assert(rl !== null, 'x-ratelimit-limit header should be present');
          assert(rr !== null, 'x-ratelimit-remaining header should be present');
        }
      }
    },
    {
      name: 'RATE-4: x-ratelimit-remaining is a number >= 0 (or whitelisted)',
      run: async () => {
        const resp = await rawFetch('GET', '/api/tenders', {
          headers: { 'Authorization': `Bearer ${require('../config').getToken('TO')}` }
        });
        const rr = resp.headers.get('x-ratelimit-remaining');
        const isLocalhost = BASE_URL.includes('localhost') || BASE_URL.includes('127.0.0.1');
        if (rr !== null) {
          const num = parseInt(rr, 10);
          assert(!isNaN(num) && num >= 0, `x-ratelimit-remaining should be >= 0, got ${rr}`);
        } else if (!isLocalhost) {
          assert(false, 'x-ratelimit-remaining should be present');
        }
      }
    },
    {
      name: 'RATE-5: x-ratelimit-limit >= 100 (or whitelisted)',
      run: async () => {
        const resp = await rawFetch('GET', '/api/tenders', {
          headers: { 'Authorization': `Bearer ${require('../config').getToken('TO')}` }
        });
        const rl = resp.headers.get('x-ratelimit-limit');
        const isLocalhost = BASE_URL.includes('localhost') || BASE_URL.includes('127.0.0.1');
        if (rl !== null) {
          const num = parseInt(rl, 10);
          assert(!isNaN(num) && num >= 100, `x-ratelimit-limit should be >= 100, got ${rl}`);
        } else if (!isLocalhost) {
          assert(false, 'x-ratelimit-limit should be present');
        }
      }
    }
  ]
};
