/**
 * REPORTS - Analytics & reporting
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

module.exports = {
  name: 'REPORTS (Отчёты)',
  tests: [
    {
      name: 'ADMIN reads dashboard',
      run: async () => {
        const resp = await api('GET', '/api/reports/dashboard', { role: 'ADMIN' });
        assertOk(resp, 'dashboard');
        if (resp.data) {
          assert(typeof resp.data === 'object', 'dashboard should be object');
        }
      }
    },
    {
      name: 'PM reads dashboard',
      run: async () => {
        const resp = await api('GET', '/api/reports/dashboard', { role: 'PM' });
        assertOk(resp, 'PM dashboard');
        if (resp.data) {
          assert(typeof resp.data === 'object', 'PM dashboard should be object');
        }
      }
    },
    {
      name: 'Monthly report has expected structure',
      run: async () => {
        const resp = await api('GET', '/api/reports/generate/monthly?year=2026&month=1', { role: 'ADMIN' });
        assertOk(resp, 'monthly report');
        if (resp.data) {
          assert(
            typeof resp.data === 'object' || Array.isArray(resp.data),
            'monthly report should be object or array'
          );
        }
      }
    },
    {
      name: 'Quarterly report has expected structure',
      run: async () => {
        const resp = await api('GET', '/api/reports/generate/quarterly?year=2026&quarter=1', { role: 'ADMIN' });
        assertOk(resp, 'quarterly report');
        if (resp.data) {
          assert(
            typeof resp.data === 'object' || Array.isArray(resp.data),
            'quarterly report should be object or array'
          );
        }
      }
    },
    {
      name: 'Yearly report',
      run: async () => {
        const resp = await api('GET', '/api/reports/generate/yearly?year=2025', { role: 'ADMIN' });
        assertOk(resp, 'yearly report');
        if (resp.data) {
          assert(
            typeof resp.data === 'object' || Array.isArray(resp.data),
            'yearly report should be object or array'
          );
        }
      }
    },
    {
      name: 'Monthly breakdown',
      run: async () => {
        const resp = await api('GET', '/api/reports/monthly?year=2026', { role: 'ADMIN' });
        assertOk(resp, 'monthly breakdown');
      }
    },
    {
      name: 'PM performance',
      run: async () => {
        const resp = await api('GET', '/api/reports/pm-performance?year=2026', { role: 'ADMIN' });
        assertOk(resp, 'pm performance');
      }
    },
    {
      name: 'Sales funnel',
      run: async () => {
        const resp = await api('GET', '/api/reports/funnel', { role: 'ADMIN' });
        assertOk(resp, 'funnel');
      }
    },
    {
      name: 'Saved reports',
      run: async () => {
        const resp = await api('GET', '/api/reports/saved', { role: 'ADMIN' });
        assertOk(resp, 'saved');
      }
    },
    {
      name: 'DIRECTOR_GEN reads dashboard',
      run: async () => {
        const resp = await api('GET', '/api/reports/dashboard', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'DIR dashboard');
        if (resp.data) {
          assert(typeof resp.data === 'object', 'DIR dashboard should be object');
        }
      }
    }
  ]
};
