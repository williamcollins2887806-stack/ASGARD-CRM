const { api, assert, assertOk } = require('../config');

let testEmpId = null;

module.exports = {
  name: 'STAFF (Персонал)',
  tests: [
    {
      name: 'HR reads employee list',
      run: async () => {
        const resp = await api('GET', '/api/staff/employees', { role: 'HR' });
        assertOk(resp, 'list employees');
        assert(Array.isArray(resp.data), 'array expected');
      }
    },
    {
      name: 'HR creates employee',
      run: async () => {
        const resp = await api('POST', '/api/staff/employees', {
          role: 'HR',
          body: {
            fio: 'ТЕСТ Сотрудник Петров',
            role_tag: 'worker',
            phone: '+79990009900',
            is_active: true
          }
        });
        assertOk(resp, 'create employee');
        testEmpId = resp.data?.id;
      }
    },
    {
      name: 'HR reads single employee',
      run: async () => {
        if (!testEmpId) throw new Error('No employee created');
        const resp = await api('GET', `/api/staff/employees/${testEmpId}`, { role: 'HR' });
        assertOk(resp, 'get employee');
      }
    },
    {
      name: 'HR updates employee',
      run: async () => {
        if (!testEmpId) throw new Error('No employee created');
        const resp = await api('PUT', `/api/staff/employees/${testEmpId}`, {
          role: 'HR',
          body: { grade: '6' }
        });
        assertOk(resp, 'update employee');
      }
    },
    {
      name: 'HR adds review to employee',
      run: async () => {
        if (!testEmpId) throw new Error('No employee created');
        const resp = await api('POST', `/api/staff/employees/${testEmpId}/review`, {
          role: 'HR',
          body: { score_1_10: 8, comment: 'Автотест оценка' }
        });
        assert(resp.status < 500, `review: ${resp.status}`);
      }
    },
    {
      name: 'HR reads schedule',
      run: async () => {
        const resp = await api('GET', '/api/staff/schedule', { role: 'HR' });
        assertOk(resp, 'schedule');
      }
    },
    {
      name: 'ADMIN reads employees',
      run: async () => {
        const resp = await api('GET', '/api/staff/employees', { role: 'ADMIN' });
        assertOk(resp, 'ADMIN employees');
      }
    },
    {
      name: 'Cleanup: deactivate test employee',
      run: async () => {
        if (!testEmpId) return;
        await api('PUT', `/api/staff/employees/${testEmpId}`, {
          role: 'ADMIN',
          body: { is_active: false }
        });
      }
    }
  ]
};
