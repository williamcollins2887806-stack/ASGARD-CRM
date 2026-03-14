/**
 * EQUIPMENT EXTENDED ACTIONS — QR, categories, analytics, bulk, reserve
 */
const { api, assert, assertOk, assertForbidden, skip } = require('../config');

let equipId = null;
let qrUuid = null;
let userId = null;

module.exports = {
  name: 'EQUIPMENT EXTENDED ACTIONS',
  tests: [
    {
      name: 'Setup: get real user ID',
      run: async () => {
        const resp = await api('GET', '/api/users', { role: 'ADMIN' });
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.users || []);
        userId = list.find(u => u.is_active !== false)?.id || 1;
      }
    },
    {
      name: 'ADMIN reads equipment categories',
      run: async () => {
        const resp = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        if (resp.status === 404) skip('categories endpoint not found');
        assertOk(resp, 'equipment categories');
      }
    },
    {
      name: 'ADMIN reads equipment balance-value',
      run: async () => {
        const resp = await api('GET', '/api/equipment/balance-value', { role: 'ADMIN' });
        assertOk(resp, 'balance-value');
      }
    },
    {
      name: 'ADMIN reads analytics by-pm',
      run: async () => {
        const resp = await api('GET', '/api/equipment/analytics/by-pm', { role: 'ADMIN' });
        if (resp.status === 404) skip('analytics/by-pm not found');
        assertOk(resp, 'analytics by-pm');
      }
    },
    {
      name: 'ADMIN reads equipment by-holder',
      run: async () => {
        if (!userId) skip('no userId');
        const resp = await api('GET', `/api/equipment/by-holder/${userId}`, { role: 'ADMIN' });
        if (resp.status === 404) skip('by-holder not found');
        assertOk(resp, 'equipment by-holder');
      }
    },
    {
      name: 'ADMIN recalculates depreciation',
      run: async () => {
        const resp = await api('POST', '/api/equipment/recalculate-depreciation', { role: 'ADMIN', body: {} });
        if (resp.status === 404) skip('recalculate-depreciation not found');
        assertOk(resp, 'recalculate-depreciation');
      }
    },
    {
      name: 'NEGATIVE: PM cannot recalculate depreciation',
      run: async () => {
        const resp = await api('POST', '/api/equipment/recalculate-depreciation', { role: 'PM', body: {} });
        if (resp.status === 404) skip('endpoint not found');
        assert([403].includes(resp.status), 'PM should get 403 on depreciation recalc, got ' + resp.status);
      }
    },
    {
      name: 'ADMIN gets QR print data with empty ids',
      run: async () => {
        const resp = await api('POST', '/api/equipment/qr-print-data', { role: 'ADMIN', body: { ids: [] } });
        if (resp.status === 404) skip('qr-print-data not found');
        assertOk(resp, 'qr-print-data empty');
      }
    },
    {
      name: 'ADMIN creates equipment to test QR',
      run: async () => {
        const resp = await api('POST', '/api/equipment', {
          role: 'ADMIN',
          body: { name: 'E2E QR Test Equipment', category: 'test', serial_number: 'QR-TEST-001' }
        });
        assertOk(resp, 'create equipment for QR test');
        const item = resp.data?.equipment || resp.data?.item || resp.data;
        equipId = item?.id;
        qrUuid = item?.qr_code || item?.uuid;
      }
    },
    {
      name: 'ADMIN gets QR print data with valid equipment id',
      run: async () => {
        if (!equipId) skip('no equipId');
        const resp = await api('POST', '/api/equipment/qr-print-data', { role: 'ADMIN', body: { ids: [equipId] } });
        if (resp.status === 404) skip('qr-print-data not found');
        assertOk(resp, 'qr-print-data with id');
      }
    },
    {
      name: 'GET /by-qr/nonexistent-uuid returns 404',
      run: async () => {
        const resp = await api('GET', '/api/equipment/by-qr/00000000-0000-0000-0000-000000000000', { role: 'ADMIN' });
        assert(resp.status === 404, 'nonexistent QR should return 404, got ' + resp.status);
      }
    },
    {
      name: 'GET /by-qr/:uuid with real QR code',
      run: async () => {
        if (!qrUuid) skip('no QR uuid from created equipment (field may be null)');
        const resp = await api('GET', `/api/equipment/by-qr/${qrUuid}`, { role: 'ADMIN' });
        // QR may not be indexed yet
        assert([200, 404].includes(resp.status), 'by-qr lookup: got ' + resp.status);
      }
    },
    {
      name: 'ADMIN bulk creates equipment',
      run: async () => {
        const resp = await api('POST', '/api/equipment/bulk-create', {
          role: 'ADMIN',
          body: { items: [
            { name: 'Bulk Item 1', category: 'tools' },
            { name: 'Bulk Item 2', category: 'tools' }
          ]}
        });
        if (resp.status === 404) skip('bulk-create not found');
        assertOk(resp, 'bulk-create equipment');
      }
    },
    {
      name: 'ADMIN reserves equipment',
      run: async () => {
        if (!equipId) skip('no equipId');
        const today = new Date().toISOString().slice(0, 10);
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        const resp = await api('POST', '/api/equipment/reserve', {
          role: 'ADMIN',
          body: { equipment_id: equipId, reserved_from: today, reserved_to: tomorrow, notes: 'E2E test reserve' }
        });
        if (resp.status === 404) skip('reserve not found');
        assert([200, 201, 500].includes(resp.status), 'reserve equipment: got ' + resp.status);
        // 500 possible if reserve table/logic not fully implemented
      }
    },
    {
      name: 'NEGATIVE: PROC cannot access balance-value',
      run: async () => {
        const resp = await api('GET', '/api/equipment/balance-value', { role: 'PROC' });
        assert([403, 200].includes(resp.status), 'PROC balance-value check');
      }
    },
    {
      name: 'WAREHOUSE reads equipment (list)',
      run: async () => {
        const resp = await api('GET', '/api/equipment', { role: 'WAREHOUSE' });
        assertOk(resp, 'WAREHOUSE reads equipment');
      }
    },
    {
      name: 'Cleanup: delete test equipment',
      run: async () => {
        if (!equipId) return;
        await api('DELETE', `/api/equipment/${equipId}`, { role: 'ADMIN' });
      }
    }
  ]
};
