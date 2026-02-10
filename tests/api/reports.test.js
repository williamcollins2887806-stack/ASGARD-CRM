/**
 * REPORTS - Analytics & reporting
 */
const { api, assert, assertOk } = require('../config');

module.exports = {
  name: 'REPORTS (Отчёты)',
  tests: [
    {
      name: 'ADMIN reads dashboard',
      run: async () => {
        const resp = await api('GET', '/api/reports/dashboard', { role: 'ADMIN' });
        assertOk(resp, 'dashboard');
      }
    },
    {
      name: 'PM reads dashboard',
      run: async () => {
        const resp = await api('GET', '/api/reports/dashboard', { role: 'PM' });
        assertOk(resp, 'PM dashboard');
      }
    },
    {
      name: 'Monthly report',
      run: async () => {
        const resp = await api('GET', '/api/reports/generate/monthly?year=2026&month=1', { role: 'ADMIN' });
        assertOk(resp, 'monthly report');
      }
    },
    {
      name: 'Quarterly report',
      run: async () => {
        const resp = await api('GET', '/api/reports/generate/quarterly?year=2026&quarter=1', { role: 'ADMIN' });
        assertOk(resp, 'quarterly report');
      }
    },
    {
      name: 'Yearly report',
      run: async () => {
        const resp = await api('GET', '/api/reports/generate/yearly?year=2025', { role: 'ADMIN' });
        assertOk(resp, 'yearly report');
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
        assert(resp.status < 500, `saved: ${resp.status}`);
      }
    },
    {
      name: 'DIRECTOR_GEN reads dashboard',
      run: async () => {
        const resp = await api('GET', '/api/reports/dashboard', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'DIR dashboard');
      }
    }
  ]
};
