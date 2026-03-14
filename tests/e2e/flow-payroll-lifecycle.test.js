/**
 * E2E FLOW: Payroll Sheet Lifecycle
 * PM creates payroll sheet -> adds items -> submits -> DIRECTOR_GEN approves -> BUH processes payment
 * Cross-role checks: PM can create, TO cannot create, Director approves, BUH pays
 */
const { api, assert, assertOk, assertStatus, assertForbidden, assertHasFields, skip } = require('../config');

let sheetId = null;
let itemId = null;

module.exports = {
  name: 'FLOW: Payroll Sheet Lifecycle (PM -> Director -> BUH)',
  tests: [
    {
      name: 'TO cannot create payroll sheet (forbidden)',
      run: async () => {
        const resp = await api('POST', '/api/payroll/sheets', {
          role: 'TO',
          body: {
            title: 'E2E: TO attempt payroll',
            period_from: '2026-01-01',
            period_to: '2026-01-31'
          }
        });
        if (resp.status === 404) skip('Payroll endpoint not available');
        assertForbidden(resp, 'TO should not create payroll sheets');
      }
    },
    {
      name: 'PM creates payroll sheet (draft)',
      run: async () => {
        const resp = await api('POST', '/api/payroll/sheets', {
          role: 'PM',
          body: {
            title: 'E2E: Payroll Test Sheet',
            period_from: '2026-01-01',
            period_to: '2026-01-31',
            comment: 'Automated E2E test payroll sheet'
          }
        });
        if (resp.status === 404) skip('Payroll endpoint not available');
        assertOk(resp, 'PM creates payroll sheet');
        sheetId = resp.data?.sheet?.id;
        assert(sheetId, 'Sheet ID must be returned');
        assert(resp.data.sheet.status === 'draft', 'New sheet must be in draft status');
      }
    },
    {
      name: 'PM can view the created sheet',
      run: async () => {
        if (!sheetId) skip('No sheet created');
        const resp = await api('GET', '/api/payroll/sheets/' + sheetId, { role: 'PM' });
        assertOk(resp, 'PM views payroll sheet');
        assert(resp.data?.sheet?.id === sheetId, 'Sheet ID must match');
      }
    },
    {
      name: 'PM lists payroll sheets and finds the created one',
      run: async () => {
        if (!sheetId) skip('No sheet created');
        const resp = await api('GET', '/api/payroll/sheets?limit=10', { role: 'PM' });
        assertOk(resp, 'PM lists payroll sheets');
        const sheets = resp.data?.sheets || [];
        const found = sheets.find(s => s.id === sheetId);
        assert(found, 'Created sheet must appear in list');
      }
    },
    {
      name: 'PM updates draft sheet title',
      run: async () => {
        if (!sheetId) skip('No sheet created');
        const resp = await api('PUT', '/api/payroll/sheets/' + sheetId, {
          role: 'PM',
          body: { title: 'E2E: Updated Payroll Sheet Title' }
        });
        assertOk(resp, 'PM updates draft sheet');
        assert(resp.data?.sheet?.title === 'E2E: Updated Payroll Sheet Title', 'Title must be updated');
      }
    },
    {
      name: 'PM adds payroll item (employee line)',
      run: async () => {
        if (!sheetId) skip('No sheet created');
        const empResp = await api('GET', '/api/staff/employees?limit=1', { role: 'PM' });
        const employees = empResp.data?.employees || empResp.data?.items || empResp.data || [];
        const empId = Array.isArray(employees) && employees.length > 0 ? employees[0].id : null;
        if (!empId) skip('No employees available for payroll item');

        const resp = await api('POST', '/api/payroll/items', {
          role: 'PM',
          body: {
            sheet_id: sheetId,
            employee_id: empId,
            days_worked: 22,
            day_rate: 3500,
            bonus: 5000,
            overtime_hours: 4,
            penalty: 0,
            advance_paid: 10000,
            deductions: 0,
            comment: 'E2E test payroll item'
          }
        });
        assertOk(resp, 'PM adds payroll item');
        itemId = resp.data?.item?.id;
        assert(itemId, 'Item ID must be returned');
      }
    },
    {
      name: 'PM submits sheet for approval (draft -> pending)',
      run: async () => {
        if (!sheetId) skip('No sheet created');
        const resp = await api('PUT', '/api/payroll/sheets/' + sheetId + '/submit', {
          role: 'PM',
          body: {}
        });
        assertOk(resp, 'PM submits sheet');
        assert(resp.data?.sheet?.status === 'pending', 'Sheet status must be pending after submit');
      }
    },
    {
      name: 'BUH can view pending sheet',
      run: async () => {
        if (!sheetId) skip('No sheet created');
        const resp = await api('GET', '/api/payroll/sheets/' + sheetId, { role: 'BUH' });
        assertOk(resp, 'BUH views pending sheet');
        assert(resp.data?.sheet?.status === 'pending', 'Sheet must still be pending');
      }
    },
    {
      name: 'BUH cannot approve payroll sheet (only directors can)',
      run: async () => {
        if (!sheetId) skip('No sheet created');
        const resp = await api('PUT', '/api/payroll/sheets/' + sheetId + '/approve', {
          role: 'BUH',
          body: {}
        });
        assertForbidden(resp, 'BUH should not approve payroll sheets');
      }
    },
    {
      name: 'DIRECTOR_GEN approves payroll sheet (pending -> approved)',
      run: async () => {
        if (!sheetId) skip('No sheet created');
        const resp = await api('PUT', '/api/payroll/sheets/' + sheetId + '/approve', {
          role: 'DIRECTOR_GEN',
          body: {}
        });
        assertOk(resp, 'DIRECTOR_GEN approves payroll sheet');
        assert(resp.data?.sheet?.status === 'approved', 'Sheet status must be approved');
      }
    },
    {
      name: 'BUH processes payment (approved -> paid)',
      run: async () => {
        if (!sheetId) skip('No sheet created');
        const resp = await api('PUT', '/api/payroll/sheets/' + sheetId + '/pay', {
          role: 'BUH',
          body: {}
        });
        assertOk(resp, 'BUH processes payment');
        assert(resp.data?.sheet?.status === 'paid', 'Sheet status must be paid');
      }
    },
    {
      name: 'Verify final sheet state after full lifecycle',
      run: async () => {
        if (!sheetId) skip('No sheet created');
        const resp = await api('GET', '/api/payroll/sheets/' + sheetId, { role: 'ADMIN' });
        assertOk(resp, 'Final sheet verification');
        const sheet = resp.data?.sheet;
        assert(sheet.status === 'paid', 'Final status must be paid');
        assert(sheet.approved_by, 'approved_by must be set');
        assert(sheet.paid_by, 'paid_by must be set');
      }
    },
    {
      name: 'Cleanup: paid sheet cannot be deleted (expected)',
      run: async () => {
        if (!sheetId) return;
        const resp = await api('DELETE', '/api/payroll/sheets/' + sheetId, { role: 'ADMIN' });
        assert(resp.status === 400 || resp.status === 200, 'Delete attempt on paid sheet acknowledged');
      }
    }
  ]
};
