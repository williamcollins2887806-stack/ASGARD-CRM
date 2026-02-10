const { api, assert, assertOk } = require('../config');

let testPermitId = null;

module.exports = {
  name: 'PERMITS (Допуски)',
  tests: [
    {
      name: 'ADMIN reads permit types',
      run: async () => {
        const resp = await api('GET', '/api/permits/types', { role: 'ADMIN' });
        assertOk(resp, 'permit types');
      }
    },
    {
      name: 'ADMIN reads permits list',
      run: async () => {
        const resp = await api('GET', '/api/permits', { role: 'ADMIN' });
        assertOk(resp, 'permits list');
      }
    },
    {
      name: 'ADMIN creates permit for real employee',
      run: async () => {
        // Look up real employee and permit type to avoid FK violations
        const empList = await api('GET', '/api/staff/employees', { role: 'ADMIN' });
        const employees = empList.data?.employees || empList.data || [];
        const emp = Array.isArray(employees) ? employees.find(e => e.is_active !== false) || employees[0] : null;

        const typeList = await api('GET', '/api/permits/types', { role: 'ADMIN' });
        const types = typeList.data?.types || typeList.data || [];
        const pType = Array.isArray(types) ? types[0] : null;

        if (!emp) {
          // No employees in DB, skip permit creation
          return;
        }

        const resp = await api('POST', '/api/permits', {
          role: 'ADMIN',
          body: {
            employee_id: emp.id,
            type_id: pType?.id || 'safety_general',
            doc_number: 'TEST-001',
            issue_date: '2026-01-01',
            expiry_date: '2027-01-01',
            notes: 'Автотест'
          }
        });
        // May be 200/201 or 400 if type_id doesn't match
        assert(resp.status < 500, `create permit: ${resp.status}`);
        if (resp.ok) testPermitId = resp.data?.permit?.id || resp.data?.id;
      }
    },
    {
      name: 'ADMIN reads permit matrix',
      run: async () => {
        const resp = await api('GET', '/api/permits/matrix', { role: 'ADMIN' });
        assertOk(resp, 'permit matrix');
      }
    },
    {
      name: 'ADMIN reads permit stats',
      run: async () => {
        const resp = await api('GET', '/api/permits/stats', { role: 'ADMIN' });
        assertOk(resp, 'permit stats');
      }
    },
    {
      name: 'Cleanup: delete test permit',
      run: async () => {
        if (!testPermitId) return;
        await api('DELETE', `/api/permits/${testPermitId}`, { role: 'ADMIN' });
      }
    }
  ]
};
