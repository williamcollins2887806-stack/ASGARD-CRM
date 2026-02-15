/**
 * EXPORTS — Tests for export/download endpoints
 */
const { api, assert, assertOk, skip } = require('../config');

module.exports = {
  name: 'EXPORTS (Экспорт и скачивание)',
  tests: [
    // ── TMC Export ──
    {
      name: 'TMC requests export endpoint',
      run: async () => {
        const resp = await api('GET', '/api/tmc-requests/export', { role: 'ADMIN' });
        assert(resp.status < 500, `tmc export should not 5xx, got ${resp.status}`);
      }
    },
    // ── TKP PDF ──
    {
      name: 'TKP PDF endpoint (no items)',
      run: async () => {
        // Create a TKP then try PDF
        const create = await api('POST', '/api/tkp', {
          role: 'ADMIN',
          body: { title: 'Export test TKP', amount: 100000 }
        });
        assertOk(create, 'create tkp for PDF');
        const tkpId = create.data?.tkp?.id || create.data?.id;
        if (!tkpId) return;

        const resp = await api('GET', `/api/tkp/${tkpId}/pdf`, { role: 'ADMIN' });
        assert(resp.status < 500, `tkp pdf should not 5xx, got ${resp.status}`);

        await api('DELETE', `/api/tkp/${tkpId}`, { role: 'ADMIN' });
      }
    },
    // ── Pass request PDF ──
    {
      name: 'Pass request PDF endpoint',
      run: async () => {
        const create = await api('POST', '/api/pass-requests', {
          role: 'ADMIN',
          body: { object_name: 'PDF Test', pass_date_from: '2026-03-01', pass_date_to: '2026-03-31' }
        });
        assertOk(create, 'create pass for PDF');
        const prId = create.data?.pass_request?.id || create.data?.id;
        if (!prId) return;

        const resp = await api('GET', `/api/pass-requests/${prId}/pdf`, { role: 'ADMIN' });
        assert(resp.status < 500, `pass pdf should not 5xx, got ${resp.status}`);

        await api('DELETE', `/api/pass-requests/${prId}`, { role: 'ADMIN' });
      }
    },
    // ── TMC Excel per item ──
    {
      name: 'TMC request Excel endpoint',
      run: async () => {
        const create = await api('POST', '/api/tmc-requests', {
          role: 'ADMIN',
          body: { title: 'Excel test TMC', description: 'test' }
        });
        assertOk(create, 'create tmc for Excel');
        const tmcId = create.data?.tmc_request?.id || create.data?.id;
        if (!tmcId) return;

        const resp = await api('GET', `/api/tmc-requests/${tmcId}/excel`, { role: 'ADMIN' });
        assert(resp.status < 500, `tmc excel should not 5xx, got ${resp.status}`);

        await api('DELETE', `/api/tmc-requests/${tmcId}`, { role: 'ADMIN' });
      }
    },
    // ── Permit application Excel ──
    {
      name: 'Permit application Excel endpoint',
      run: async () => {
        // Ensure at least one permit application exists for export
        let testAppId = null;
        const list = await api('GET', '/api/permit-applications', { role: 'ADMIN' });
        assertOk(list, 'list permit apps');
        let apps = Array.isArray(list.data) ? list.data : (list.data?.applications || list.data?.data || []);

        if (apps.length === 0) {
          // Create a test permit application so export has data
          const createResp = await api('POST', '/api/permit-applications', {
            role: 'ADMIN',
            body: { employee_name: 'Export Test Worker', permit_type: 'fire_safety', status: 'pending' }
          });
          if (createResp.ok) {
            testAppId = createResp.data?.application?.id || createResp.data?.item?.id || createResp.data?.id;
            if (testAppId) apps = [{ id: testAppId }];
          }
        }

        if (apps.length === 0) { skip('no permit applications to export'); return; }

        const resp = await api('GET', `/api/permit-applications/${apps[0].id}/excel`, { role: 'ADMIN' });
        assert(resp.status < 500, `permit app excel should not 5xx, got ${resp.status}`);

        // Cleanup
        if (testAppId) {
          await api('DELETE', `/api/permit-applications/${testAppId}`, { role: 'ADMIN' }).catch(() => {});
        }
      }
    },
    // ── Payroll payments export ──
    {
      name: 'Payroll payments export endpoint',
      run: async () => {
        const resp = await api('GET', '/api/payroll/payments/export', { role: 'ADMIN' });
        assert(resp.status < 500, `payroll export should not 5xx, got ${resp.status}`);
      }
    },
    // ── Reports endpoints ──
    {
      name: 'Reports main endpoint',
      run: async () => {
        const resp = await api('GET', '/api/reports', { role: 'ADMIN' });
        assert(resp.status < 500, `reports should not 5xx, got ${resp.status}`);
      }
    },
    // ── Equipment analytics ──
    {
      name: 'Equipment analytics by PM',
      run: async () => {
        const resp = await api('GET', '/api/equipment/analytics/by-pm', { role: 'ADMIN' });
        assert(resp.status < 500, `equipment analytics should not 5xx, got ${resp.status}`);
      }
    },
    // ── Tenders analytics ──
    {
      name: 'Tenders analytics team',
      run: async () => {
        const resp = await api('GET', '/api/tenders/analytics/team', { role: 'ADMIN' });
        assert(resp.status < 500, `tenders analytics should not 5xx, got ${resp.status}`);
      }
    },
    // ── Works analytics ──
    {
      name: 'Works analytics team',
      run: async () => {
        const resp = await api('GET', '/api/works/analytics/team', { role: 'ADMIN' });
        assert(resp.status < 500, `works analytics should not 5xx, got ${resp.status}`);
      }
    },
    // ── Invoice stats ──
    {
      name: 'Invoice stats summary',
      run: async () => {
        const resp = await api('GET', '/api/invoices/stats/summary', { role: 'ADMIN' });
        assertOk(resp, 'invoice stats');
      }
    },
    // ── Acts stats ──
    {
      name: 'Acts stats summary',
      run: async () => {
        const resp = await api('GET', '/api/acts/stats/summary', { role: 'ADMIN' });
        assertOk(resp, 'acts stats');
      }
    }
  ]
};
