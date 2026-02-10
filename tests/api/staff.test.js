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
        const list = resp.data?.employees || resp.data;
        assert(Array.isArray(list), 'array expected');
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
        testEmpId = resp.data?.employee?.id || resp.data?.id;
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
          body: { position: 'Инженер' }
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
          body: { rating: 8, comment: 'Автотест оценка' }
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
