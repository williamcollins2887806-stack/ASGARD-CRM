/**
 * PAYROLL EXTENDED — Rates CRUD, Self-Employed CRUD, One-Time Payments lifecycle,
 * items auto-fill/recalc, payments registry & export
 */
const { api, assert, assertOk, assertForbidden, skip } = require('../config');

let empId = null;
let rateId = null;
let seId = null;
let otpId = null;
let otpRejectId = null;
let sheetId = null;

module.exports = {
  name: 'PAYROLL EXTENDED (Rates, Self-Employed, One-Time)',
  tests: [
    // ── Setup ──
    {
      name: 'Setup: get real employee ID',
      run: async () => {
        const resp = await api('GET', '/api/data/employees?limit=1', { role: 'ADMIN' });
        const list = resp.data?.employees || resp.data?.items || resp.data || [];
        if (Array.isArray(list) && list.length > 0) empId = list[0].id;
        else skip('no employees in system');
      }
    },

    // ── RATES ──
    {
      name: 'NEGATIVE: GET /api/payroll/rates without employee_id → 400',
      run: async () => {
        const resp = await api('GET', '/api/payroll/rates', { role: 'ADMIN' });
        assert(resp.status === 400, 'rates without employee_id should be 400, got ' + resp.status);
      }
    },
    {
      name: 'ADMIN reads rates for employee',
      run: async () => {
        if (!empId) skip('no empId');
        const resp = await api('GET', `/api/payroll/rates?employee_id=${empId}`, { role: 'ADMIN' });
        assertOk(resp, 'ADMIN reads rates');
        assert('rates' in resp.data, 'should have rates field');
        const list = resp.data.rates || [];
        if (list.length > 0) rateId = list[0].id;
      }
    },
    {
      name: 'NEGATIVE: GET rates/current without employee_id → 400',
      run: async () => {
        const resp = await api('GET', '/api/payroll/rates/current', { role: 'ADMIN' });
        assert(resp.status === 400, 'rates/current without employee_id should be 400, got ' + resp.status);
      }
    },
    {
      name: 'ADMIN reads current rate for employee',
      run: async () => {
        if (!empId) skip('no empId');
        const resp = await api('GET', `/api/payroll/rates/current?employee_id=${empId}`, { role: 'ADMIN' });
        assertOk(resp, 'current rate');
        assert('rate' in resp.data, 'should have rate field');
      }
    },
    {
      name: 'ADMIN creates new employee rate',
      run: async () => {
        if (!empId) skip('no empId');
        const today = new Date().toISOString().slice(0, 10);
        const resp = await api('POST', '/api/payroll/rates', {
          role: 'ADMIN',
          body: { employee_id: empId, day_rate: 3500, role_tag: 'engineer', effective_from: today }
        });
        assertOk(resp, 'create rate');
        assert(resp.data?.rate?.id, 'should return rate.id');
        rateId = resp.data.rate.id;
      }
    },
    {
      name: 'ADMIN updates employee rate',
      run: async () => {
        if (!rateId) skip('no rateId');
        const resp = await api('PUT', `/api/payroll/rates/${rateId}`, {
          role: 'ADMIN',
          body: { day_rate: 4000, comment: 'E2E updated' }
        });
        assertOk(resp, 'update rate');
      }
    },
    {
      name: 'BUH reads rates (should have access)',
      run: async () => {
        if (!empId) skip('no empId');
        const resp = await api('GET', `/api/payroll/rates?employee_id=${empId}`, { role: 'BUH' });
        assertOk(resp, 'BUH reads rates');
      }
    },
    {
      name: 'NEGATIVE: rate without required fields → 400',
      run: async () => {
        const resp = await api('POST', '/api/payroll/rates', {
          role: 'ADMIN',
          body: { employee_id: empId }
        });
        assert(resp.status === 400, 'rate without day_rate should be 400, got ' + resp.status);
      }
    },

    // ── SELF-EMPLOYED ──
    {
      name: 'ADMIN lists self-employed',
      run: async () => {
        const resp = await api('GET', '/api/payroll/self-employed', { role: 'ADMIN' });
        assertOk(resp, 'list self-employed');
        assert('items' in resp.data, 'should have items field');
      }
    },
    {
      name: 'ADMIN creates self-employed person',
      run: async () => {
        const resp = await api('POST', '/api/payroll/self-employed', {
          role: 'ADMIN',
          body: {
            full_name: 'E2E Самозанятый Тестов',
            inn: '123456789012',
            phone: '+79001234567',
            npd_status: 'active'
          }
        });
        assertOk(resp, 'create self-employed');
        const item = resp.data?.item || resp.data;
        seId = item?.id;
      }
    },
    {
      name: 'ADMIN updates self-employed person',
      run: async () => {
        if (!seId) skip('no seId');
        const resp = await api('PUT', `/api/payroll/self-employed/${seId}`, {
          role: 'ADMIN',
          body: { phone: '+79009999999', npd_status: 'suspended' }
        });
        assertOk(resp, 'update self-employed');
      }
    },
    {
      name: 'ADMIN reads self-employed payments',
      run: async () => {
        if (!seId) skip('no seId');
        const resp = await api('GET', `/api/payroll/self-employed/${seId}/payments`, { role: 'ADMIN' });
        assertOk(resp, 'self-employed payments');
      }
    },
    {
      name: 'NEGATIVE: create self-employed with invalid INN → 400',
      run: async () => {
        const resp = await api('POST', '/api/payroll/self-employed', {
          role: 'ADMIN',
          body: { full_name: 'Invalid', inn: '123' }
        });
        assert(resp.status === 400, 'invalid INN should be 400, got ' + resp.status);
      }
    },
    {
      name: 'NEGATIVE: create self-employed without required fields → 400',
      run: async () => {
        const resp = await api('POST', '/api/payroll/self-employed', {
          role: 'ADMIN',
          body: { phone: '+79000000000' }
        });
        assert(resp.status === 400, 'missing full_name/inn should be 400, got ' + resp.status);
      }
    },

    // ── ONE-TIME PAYMENTS ──
    {
      name: 'ADMIN creates one-time payment request',
      run: async () => {
        if (!empId) skip('no empId');
        const resp = await api('POST', '/api/payroll/one-time', {
          role: 'ADMIN',
          body: { employee_id: empId, amount: 5000, reason: 'E2E test bonus', payment_type: 'bonus' }
        });
        assertOk(resp, 'create one-time payment');
        const item = resp.data?.item || resp.data;
        otpId = item?.id;
        assert(otpId, 'should return item.id');
      }
    },
    {
      name: 'ADMIN creates second one-time payment (for reject test)',
      run: async () => {
        if (!empId) skip('no empId');
        const resp = await api('POST', '/api/payroll/one-time', {
          role: 'ADMIN',
          body: { employee_id: empId, amount: 2000, reason: 'E2E reject test' }
        });
        assertOk(resp, 'create second one-time payment');
        const item = resp.data?.item || resp.data;
        otpRejectId = item?.id;
      }
    },
    {
      name: 'ADMIN lists one-time payments',
      run: async () => {
        const resp = await api('GET', '/api/payroll/one-time', { role: 'ADMIN' });
        assertOk(resp, 'list one-time payments');
        assert('items' in resp.data, 'should have items field');
      }
    },
    {
      name: 'NEGATIVE: WAREHOUSE cannot approve one-time payment',
      run: async () => {
        if (!otpId) skip('no otpId');
        const resp = await api('PUT', `/api/payroll/one-time/${otpId}/approve`, { role: 'WAREHOUSE', body: {} });
        assert(resp.status === 403, 'WAREHOUSE should get 403 on approve, got ' + resp.status);
      }
    },
    {
      name: 'DIRECTOR_GEN approves one-time payment',
      run: async () => {
        if (!otpId) skip('no otpId');
        const resp = await api('PUT', `/api/payroll/one-time/${otpId}/approve`, {
          role: 'DIRECTOR_GEN',
          body: { director_comment: 'Approved by E2E test' }
        });
        assertOk(resp, 'DIRECTOR_GEN approve one-time');
        assert(resp.data?.item?.status === 'approved', 'status should be approved');
      }
    },
    {
      name: 'NEGATIVE: approve already-approved → 400',
      run: async () => {
        if (!otpId) skip('no otpId');
        const resp = await api('PUT', `/api/payroll/one-time/${otpId}/approve`, { role: 'DIRECTOR_GEN', body: {} });
        assert(resp.status === 400, 'double approve should be 400, got ' + resp.status);
      }
    },
    {
      name: 'BUH pays approved one-time payment',
      run: async () => {
        if (!otpId) skip('no otpId');
        const resp = await api('PUT', `/api/payroll/one-time/${otpId}/pay`, { role: 'BUH', body: {} });
        assertOk(resp, 'BUH pays one-time');
        assert(resp.data?.item?.status === 'paid', 'status should be paid');
      }
    },
    {
      name: 'NEGATIVE: BUH tries to pay non-approved payment → 400',
      run: async () => {
        if (!otpRejectId) skip('no otpRejectId');
        const resp = await api('PUT', `/api/payroll/one-time/${otpRejectId}/pay`, { role: 'BUH', body: {} });
        assert(resp.status === 400, 'pay non-approved should be 400, got ' + resp.status);
      }
    },
    {
      name: 'DIRECTOR_GEN rejects second one-time payment',
      run: async () => {
        if (!otpRejectId) skip('no otpRejectId');
        const resp = await api('PUT', `/api/payroll/one-time/${otpRejectId}/reject`, {
          role: 'DIRECTOR_GEN',
          body: { director_comment: 'Rejected by E2E test' }
        });
        assertOk(resp, 'DIRECTOR_GEN reject one-time');
        assert(resp.data?.item?.status === 'rejected', 'status should be rejected');
      }
    },
    {
      name: 'NEGATIVE: PM cannot approve one-time payment',
      run: async () => {
        const resp = await api('POST', '/api/payroll/one-time', {
          role: 'PM',
          body: { employee_id: empId || 1, amount: 1000, reason: 'PM test' }
        });
        if (resp.status === 403) return; // PM can't create - that's fine
        const pmOtpId = resp.data?.item?.id;
        if (!pmOtpId) skip('could not create PM otp');
        const approveResp = await api('PUT', `/api/payroll/one-time/${pmOtpId}/approve`, { role: 'PM', body: {} });
        assert(approveResp.status === 403, 'PM approve should be 403, got ' + approveResp.status);
      }
    },
    {
      name: 'NEGATIVE: one-time without required fields → 400',
      run: async () => {
        const resp = await api('POST', '/api/payroll/one-time', {
          role: 'ADMIN',
          body: { amount: 1000 }
        });
        assert(resp.status === 400, 'otp without employee_id/reason should be 400, got ' + resp.status);
      }
    },

    // ── PAYROLL SHEET + AUTO-FILL/RECALC ──
    {
      name: 'Setup: create payroll sheet for auto-fill test',
      run: async () => {
        const resp = await api('POST', '/api/payroll/sheets', {
          role: 'ADMIN',
          body: {
            title: 'E2E Auto-Fill Test Sheet',
            period_from: '2026-01-01',
            period_to: '2026-01-31'
          }
        });
        assertOk(resp, 'create sheet for auto-fill');
        const item = resp.data?.sheet || resp.data?.item || resp.data;
        sheetId = item?.id;
      }
    },
    {
      name: 'POST /items/auto-fill (no work_id → 400 is ok)',
      run: async () => {
        if (!sheetId) skip('no sheetId');
        const resp = await api('POST', '/api/payroll/items/auto-fill', {
          role: 'ADMIN',
          body: { sheet_id: sheetId }
        });
        assert([200, 400].includes(resp.status), 'auto-fill: got ' + resp.status);
      }
    },
    {
      name: 'POST /items/recalc',
      run: async () => {
        if (!sheetId) skip('no sheetId');
        const resp = await api('POST', '/api/payroll/items/recalc', {
          role: 'ADMIN',
          body: { sheet_id: sheetId }
        });
        if (resp.status === 404) skip('recalc not found');
        assert([200, 400].includes(resp.status), 'recalc: got ' + resp.status);
      }
    },
    {
      name: 'POST /items/auto-fill without sheet_id → 400',
      run: async () => {
        const resp = await api('POST', '/api/payroll/items/auto-fill', { role: 'ADMIN', body: {} });
        assert(resp.status === 400, 'auto-fill without sheet_id should be 400, got ' + resp.status);
      }
    },

    // ── PAYMENTS REGISTRY ──
    {
      name: 'ADMIN reads payment registry',
      run: async () => {
        const resp = await api('GET', '/api/payroll/payments', { role: 'ADMIN' });
        assertOk(resp, 'payment registry');
      }
    },
    {
      name: 'BUH reads payment registry',
      run: async () => {
        const resp = await api('GET', '/api/payroll/payments', { role: 'BUH' });
        assertOk(resp, 'BUH payment registry');
      }
    },

    // ── CLEANUP ──
    {
      name: 'Cleanup: delete test sheet',
      run: async () => {
        if (!sheetId) return;
        await api('DELETE', `/api/payroll/sheets/${sheetId}`, { role: 'ADMIN' });
      }
    },
    {
      name: 'Cleanup: delete self-employed record',
      run: async () => {
        if (!seId) return;
        await api('DELETE', `/api/data/self_employed/${seId}`, { role: 'ADMIN' });
      }
    }
  ]
};
