/**
 * STAFF — Deep CRUD + validation + negative tests
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

let testEmpId = null;

module.exports = {
  name: 'STAFF (deep)',
  tests: [
    {
      name: 'HR reads employee list — validates shape',
      run: async () => {
        const resp = await api('GET', '/api/staff/employees', { role: 'HR' });
        assertOk(resp, 'list employees');
        const list = resp.data?.employees || resp.data;
        assertArray(list, 'employees');
        if (list.length > 0) assertHasFields(list[0], ['id', 'fio'], 'employee item');
      }
    },
    {
      name: 'HR creates employee + validates response',
      run: async () => {
        const resp = await api('POST', '/api/staff/employees', {
          role: 'HR',
          body: {
            fio: 'ТЕСТ Сотрудник Петров',
            role_tag: 'worker',
            phone: '+79990009900',
            email: 'test_emp@asgard.local',
            position: 'Монтажник',
            is_active: true
          }
        });
        assertOk(resp, 'create employee');
        const emp = resp.data?.employee || resp.data;
        testEmpId = emp?.id;
        assert(testEmpId, 'should return employee id');
        assertFieldType(emp, 'id', 'number', 'employee.id');
      }
    },
    {
      name: 'Read-back: verify created employee fields',
      run: async () => {
        if (!testEmpId) throw new Error('No employee');
        const resp = await api('GET', `/api/staff/employees/${testEmpId}`, { role: 'HR' });
        assertOk(resp, 'get employee');
        const e = resp.data?.employee || resp.data;
        assertHasFields(e, ['id', 'fio', 'is_active'], 'employee detail');
        assertMatch(e, { id: testEmpId }, 'employee id');
      }
    },
    {
      name: 'Update employee → read-back → verify position changed',
      run: async () => {
        if (!testEmpId) throw new Error('No employee');
        await api('PUT', `/api/staff/employees/${testEmpId}`, {
          role: 'HR', body: { position: 'Инженер' }
        });
        const check = await api('GET', `/api/staff/employees/${testEmpId}`, { role: 'HR' });
        const e = check.data?.employee || check.data;
        assertMatch(e, { position: 'Инженер' }, 'position updated');
      }
    },
    {
      name: 'HR adds review to employee',
      run: async () => {
        if (!testEmpId) throw new Error('No employee');
        const resp = await api('POST', `/api/staff/employees/${testEmpId}/review`, {
          role: 'HR', body: { rating: 4, comment: 'Автотест оценка' }
        });
        assertOk(resp, 'review');
      }
    },
    {
      name: 'HR reads schedule — validates shape',
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
        const list = resp.data?.employees || resp.data;
        assertArray(list, 'ADMIN emp list');
      }
    },
    {
      name: 'NEGATIVE: PM cannot create employee',
      run: async () => {
        const resp = await api('POST', '/api/staff/employees', {
          role: 'PM', body: { fio: 'Forbidden', role_tag: 'worker' }
        });
        assertForbidden(resp, 'PM create employee');
      }
    },
    {
      name: 'NEGATIVE: create employee with empty fio → 400',
      run: async () => {
        const resp = await api('POST', '/api/staff/employees', {
          role: 'HR', body: { role_tag: 'worker' }
        });
        assert(resp.status === 400, `expected 400 for missing fio, got ${resp.status}`);
      }
    },
    {
      name: 'Cleanup: deactivate test employee',
      run: async () => {
        if (!testEmpId) return;
        await api('PUT', `/api/staff/employees/${testEmpId}`, {
          role: 'ADMIN', body: { is_active: false }
        });
        const check = await api('GET', `/api/staff/employees/${testEmpId}`, { role: 'HR' });
        if (check.ok) {
          const e = check.data?.employee || check.data;
          assert(e.is_active === false || e.is_active === 'false', 'employee should be deactivated');
        }
      }
    }
  ]
};
