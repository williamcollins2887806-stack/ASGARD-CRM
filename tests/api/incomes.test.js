/**
 * INCOMES — Full CRUD + role access + negative tests
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertFieldType, skip } = require('../config');

let testIncomeId = null;
let testWorkId = null;

module.exports = {
  name: 'INCOMES (Доходы)',
  tests: [
    // ── Setup: find or create a work for FK ──
    {
      name: 'Setup: find work for FK reference',
      run: async () => {
        const resp = await api('GET', '/api/works?limit=1', { role: 'ADMIN' });
        assertOk(resp, 'get works');
        const works = Array.isArray(resp.data) ? resp.data : (resp.data?.works || resp.data?.data || []);
        if (works.length > 0) testWorkId = works[0].id;
      }
    },
    // ── READ ──
    {
      name: 'ADMIN reads incomes list',
      run: async () => {
        const resp = await api('GET', '/api/incomes', { role: 'ADMIN' });
        assertOk(resp, 'incomes list');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.incomes || resp.data?.data || resp.data?.items || []);
        assertArray(list, 'incomes');
      }
    },
    {
      name: 'PM reads incomes list',
      run: async () => {
        const resp = await api('GET', '/api/incomes', { role: 'PM' });
        assertOk(resp, 'PM incomes list');
      }
    },
    {
      name: 'TO reads incomes list',
      run: async () => {
        const resp = await api('GET', '/api/incomes', { role: 'TO' });
        assertOk(resp, 'TO incomes list');
      }
    },
    // ── CREATE ──
    {
      name: 'ADMIN creates income',
      run: async () => {
        const resp = await api('POST', '/api/incomes', {
          role: 'ADMIN',
          body: {
            work_id: testWorkId || null,
            amount: 50000,
            date: '2026-02-01',
            description: 'E2E autotest income',
            type: 'payment',
            source: 'Test client'
          }
        });
        assertOk(resp, 'create income');
        const income = resp.data?.income || resp.data;
        if (income?.id) testIncomeId = income.id;
      }
    },
    {
      name: 'BUH creates income',
      run: async () => {
        const resp = await api('POST', '/api/incomes', {
          role: 'BUH',
          body: {
            amount: 10000,
            date: '2026-02-02',
            description: 'BUH autotest income',
            type: 'payment'
          }
        });
        assertOk(resp, 'BUH create income');
        if (resp.data?.income?.id || resp.data?.id) {
          const id = resp.data?.income?.id || resp.data?.id;
          await api('DELETE', `/api/incomes/${id}`, { role: 'ADMIN' });
        }
      }
    },
    // ── NEGATIVE: forbidden roles cannot create ──
    {
      name: 'NEGATIVE: WAREHOUSE cannot create income → 403',
      run: async () => {
        const resp = await api('POST', '/api/incomes', {
          role: 'WAREHOUSE',
          body: { amount: 100, date: '2026-02-01', description: 'forbidden' }
        });
        assertForbidden(resp, 'WAREHOUSE create income');
      }
    },
    {
      name: 'NEGATIVE: HR cannot create income → 403',
      run: async () => {
        const resp = await api('POST', '/api/incomes', {
          role: 'HR',
          body: { amount: 100, date: '2026-02-01', description: 'forbidden' }
        });
        assertForbidden(resp, 'HR create income');
      }
    },
    {
      name: 'NEGATIVE: OFFICE_MANAGER cannot create income → 403',
      run: async () => {
        const resp = await api('POST', '/api/incomes', {
          role: 'OFFICE_MANAGER',
          body: { amount: 100, date: '2026-02-01', description: 'forbidden' }
        });
        assertForbidden(resp, 'OFFICE_MANAGER create income');
      }
    },
    // ── UPDATE ──
    {
      name: 'ADMIN updates income',
      run: async () => {
        if (!testIncomeId) return;
        const resp = await api('PUT', `/api/incomes/${testIncomeId}`, {
          role: 'ADMIN',
          body: { amount: 75000, description: 'Updated E2E income' }
        });
        assertOk(resp, 'update income');
      }
    },
    {
      name: 'NEGATIVE: TO cannot update income → 403',
      run: async () => {
        if (!testIncomeId) return;
        const resp = await api('PUT', `/api/incomes/${testIncomeId}`, {
          role: 'TO',
          body: { amount: 1 }
        });
        assertForbidden(resp, 'TO update income');
      }
    },
    // ── DELETE ──
    {
      name: 'NEGATIVE: PROC cannot delete income → 403',
      run: async () => {
        if (!testIncomeId) return;
        const resp = await api('DELETE', `/api/incomes/${testIncomeId}`, { role: 'PROC' });
        assertForbidden(resp, 'PROC delete income');
      }
    },
    {
      name: 'Cleanup: ADMIN deletes income',
      run: async () => {
        if (!testIncomeId) return;
        const resp = await api('DELETE', `/api/incomes/${testIncomeId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete income');
        testIncomeId = null;
      }
    }
  ]
};
