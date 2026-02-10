/**
 * WORKS — Deep CRUD + validation + negative tests
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

let testWorkId = null;

module.exports = {
  name: 'WORKS CRUD (deep)',
  tests: [
    {
      name: 'PM creates work + validates response',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'PM',
          body: {
            work_title: 'ТЕСТ: Монтаж HVAC',
            work_number: 'TEST-W-' + Date.now(),
            customer_name: 'Test Customer Alpha',
            contract_value: 3000000,
            cost_plan: 2000000,
            work_status: 'В работе'
          }
        });
        assertOk(resp, 'create work');
        const work = resp.data?.work || resp.data;
        testWorkId = work?.id;
        assert(testWorkId, 'should return id');
        assertFieldType(work, 'id', 'number', 'work.id');
      }
    },
    {
      name: 'Read-back: verify created work fields',
      run: async () => {
        if (!testWorkId) throw new Error('No work');
        const resp = await api('GET', `/api/works/${testWorkId}`, { role: 'PM' });
        assertOk(resp, 'get work');
        const w = resp.data?.work || resp.data;
        assertHasFields(w, ['id', 'work_title', 'work_status'], 'work detail');
        assertMatch(w, { id: testWorkId, work_status: 'В работе' }, 'work fields match');
      }
    },
    {
      name: 'List works: response is array with fields',
      run: async () => {
        const resp = await api('GET', '/api/works', { role: 'PM' });
        assertOk(resp, 'list works');
        const list = resp.data?.works || resp.data;
        assertArray(list, 'works');
        assert(list.length > 0, 'should have works');
        assertHasFields(list[0], ['id', 'work_title'], 'work list item');
      }
    },
    {
      name: 'Update work → read-back → verify change',
      run: async () => {
        if (!testWorkId) throw new Error('No work');
        await api('PUT', `/api/works/${testWorkId}`, {
          role: 'PM', body: { work_status: 'Мобилизация' }
        });
        const check = await api('GET', `/api/works/${testWorkId}`, { role: 'PM' });
        const w = check.data?.work || check.data;
        assertMatch(w, { work_status: 'Мобилизация' }, 'status updated');
      }
    },
    {
      name: 'HEAD_PM reads works (inherits PM)',
      run: async () => {
        const resp = await api('GET', '/api/works', { role: 'HEAD_PM' });
        assertOk(resp, 'HEAD_PM works');
      }
    },
    {
      name: 'NEGATIVE: HR cannot create work',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'HR', body: { work_title: 'Forbidden', work_status: 'new' }
        });
        assertForbidden(resp, 'HR create work');
      }
    },
    {
      name: 'NEGATIVE: create work with empty body → 400',
      run: async () => {
        const resp = await api('POST', '/api/works', { role: 'PM', body: {} });
        assert(resp.status === 400, `empty body should return 400, got ${resp.status}`);
      }
    },
    {
      name: 'NEGATIVE: only ADMIN can delete work',
      run: async () => {
        const resp = await api('DELETE', '/api/works/999999', { role: 'PM' });
        assertForbidden(resp, 'PM delete work');
      }
    },
    {
      name: 'Delete work → verify gone',
      run: async () => {
        if (!testWorkId) return;
        const del = await api('DELETE', `/api/works/${testWorkId}`, { role: 'ADMIN' });
        assertOk(del, 'delete work');
        const check = await api('GET', `/api/works/${testWorkId}`, { role: 'PM' });
        assert(check.status === 404 || check.status === 400, `deleted work should be 404, got ${check.status}`);
        testWorkId = null;
      }
    }
  ]
};
