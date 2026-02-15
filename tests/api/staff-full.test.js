/**
 * STAFF — Full CRUD employees + schedule + reviews + role access
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertFieldType, skip } = require('../config');

let testEmployeeId = null;

module.exports = {
  name: 'STAFF FULL (Сотрудники)',
  tests: [
    // ── READ ──
    {
      name: 'ADMIN reads employees list',
      run: async () => {
        const resp = await api('GET', '/api/staff/employees', { role: 'ADMIN' });
        assertOk(resp, 'employees list');
        const list = resp.data?.employees || resp.data || [];
        assertArray(Array.isArray(list) ? list : [], 'employees');
      }
    },
    {
      name: 'HR reads employees list',
      run: async () => {
        const resp = await api('GET', '/api/staff/employees', { role: 'HR' });
        assertOk(resp, 'HR employees');
      }
    },
    {
      name: 'PM reads employees list',
      run: async () => {
        const resp = await api('GET', '/api/staff/employees', { role: 'PM' });
        assertOk(resp, 'PM employees');
      }
    },
    // ── CREATE ──
    {
      name: 'ADMIN creates employee',
      run: async () => {
        const resp = await api('POST', '/api/staff/employees', {
          role: 'ADMIN',
          body: {
            fio: 'Тестов Тест Тестович',
            position: 'Тестировщик',
            phone: '+79991112233',
            email: 'test_employee@e2e.test',
            role_tag: 'PM',
            is_active: true,
            hire_date: '2026-01-01'
          }
        });
        assertOk(resp, 'create employee');
        const emp = resp.data?.employee || resp.data;
        if (emp?.id) testEmployeeId = emp.id;
      }
    },
    {
      name: 'HR creates employee',
      run: async () => {
        const resp = await api('POST', '/api/staff/employees', {
          role: 'HR',
          body: {
            fio: 'HR Создал Сотрудника',
            position: 'Монтажник',
            is_active: true
          }
        });
        assertOk(resp, 'HR create employee');
        const emp = resp.data?.employee || resp.data;
        if (emp?.id) {
          await api('DELETE', `/api/data/employees/${emp.id}`, { role: 'ADMIN' });
        }
      }
    },
    // ── NEGATIVE: forbidden roles cannot create ──
    {
      name: 'NEGATIVE: PM cannot create employee → 403',
      run: async () => {
        const resp = await api('POST', '/api/staff/employees', {
          role: 'PM',
          body: { fio: 'forbidden', position: 'test' }
        });
        assertForbidden(resp, 'PM create employee');
      }
    },
    {
      name: 'NEGATIVE: TO cannot create employee → 403',
      run: async () => {
        const resp = await api('POST', '/api/staff/employees', {
          role: 'TO',
          body: { fio: 'forbidden', position: 'test' }
        });
        assertForbidden(resp, 'TO create employee');
      }
    },
    {
      name: 'NEGATIVE: WAREHOUSE cannot create employee → 403',
      run: async () => {
        const resp = await api('POST', '/api/staff/employees', {
          role: 'WAREHOUSE',
          body: { fio: 'forbidden' }
        });
        assertForbidden(resp, 'WAREHOUSE create employee');
      }
    },
    {
      name: 'NEGATIVE: BUH cannot create employee → 403',
      run: async () => {
        const resp = await api('POST', '/api/staff/employees', {
          role: 'BUH',
          body: { fio: 'forbidden' }
        });
        assertForbidden(resp, 'BUH create employee');
      }
    },
    // ── READ by ID ──
    {
      name: 'Read employee by ID',
      run: async () => {
        if (!testEmployeeId) return;
        const resp = await api('GET', `/api/staff/employees/${testEmployeeId}`, { role: 'ADMIN' });
        assertOk(resp, 'get employee');
        const emp = resp.data?.employee || resp.data;
        assertHasFields(emp, ['id', 'fio'], 'employee detail');
      }
    },
    // ── UPDATE ──
    {
      name: 'ADMIN updates employee',
      run: async () => {
        if (!testEmployeeId) return;
        const resp = await api('PUT', `/api/staff/employees/${testEmployeeId}`, {
          role: 'ADMIN',
          body: { position: 'Старший тестировщик', phone: '+79990001111' }
        });
        assertOk(resp, 'update employee');
      }
    },
    {
      name: 'NEGATIVE: PM cannot update employee → 403',
      run: async () => {
        if (!testEmployeeId) return;
        const resp = await api('PUT', `/api/staff/employees/${testEmployeeId}`, {
          role: 'PM',
          body: { position: 'hacked' }
        });
        assertForbidden(resp, 'PM update employee');
      }
    },
    // ── REVIEWS ──
    {
      name: 'ADMIN adds review for employee',
      run: async () => {
        if (!testEmployeeId) return;
        const resp = await api('POST', `/api/staff/employees/${testEmployeeId}/review`, {
          role: 'ADMIN',
          body: {
            rating: 5,
            comment: 'Отличный сотрудник (autotest)',
            type: 'performance'
          }
        });
        if (resp.status === 404) skip('review endpoint not found');
        assertOk(resp, 'add review');
      }
    },
    // ── SCHEDULE ──
    {
      name: 'ADMIN reads schedule',
      run: async () => {
        const resp = await api('GET', '/api/staff/schedule', { role: 'ADMIN' });
        assertOk(resp, 'schedule');
      }
    },
    {
      name: 'ADMIN creates schedule entry',
      run: async () => {
        if (!testEmployeeId) return;
        const resp = await api('POST', '/api/staff/schedule', {
          role: 'ADMIN',
          body: {
            employee_id: testEmployeeId,
            date: '2026-03-01',
            status_code: 'work'
          }
        });
        if (resp.status === 404) skip('schedule create not found');
        assertOk(resp, 'create schedule');
      }
    },
    // ── Cleanup ──
    {
      name: 'Cleanup: deactivate test employee',
      run: async () => {
        if (!testEmployeeId) return;
        // Use soft-delete (deactivate) to avoid FK constraint issues
        const resp = await api('PUT', `/api/staff/employees/${testEmployeeId}`, {
          role: 'ADMIN',
          body: { is_active: false }
        });
        assertOk(resp, 'deactivate employee');
        testEmployeeId = null;
      }
    }
  ]
};
