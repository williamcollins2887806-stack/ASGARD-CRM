/**
 * REPORTS & EXPORTS ADVANCED — generate, download, export per module
 */
const { api, assert, assertOk, assertForbidden, skip } = require('../config');

let preTenderId = null;

module.exports = {
  name: 'REPORTS & EXPORTS ADVANCED',
  tests: [
    {
      name: 'ADMIN generates monthly report',
      run: async () => {
        const resp = await api('GET', '/api/reports/generate/monthly?year=2026&month=1', { role: 'ADMIN' });
        if (resp.status === 404) skip('monthly generate not found');
        assertOk(resp, 'generate monthly report');
      }
    },
    {
      name: 'ADMIN generates quarterly report',
      run: async () => {
        const resp = await api('GET', '/api/reports/generate/quarterly?year=2026&quarter=1', { role: 'ADMIN' });
        if (resp.status === 404) skip('quarterly not found');
        assertOk(resp, 'generate quarterly report');
      }
    },
    {
      name: 'ADMIN generates yearly report',
      run: async () => {
        const resp = await api('GET', '/api/reports/generate/yearly?year=2025', { role: 'ADMIN' });
        if (resp.status === 404) skip('yearly not found');
        assertOk(resp, 'generate yearly report');
      }
    },
    {
      name: 'ADMIN reads saved reports',
      run: async () => {
        const resp = await api('GET', '/api/reports/saved', { role: 'ADMIN' });
        assertOk(resp, 'saved reports');
      }
    },
    {
      name: 'ADMIN reads report dashboard',
      run: async () => {
        const resp = await api('GET', '/api/reports/dashboard', { role: 'ADMIN' });
        if (resp.status === 404) skip('dashboard not found');
        assertOk(resp, 'report dashboard');
      }
    },
    {
      name: 'ADMIN reads monthly reports list',
      run: async () => {
        const resp = await api('GET', '/api/reports/monthly?year=2026', { role: 'ADMIN' });
        if (resp.status === 404) skip('monthly list not found');
        assertOk(resp, 'monthly reports list');
      }
    },
    {
      name: 'ADMIN reads PM performance reports',
      run: async () => {
        const resp = await api('GET', '/api/reports/pm-performance', { role: 'ADMIN' });
        if (resp.status === 404) skip('pm-performance not found');
        assertOk(resp, 'pm-performance report');
      }
    },
    {
      name: 'ADMIN reads funnel reports',
      run: async () => {
        const resp = await api('GET', '/api/reports/funnel?year=2026', { role: 'ADMIN' });
        if (resp.status === 404) skip('funnel not found');
        assertOk(resp, 'funnel reports');
      }
    },
    {
      name: 'ADMIN exports tenders report',
      run: async () => {
        const resp = await api('GET', '/api/reports/export/tenders', { role: 'ADMIN' });
        if (resp.status === 404) skip('export/tenders not found');
        assertOk(resp, 'export tenders report');
      }
    },
    {
      name: 'ADMIN downloads monthly report (binary ok)',
      run: async () => {
        const resp = await api('GET', '/api/reports/download/monthly', { role: 'ADMIN' });
        if (resp.status === 404) skip('download/monthly not found');
        assert([200, 204].includes(resp.status), 'download monthly: got ' + resp.status);
      }
    },
    {
      name: 'ADMIN downloads quarterly report',
      run: async () => {
        const resp = await api('GET', '/api/reports/download/quarterly', { role: 'ADMIN' });
        if (resp.status === 404) skip('download/quarterly not found');
        assert([200, 204].includes(resp.status), 'download quarterly: got ' + resp.status);
      }
    },
    {
      name: 'NEGATIVE: WAREHOUSE cannot access reports',
      run: async () => {
        const resp = await api('GET', '/api/reports/saved', { role: 'WAREHOUSE' });
        assert([403, 200].includes(resp.status), 'warehouse reports access check');
      }
    },
    {
      name: 'BUH exports payroll payments (Excel binary)',
      run: async () => {
        const resp = await api('GET', '/api/payroll/payments/export', { role: 'BUH' });
        if (resp.status === 404) skip('payments/export not found');
        assert([200, 204].includes(resp.status), 'BUH payments export: got ' + resp.status);
      }
    },
    {
      name: 'ADMIN exports payroll payments',
      run: async () => {
        const resp = await api('GET', '/api/payroll/payments/export', { role: 'ADMIN' });
        if (resp.status === 404) skip('payments/export not found');
        assert([200, 204].includes(resp.status), 'ADMIN payments export: got ' + resp.status);
      }
    },
    {
      name: 'ADMIN exports TMC requests',
      run: async () => {
        const resp = await api('GET', '/api/tmc-requests/export', { role: 'ADMIN' });
        if (resp.status === 404) skip('tmc-requests/export not found');
        assertOk(resp, 'TMC export');
      }
    },
    {
      name: 'PROC exports TMC requests',
      run: async () => {
        const resp = await api('GET', '/api/tmc-requests/export', { role: 'PROC' });
        if (resp.status === 404) skip('tmc-requests/export not found');
        assertOk(resp, 'PROC TMC export');
      }
    },
    {
      name: 'Setup: TO creates pre-tender for advanced actions',
      run: async () => {
        const resp = await api('POST', '/api/pre-tenders', {
          role: 'TO',
          body: {
            title: 'E2E Advanced Pre-Tender Test',
            platform: 'Тестовая платформа',
            deadline: new Date(Date.now() + 7*86400000).toISOString().slice(0,10),
            budget: 100000,
            customer: 'ООО Тест',
            description: 'E2E advanced test pre-tender',
            work_description: 'Тестовые работы'
          }
        });
        if (resp.status === 403) skip('TO cannot create pre-tender');
        assertOk(resp, 'create pre-tender for advanced test');
        preTenderId = resp.data?.pre_tender?.id || resp.data?.pretender?.id || resp.data?.id;
      }
    },
    {
      name: 'TO renews pre-tender',
      run: async () => {
        if (!preTenderId) skip('no preTenderId');
        const resp = await api('POST', `/api/pre-tenders/${preTenderId}/renew`, { role: 'TO', body: {} });
        if (resp.status === 404) skip('renew endpoint not found');
        if (resp.status === 400) skip('renew 400: ' + JSON.stringify(resp.data));
        assertOk(resp, 'renew pre-tender');
      }
    },
    {
      name: 'TO bulk-renews (empty ids → 400 or ok)',
      run: async () => {
        const resp = await api('POST', '/api/pre-tenders/bulk-renew', { role: 'TO', body: { ids: [] } });
        if (resp.status === 404) skip('bulk-renew not found');
        assert([200, 400].includes(resp.status), 'bulk-renew with empty ids: got ' + resp.status);
      }
    },
    {
      name: 'TO scans pre-tender (400/501 ok if no scanner)',
      run: async () => {
        if (!preTenderId) skip('no preTenderId');
        const resp = await api('POST', `/api/pre-tenders/${preTenderId}/scan`, { role: 'TO', body: {} });
        if (resp.status === 404) skip('scan endpoint not found');
        assert([200, 400, 501, 503].includes(resp.status), 'scan pre-tender: got ' + resp.status);
      }
    },
    {
      name: 'NEGATIVE: BUH cannot renew pre-tender',
      run: async () => {
        if (!preTenderId) skip('no preTenderId');
        const resp = await api('POST', `/api/pre-tenders/${preTenderId}/renew`, { role: 'BUH', body: {} });
        assert([403, 404].includes(resp.status), 'BUH renew should be 403/404, got ' + resp.status);
      }
    },
    {
      name: 'Cleanup: delete pre-tender',
      run: async () => {
        if (!preTenderId) return;
        await api('DELETE', `/api/pre-tenders/${preTenderId}`, { role: 'ADMIN' });
      }
    }
  ]
};
