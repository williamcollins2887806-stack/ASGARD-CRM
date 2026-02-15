/**
 * FLOW-13: Negative cross-role access tests
 * Each test verifies a role CANNOT perform another role's restricted action
 */
const { api, assert, assertOk, skip, TEST_USERS } = require('../config');

module.exports = {
  name: 'FLOW-13: Negative Cross-Role Access',
  tests: [
    {
      name: 'FLOW-13.1: TO cannot delete tender (only ADMIN)',
      run: async () => {
        const t = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer_name: 'FLOW13-1 Test', tender_type: 'Прямой запрос' }
        });
        assertOk(t, 'TO creates tender');
        const id = t.data?.tender?.id || t.data?.id;
        if (!id) return;
        try {
          const del = await api('DELETE', `/api/tenders/${id}`, { role: 'TO' });
          assert(del.status === 403, `TO deleted tender, got ${del.status} expected 403`);
        } finally {
          await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' }).catch(() => {});
        }
      }
    },
    {
      name: 'FLOW-13.2: HR cannot create work',
      run: async () => {
        const res = await api('POST', '/api/works', {
          role: 'HR',
          body: { work_title: 'FLOW13-2 Test' }
        });
        assert(res.status === 403, `HR created work, got ${res.status} expected 403`);
      }
    },
    {
      name: 'FLOW-13.3: BUH cannot approve cash request',
      run: async () => {
        const cash = await api('POST', '/api/cash', {
          role: 'ADMIN',
          body: { amount: 1000, purpose: 'FLOW13-3 Test', type: 'expense' }
        });
        const id = cash.data?.cashRequest?.id || cash.data?.request?.id || cash.data?.id;
        if (!id) { skip('Could not create cash request'); return; }
        try {
          const approve = await api('PUT', `/api/cash/${id}/approve`, { role: 'BUH', body: {} });
          assert(approve.status === 403, `BUH approved cash, got ${approve.status} expected 403`);
        } finally {
          await api('DELETE', `/api/cash/${id}`, { role: 'ADMIN' }).catch(() => {});
        }
      }
    },
    {
      name: 'FLOW-13.4: WAREHOUSE cannot create work expense',
      run: async () => {
        const res = await api('POST', '/api/expenses/work', { role: 'WAREHOUSE', body: { amount: 100, category: 'Материалы', description: 'FLOW13-4' } });
        assert(res.status === 403, `WAREHOUSE created expense, got ${res.status} expected 403`);
      }
    },
    {
      name: 'FLOW-13.5: PROC cannot create employee',
      run: async () => {
        const res = await api('POST', '/api/staff/employees', {
          role: 'PROC',
          body: { fio: 'FLOW13-5 Test' }
        });
        assert(res.status === 403, `PROC created employee, got ${res.status} expected 403`);
      }
    },
    {
      name: 'FLOW-13.6: TO cannot approve payroll sheet',
      run: async () => {
        const sheet = await api('POST', '/api/payroll/sheets', {
          role: 'PM',
          body: { title: 'FLOW13-6', period_from: '2026-03-01', period_to: '2026-03-31' }
        });
        const id = sheet.data?.sheet?.id || sheet.data?.id;
        if (!id) { skip('Could not create payroll sheet'); return; }
        try {
          await api('PUT', `/api/payroll/sheets/${id}/submit`, { role: 'PM', body: {} }).catch(() => {});
          const approve = await api('PUT', `/api/payroll/sheets/${id}/approve`, { role: 'TO', body: {} });
          assert(approve.status === 403, `TO approved payroll, got ${approve.status} expected 403`);
        } finally {
          await api('DELETE', `/api/payroll/sheets/${id}`, { role: 'ADMIN' }).catch(() => {});
        }
      }
    },
    {
      name: 'FLOW-13.7: PM cannot change settings',
      run: async () => {
        const res = await api('PUT', '/api/settings/company_name', {
          role: 'PM',
          body: { value: 'HACKED' }
        });
        assert(res.status === 403, `PM changed settings, got ${res.status} expected 403`);
      }
    },
    {
      name: 'FLOW-13.8: CHIEF_ENGINEER cannot create tender',
      run: async () => {
        const res = await api('POST', '/api/tenders', {
          role: 'CHIEF_ENGINEER',
          body: { customer_name: 'FLOW13-8 Test' }
        });
        assert(res.status === 403, `CHIEF_ENGINEER created tender, got ${res.status} expected 403`);
      }
    },
    {
      name: 'FLOW-13.9: HR_MANAGER cannot delete user',
      run: async () => {
        const res = await api('DELETE', '/api/users/999999', { role: 'HR_MANAGER' });
        assert(res.status === 403, `HR_MANAGER deleted user, got ${res.status} expected 403`);
      }
    },
    {
      name: 'FLOW-13.10: OFFICE_MANAGER cannot write off equipment',
      run: async () => {
        const res = await api('POST', '/api/equipment/write-off', {
          role: 'OFFICE_MANAGER',
          body: { equipment_id: 1, reason: 'test' }
        });
        assert(res.status === 403, `OFFICE_MANAGER wrote off equipment, got ${res.status} expected 403`);
      }
    }
  ]
};
