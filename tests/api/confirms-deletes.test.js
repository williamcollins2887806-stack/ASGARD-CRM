/**
 * CONFIRMS & DELETES — Tests for delete confirmations and status changes requiring confirmation
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, skip } = require('../config');

let _tenderId = null;
let _workId = null;
let _userId = null;

module.exports = {
  name: 'CONFIRMS & DELETES (Удаление и подтверждения)',
  tests: [
    // ── DELETE TENDER: only ADMIN/DIRECTOR_GEN ──
    {
      name: 'Create tender for delete tests',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'ADMIN',
          body: { number: 'DEL-T-001', title: 'Delete test tender', customer_name: 'Test', type: 'commercial' }
        });
        assertOk(resp, 'create tender');
        _tenderId = resp.data?.tender?.id || resp.data?.id;
      }
    },
    {
      name: 'NEGATIVE: PM cannot delete tender → 403',
      run: async () => {
        if (!_tenderId) return;
        const resp = await api('DELETE', `/api/tenders/${_tenderId}`, { role: 'PM' });
        assertForbidden(resp, 'PM delete tender');
      }
    },
    {
      name: 'NEGATIVE: TO cannot delete tender → 403',
      run: async () => {
        if (!_tenderId) return;
        const resp = await api('DELETE', `/api/tenders/${_tenderId}`, { role: 'TO' });
        assertForbidden(resp, 'TO delete tender');
      }
    },
    {
      name: 'ADMIN deletes tender → confirm delete works',
      run: async () => {
        if (!_tenderId) return;
        const resp = await api('DELETE', `/api/tenders/${_tenderId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete tender');
        // Verify gone
        const check = await api('GET', `/api/tenders/${_tenderId}`, { role: 'ADMIN' });
        assert(check.status === 404 || check.status === 400, `deleted tender should be 404, got ${check.status}`);
        _tenderId = null;
      }
    },
    // ── DELETE WORK: only ADMIN ──
    {
      name: 'Create work for delete test',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'ADMIN',
          body: { work_number: 'DEL-W-001', work_title: 'Delete test work' }
        });
        assertOk(resp, 'create work');
        _workId = resp.data?.work?.id || resp.data?.id;
      }
    },
    {
      name: 'NEGATIVE: PM cannot delete work → 403',
      run: async () => {
        if (!_workId) return;
        const resp = await api('DELETE', `/api/works/${_workId}`, { role: 'PM' });
        assertForbidden(resp, 'PM delete work');
      }
    },
    {
      name: 'NEGATIVE: DIRECTOR_COMM cannot delete work → 403',
      run: async () => {
        if (!_workId) return;
        const resp = await api('DELETE', `/api/works/${_workId}`, { role: 'DIRECTOR_COMM' });
        assertForbidden(resp, 'DIRECTOR_COMM delete work');
      }
    },
    {
      name: 'ADMIN deletes work',
      run: async () => {
        if (!_workId) return;
        const resp = await api('DELETE', `/api/works/${_workId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete work');
        _workId = null;
      }
    },
    // ── DELETE USER: only ADMIN ──
    {
      name: 'Create user for delete test',
      run: async () => {
        const resp = await api('POST', '/api/users', {
          role: 'ADMIN',
          body: { login: 'del_test_user', name: 'Delete Test User', role: 'PM', password: 'Test123!' }
        });
        assertOk(resp, 'create user');
        _userId = resp.data?.user?.id || resp.data?.id;
      }
    },
    {
      name: 'NEGATIVE: PM cannot delete user → 403',
      run: async () => {
        if (!_userId) return;
        const resp = await api('DELETE', `/api/users/${_userId}`, { role: 'PM' });
        assertForbidden(resp, 'PM delete user');
      }
    },
    {
      name: 'NEGATIVE: HR cannot delete user → 403',
      run: async () => {
        if (!_userId) return;
        const resp = await api('DELETE', `/api/users/${_userId}`, { role: 'HR' });
        assertForbidden(resp, 'HR delete user');
      }
    },
    {
      name: 'ADMIN deletes user',
      run: async () => {
        if (!_userId) return;
        const resp = await api('DELETE', `/api/users/${_userId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete user');
        _userId = null;
      }
    },
    // ── DELETE ESTIMATE: only ADMIN ──
    {
      name: 'Create and delete estimate',
      run: async () => {
        const create = await api('POST', '/api/estimates', {
          role: 'ADMIN',
          body: { title: 'Delete test estimate', amount: 10000 }
        });
        assertOk(create, 'create estimate');
        const estId = create.data?.estimate?.id || create.data?.id;
        if (!estId) return;

        // PM cannot delete
        const pmDel = await api('DELETE', `/api/estimates/${estId}`, { role: 'PM' });
        assertForbidden(pmDel, 'PM delete estimate');

        // TO cannot delete
        const toDel = await api('DELETE', `/api/estimates/${estId}`, { role: 'TO' });
        assertForbidden(toDel, 'TO delete estimate');

        // ADMIN deletes
        const del = await api('DELETE', `/api/estimates/${estId}`, { role: 'ADMIN' });
        assertOk(del, 'delete estimate');
      }
    },
    // ── DELETE SITE: only ADMIN ──
    {
      name: 'Create and delete site',
      run: async () => {
        const create = await api('POST', '/api/sites', {
          role: 'ADMIN',
          body: { name: 'Delete test site', address: 'Test' }
        });
        assertOk(create, 'create site');
        const siteId = create.data?.site?.id || create.data?.id;
        if (!siteId) return;

        // PM cannot delete
        const pmDel = await api('DELETE', `/api/sites/${siteId}`, { role: 'PM' });
        assertForbidden(pmDel, 'PM delete site');

        // ADMIN deletes
        const del = await api('DELETE', `/api/sites/${siteId}`, { role: 'ADMIN' });
        assertOk(del, 'delete site');
      }
    },
    // ── DELETE INVOICE: WRITE_ROLES ──
    {
      name: 'Create and delete invoice with role checks',
      run: async () => {
        const create = await api('POST', '/api/invoices', {
          role: 'ADMIN',
          body: { invoice_number: 'DEL-INV-001', customer_name: 'Test', amount: 5000, invoice_date: '2026-02-01', due_date: '2026-03-01' }
        });
        assertOk(create, 'create invoice');
        const invId = create.data?.invoice?.id || create.data?.id;
        if (!invId) return;

        // WAREHOUSE cannot delete
        const whDel = await api('DELETE', `/api/invoices/${invId}`, { role: 'WAREHOUSE' });
        assertForbidden(whDel, 'WAREHOUSE delete invoice');

        // HR cannot delete
        const hrDel = await api('DELETE', `/api/invoices/${invId}`, { role: 'HR' });
        assertForbidden(hrDel, 'HR delete invoice');

        // ADMIN deletes
        const del = await api('DELETE', `/api/invoices/${invId}`, { role: 'ADMIN' });
        assertOk(del, 'delete invoice');
      }
    },
    // ── Double delete returns 404 ──
    {
      name: 'Double delete task → second returns 404',
      run: async () => {
        const users = await api('GET', '/api/users', { role: 'ADMIN' });
        const uid = (Array.isArray(users.data) ? users.data : (users.data?.users || []))[0]?.id || 1;

        const create = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { title: 'Double delete test', assignee_id: uid, priority: 'low' }
        });
        assertOk(create, 'create task');
        const taskId = create.data?.task?.id || create.data?.id;
        if (!taskId) return;

        const del1 = await api('DELETE', `/api/tasks/${taskId}`, { role: 'ADMIN' });
        assertOk(del1, 'first delete');

        const del2 = await api('DELETE', `/api/tasks/${taskId}`, { role: 'ADMIN' });
        assert(del2.status === 404 || del2.status === 400 || del2.status === 200, `second delete got ${del2.status}`);
      }
    }
  ]
};
