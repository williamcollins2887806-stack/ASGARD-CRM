/**
 * Block B: Soft delete / deletion lifecycle tests
 * Tests CRUD create → delete → verify gone pattern
 * Note: Most tables use hard delete (no is_deleted column), so we test the delete lifecycle.
 */
const { api, assert, assertOk, assertArray, skip, TEST_USERS } = require('../config');

let tenderIds = [];
let workId = null;
let employeeId = null;
let customerId = null;
let invoiceId = null;

module.exports = {
  name: 'DELETE LIFECYCLE',
  tests: [
    // Tender: create → delete → verify gone
    {
      name: 'DEL: Create tender → delete → GET by id → 404',
      run: async () => {
        const cr = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'DEL-TEST-tender', tender_status: 'Новый', tender_type: 'Аукцион' }
        });
        assertOk(cr, 'create');
        const id = cr.data?.tender?.id || cr.data?.id;
        if (!id) skip('Cannot create tender');
        tenderIds.push(id);

        const del = await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' });
        assertOk(del, 'delete tender');

        const check = await api('GET', `/api/tenders/${id}`, { role: 'ADMIN' });
        assert(check.status === 404 || check.status === 400, `deleted tender should be 404, got ${check.status}`);
        tenderIds = tenderIds.filter(x => x !== id);
      }
    },
    {
      name: 'DEL: Create tender → delete → not in list',
      run: async () => {
        const cr = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'DEL-LIST-TEST', tender_status: 'Новый', tender_type: 'Аукцион' }
        });
        assertOk(cr, 'create');
        const id = cr.data?.tender?.id || cr.data?.id;
        if (!id) skip('Cannot create tender');
        tenderIds.push(id);

        await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' });

        const list = await api('GET', '/api/data/tenders?limit=500', { role: 'ADMIN' });
        assertOk(list, 'list tenders');
        const items = list.data?.tenders || [];
        const found = items.find(t => t.id === id);
        assert(!found, `deleted tender ${id} should not appear in list`);
        tenderIds = tenderIds.filter(x => x !== id);
      }
    },
    {
      name: 'DEL: Deleted tender not in count',
      run: async () => {
        const before = await api('GET', '/api/data/tenders?limit=1', { role: 'ADMIN' });
        assertOk(before, 'count before');
        const countBefore = before.data?.total;

        const cr = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'DEL-COUNT-TEST', tender_status: 'Новый', tender_type: 'Аукцион' }
        });
        const id = cr.data?.tender?.id || cr.data?.id;
        if (!id) skip('Cannot create tender');
        tenderIds.push(id);

        await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' });

        const after = await api('GET', '/api/data/tenders?limit=1', { role: 'ADMIN' });
        assertOk(after, 'count after');
        assert(after.data?.total === countBefore, `count should return to ${countBefore}, got ${after.data?.total}`);
        tenderIds = tenderIds.filter(x => x !== id);
      }
    },
    {
      name: 'DEL: Double delete tender → idempotent (no 500)',
      run: async () => {
        const cr = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'DEL-DOUBLE-TEST', tender_status: 'Новый', tender_type: 'Аукцион' }
        });
        const id = cr.data?.tender?.id || cr.data?.id;
        if (!id) skip('Cannot create tender');
        tenderIds.push(id);

        const del1 = await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' });
        assertOk(del1, 'first delete');

        const del2 = await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' });
        // Double-delete correctly returns 404 (already gone)
        assert(del2.status === 404, `second delete: expected 404, got ${del2.status}`);
        tenderIds = tenderIds.filter(x => x !== id);
      }
    },
    // Work: create → delete → verify
    {
      name: 'DEL: Create work → delete → GET → 404',
      run: async () => {
        const cr = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'DEL-TEST-work' }
        });
        assertOk(cr, 'create work');
        workId = cr.data?.work?.id || cr.data?.id;
        if (!workId) skip('Cannot create work');

        const del = await api('DELETE', `/api/works/${workId}`, { role: 'ADMIN' });
        assertOk(del, 'delete work');

        const check = await api('GET', `/api/data/works/${workId}`, { role: 'ADMIN' });
        assert(check.status === 404 || check.status === 400, `deleted work should be 404, got ${check.status}`);
        workId = null;
      }
    },
    // Employee: create → delete → verify
    {
      name: 'DEL: Create employee → delete → verify gone',
      run: async () => {
        const cr = await api('POST', '/api/data/employees', {
          role: 'ADMIN',
          body: { fio: 'DEL-TEST Сотрудник', is_active: true }
        });
        assertOk(cr, 'create employee');
        employeeId = cr.data?.id || cr.data?.item?.id;
        if (!employeeId) skip('Cannot create employee');

        const del = await api('DELETE', `/api/data/employees/${employeeId}`, { role: 'ADMIN' });
        assertOk(del, 'delete employee');

        const check = await api('GET', `/api/data/employees/${employeeId}`, { role: 'ADMIN' });
        assert(check.status === 404 || check.status === 400, `deleted employee should be 404, got ${check.status}`);
        employeeId = null;
      }
    },
    // Customer: create → delete → verify
    {
      name: 'DEL: Create customer → delete → verify gone',
      run: async () => {
        const inn = '9999000111';
        const cr = await api('POST', '/api/customers', {
          role: 'ADMIN',
          body: { inn, name: 'DEL-TEST Клиент' }
        });
        assertOk(cr, 'create customer');
        customerId = cr.data?.customer?.inn || cr.data?.inn || inn;

        const del = await api('DELETE', `/api/customers/${customerId}`, { role: 'ADMIN' });
        assertOk(del, 'delete customer');

        const check = await api('GET', `/api/customers/${customerId}`, { role: 'ADMIN' });
        assert(check.status === 404 || check.status === 400 || (check.ok && !check.data?.customer),
          `deleted customer should be gone, got ${check.status}`);
        customerId = null;
      }
    },
    // Invoice: create → delete → verify
    {
      name: 'DEL: Create invoice → delete → verify gone',
      run: async () => {
        const cr = await api('POST', '/api/data/invoices', {
          role: 'ADMIN',
          body: { number: 'DEL-TEST-INV-001', amount: 10000, status: 'Новый' }
        });
        assertOk(cr, 'create invoice');
        invoiceId = cr.data?.id || cr.data?.item?.id;
        if (!invoiceId) skip('Cannot create invoice');

        const del = await api('DELETE', `/api/data/invoices/${invoiceId}`, { role: 'ADMIN' });
        assertOk(del, 'delete invoice');

        const check = await api('GET', `/api/data/invoices/${invoiceId}`, { role: 'ADMIN' });
        assert(check.status === 404 || check.status === 400, `deleted invoice should be 404, got ${check.status}`);
        invoiceId = null;
      }
    },
    // Cleanup safety net
    {
      name: 'DEL: Cleanup any leftover test records',
      run: async () => {
        for (const id of tenderIds) {
          await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' }).catch(() => {});
        }
        if (workId) await api('DELETE', `/api/works/${workId}`, { role: 'ADMIN' }).catch(() => {});
        if (employeeId) await api('DELETE', `/api/data/employees/${employeeId}`, { role: 'ADMIN' }).catch(() => {});
        if (invoiceId) await api('DELETE', `/api/data/invoices/${invoiceId}`, { role: 'ADMIN' }).catch(() => {});
        // Always pass
      }
    }
  ]
};
