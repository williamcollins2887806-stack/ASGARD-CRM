/**
 * E2E FLOW 3: Employee -> Permit -> Schedule -> Review
 */
const { api, assert, assertOk } = require('../config');

module.exports = {
  name: 'FLOW: Staff Lifecycle',
  tests: [
    {
      name: 'Employee full cycle: create -> permit -> schedule -> review -> deactivate',
      run: async () => {
        // 1. HR creates employee
        const emp = await api('POST', '/api/staff/employees', {
          role: 'HR',
          body: { fio: 'E2E Staff: Sidorov S.S.', role_tag: 'worker', phone: '+79990001111', is_active: true }
        });
        assertOk(emp, 'create employee');
        const empId = emp.data?.employee?.id || emp.data?.id;
        if (!empId) return;

        // 2. Lookup permit types
        const typeList = await api('GET', '/api/permits/types', { role: 'ADMIN' });
        const types = typeList.data?.types || typeList.data || [];
        const pType = Array.isArray(types) ? types[0] : null;

        // 3. Add permit (if types exist)
        let permitId = null;
        if (pType) {
          const permit = await api('POST', '/api/permits', {
            role: 'ADMIN',
            body: { employee_id: empId, type_id: pType.id, issue_date: '2026-01-01', expiry_date: '2027-01-01', notes: 'E2E test permit' }
          });
          assert(permit.status < 500, `permit: ${permit.status}`);
          if (permit.ok) permitId = permit.data?.permit?.id || permit.data?.id;
        }

        // 4. Add schedule entry
        const sched = await api('POST', '/api/staff/schedule', {
          role: 'HR',
          body: { employee_id: empId, date: '2026-03-01', shift_type: 'day', hours: 8 }
        });
        assert(sched.status < 500, `schedule: ${sched.status}`);

        // 5. Add review
        const review = await api('POST', `/api/staff/employees/${empId}/review`, {
          role: 'HR',
          body: { rating: 4, comment: 'E2E: Good performance' }
        });
        assert(review.status < 500, `review: ${review.status}`);

        // 6. Check employee detail
        const detail = await api('GET', `/api/staff/employees/${empId}`, { role: 'HR' });
        assertOk(detail, 'employee detail');

        // 7. Check permit matrix
        const matrix = await api('GET', '/api/permits/matrix', { role: 'ADMIN' });
        assertOk(matrix, 'permit matrix');

        // Cleanup
        if (permitId) await api('DELETE', `/api/permits/${permitId}`, { role: 'ADMIN' });
        await api('PUT', `/api/staff/employees/${empId}`, { role: 'ADMIN', body: { is_active: false } });
      }
    }
  ]
};
