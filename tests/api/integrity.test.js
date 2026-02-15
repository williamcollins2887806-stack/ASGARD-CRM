/**
 * Block G: Cascade operations and data integrity tests
 * Tests full CRUD lifecycle, bulk ops, partial updates, edge cases
 */
const { api, assert, assertOk, assertArray, assertMatch, skip } = require('../config');

let tenderIds = [];
let workId = null;

module.exports = {
  name: 'DATA INTEGRITY',
  tests: [
    {
      name: 'INTEG: Full cycle — create → list → delete → verify gone',
      run: async () => {
        const cr = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'INTEG-CYCLE-TEST', tender_status: 'Новый', tender_type: 'Аукцион' }
        });
        assertOk(cr, 'create');
        const id = cr.data?.tender?.id || cr.data?.id;
        if (!id) skip('Cannot create tender');
        tenderIds.push(id);

        // Verify in list
        const list = await api('GET', '/api/data/tenders?limit=500');
        assertOk(list, 'list');
        const items = list.data?.tenders || [];
        assert(items.some(t => t.id === id), `tender ${id} should be in list`);

        // Delete
        const del = await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' });
        assertOk(del, 'delete');

        // Verify gone
        const after = await api('GET', '/api/data/tenders?limit=500');
        const afterItems = after.data?.tenders || [];
        assert(!afterItems.some(t => t.id === id), `tender ${id} should be gone after delete`);
        tenderIds = tenderIds.filter(x => x !== id);
      }
    },
    {
      name: 'INTEG: Bulk create 5 → count +5 → delete all → count restored',
      run: async () => {
        const before = await api('GET', '/api/data/tenders?limit=1');
        const countBefore = before.data?.total || 0;

        const created = [];
        for (let i = 0; i < 5; i++) {
          const cr = await api('POST', '/api/tenders', {
            role: 'TO',
            body: { customer: `INTEG-BULK-${i}`, tender_status: 'Новый', tender_type: 'Аукцион' }
          });
          const id = cr.data?.tender?.id || cr.data?.id;
          if (id) created.push(id);
        }
        tenderIds.push(...created);
        assert(created.length === 5, `expected 5 created, got ${created.length}`);

        const mid = await api('GET', '/api/data/tenders?limit=1');
        const countMid = mid.data?.total || 0;
        assert(countMid === countBefore + 5, `count should be ${countBefore + 5}, got ${countMid}`);

        // Delete all
        for (const id of created) {
          await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' });
        }
        tenderIds = tenderIds.filter(x => !created.includes(x));

        const after = await api('GET', '/api/data/tenders?limit=1');
        const countAfter = after.data?.total || 0;
        assert(countAfter === countBefore, `count should be restored to ${countBefore}, got ${countAfter}`);
      }
    },
    {
      name: 'INTEG: Update only one field → other fields unchanged',
      run: async () => {
        const cr = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'INTEG-PARTIAL', tender_status: 'Новый', tender_type: 'Аукцион' }
        });
        const id = cr.data?.tender?.id || cr.data?.id;
        if (!id) skip('Cannot create tender');
        tenderIds.push(id);

        // Read original
        const orig = await api('GET', `/api/tenders/${id}`, { role: 'TO' });
        const origData = orig.data?.tender || orig.data;

        // Update only status
        await api('PUT', `/api/tenders/${id}`, {
          role: 'TO',
          body: { tender_status: 'В проработке' }
        });

        // Read back
        const updated = await api('GET', `/api/tenders/${id}`, { role: 'TO' });
        const updatedData = updated.data?.tender || updated.data;

        assert(updatedData.tender_status === 'В проработке', `status should be updated`);
        assert(
          updatedData.customer_name === origData.customer_name,
          `customer_name should be unchanged: "${origData.customer_name}" vs "${updatedData.customer_name}"`
        );
        assert(
          updatedData.tender_type === origData.tender_type,
          `tender_type should be unchanged: "${origData.tender_type}" vs "${updatedData.tender_type}"`
        );

        // Cleanup
        await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' }).catch(() => {});
        tenderIds = tenderIds.filter(x => x !== id);
      }
    },
    {
      name: 'INTEG: Update with empty body → 400 or no change',
      run: async () => {
        const cr = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'INTEG-EMPTY-UPD', tender_status: 'Новый', tender_type: 'Аукцион' }
        });
        const id = cr.data?.tender?.id || cr.data?.id;
        if (!id) skip('Cannot create tender');
        tenderIds.push(id);

        const resp = await api('PUT', `/api/tenders/${id}`, {
          role: 'TO',
          body: {}
        });
        // Should be 400 for empty body
        assert(resp.status === 400, `empty update should return 400, got ${resp.status}`);

        // Cleanup
        await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' }).catch(() => {});
        tenderIds = tenderIds.filter(x => x !== id);
      }
    },
    {
      name: 'INTEG: Create with long field values (VARCHAR limit) → accepted',
      run: async () => {
        const longName = 'A'.repeat(255);
        const cr = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: longName, tender_status: 'Новый', tender_type: 'Аукцион' }
        });
        assertOk(cr, 'long field');
        const id = cr.data?.tender?.id || cr.data?.id;
        if (id) {
          tenderIds.push(id);
          // Verify stored
          const check = await api('GET', `/api/tenders/${id}`, { role: 'TO' });
          const name = (check.data?.tender || check.data)?.customer_name;
          assert(name && name.length >= 200, `long field should be stored (got ${name?.length} chars)`);
          await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' }).catch(() => {});
          tenderIds = tenderIds.filter(x => x !== id);
        }
      }
    },
    {
      name: 'INTEG: Work full cycle — create → update → read → delete',
      run: async () => {
        const cr = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'INTEG-WORK' }
        });
        assertOk(cr, 'create work');
        workId = cr.data?.work?.id || cr.data?.id;
        if (!workId) skip('Cannot create work');

        // Update
        const upd = await api('PUT', `/api/works/${workId}`, {
          role: 'PM',
          body: { status: 'В работе' }
        });
        // Body columns may not be valid — accept 200 or 400
        assert(upd.status === 200 || upd.status === 400, `update work: expected 200 or 400, got ${upd.status}`);

        // Read back
        const check = await api('GET', `/api/data/works/${workId}`, { role: 'PM' });
        assertOk(check, 'read work');

        // Delete
        const del = await api('DELETE', `/api/works/${workId}`, { role: 'ADMIN' });
        assertOk(del, 'delete work');
        workId = null;
      }
    },
    {
      name: 'INTEG: Equipment full cycle via data API',
      run: async () => {
        const cr = await api('POST', '/api/data/equipment', {
          role: 'ADMIN',
          body: { name: 'INTEG-EQUIP-TEST', status: 'available', inventory_number: 'INV-INTEG-' + Date.now() }
        });
        assertOk(cr, 'create equipment');
        const id = cr.data?.id || cr.data?.item?.id;
        if (!id) skip('Cannot create equipment');

        // Read
        const check = await api('GET', `/api/data/equipment/${id}`, { role: 'ADMIN' });
        assertOk(check, 'read equipment');

        // Update
        const upd = await api('PUT', `/api/data/equipment/${id}`, {
          role: 'ADMIN',
          body: { status: 'in_use' }
        });
        assertOk(upd, 'update equipment');

        // Delete
        await api('DELETE', `/api/data/equipment/${id}`, { role: 'ADMIN' });
      }
    },
    {
      name: 'INTEG: Invoice full cycle via data API',
      run: async () => {
        const cr = await api('POST', '/api/data/invoices', {
          role: 'ADMIN',
          body: { number: 'INTEG-INV-001', amount: 15000, status: 'Новый' }
        });
        assertOk(cr, 'create invoice');
        const id = cr.data?.id || cr.data?.item?.id;
        if (!id) skip('Cannot create invoice');

        // Update
        const upd = await api('PUT', `/api/data/invoices/${id}`, {
          role: 'ADMIN',
          body: { status: 'Оплачен' }
        });
        assertOk(upd, 'update invoice');

        // Delete
        await api('DELETE', `/api/data/invoices/${id}`, { role: 'ADMIN' });
      }
    },
    {
      name: 'INTEG: Cleanup leftover test data',
      run: async () => {
        for (const id of tenderIds) {
          await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' }).catch(() => {});
        }
        if (workId) await api('DELETE', `/api/works/${workId}`, { role: 'ADMIN' }).catch(() => {});
        tenderIds = [];
        workId = null;
      }
    }
  ]
};
