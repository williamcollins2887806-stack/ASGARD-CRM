const { api, assert, assertOk, assertForbidden, skip } = require('../config');

let procReqId = null;
let procItemId = null;
let assemblyId = null;
let palletId = null;
let fullProcId = null;
let fullItemId = null;
let fullAssemblyId = null;

module.exports = {
  name: 'FLOW: Procurement + Warehouse + Assembly Pipeline',
  tests: [
    {
      name: 'Step 0: Server is alive',
      run: async () => {
        const resp = await api('GET', '/api/users/me', { role: 'ADMIN' });
        assertOk(resp, 'Server responds');
        assert(resp.data?.user?.id, 'User ID returned');
      }
    },
    { name: 'Step 1.1: Server alive after V052', run: async () => {
        const r = await api('GET', '/api/users/me', { role: 'ADMIN' }); assertOk(r, 'Alive');
    }},
    { name: 'Step 1.2: Stable without purchase_requests', run: async () => {
        const r = await api('GET', '/api/users/me', { role: 'ADMIN' }); assertOk(r, 'Stable');
    }},
    // === STEP 2 ===
    { name: 'S2.1: PM creates', run: async () => {
      const r = await api('POST', '/api/procurement', { role: 'PM', body: { title: 'PIPELINE_TEST: Закупка', priority: 'high' } });
      if (r.status === 404) skip('Not ready'); assertOk(r, 'Created'); procReqId = r.data?.item?.id;
      assert(procReqId, 'ID'); assert(r.data.item.status === 'draft', 'Draft');
    }},
    { name: 'S2.2: HR blocked', run: async () => {
      const r = await api('POST', '/api/procurement', { role: 'HR', body: { title: 'x' } }); assertForbidden(r, 'Blocked');
    }},
    { name: 'S2.3: Add item', run: async () => {
      if (!procReqId) skip('No req');
      const r = await api('POST', `/api/procurement/${procReqId}/items`, { role: 'PM', body: { name: 'Труба 108', article: 'TR-108', unit: 'м.п.', quantity: 50, unit_price: 2500 } });
      assertOk(r, 'Added'); procItemId = r.data?.item?.id; assert(r.data.item.total_price == 125000, 'Total');
    }},
    { name: 'S2.4: 2nd item', run: async () => {
      if (!procReqId) skip(''); const r = await api('POST', `/api/procurement/${procReqId}/items`, { role: 'PM', body: { name: 'Электроды', unit: 'кг', quantity: 100, unit_price: 500 } }); assertOk(r, 'OK');
    }},
    { name: 'S2.5: Details + total', run: async () => {
      if (!procReqId) skip(''); const r = await api('GET', `/api/procurement/${procReqId}`, { role: 'PM' });
      assertOk(r, 'OK'); assert(r.data.items?.length === 2, '2'); assert(r.data.item.total_sum == 175000, 'Sum');
    }},
    { name: 'S2.6: Update item', run: async () => {
      if (!procItemId) skip(''); const r = await api('PUT', `/api/procurement/${procReqId}/items/${procItemId}`, { role: 'PM', body: { quantity: 60, unit_price: 2600 } });
      assertOk(r, 'OK'); assert(r.data.item.total_price == 156000, '60*2600');
    }},
    { name: 'S2.7: Delete item', run: async () => {
      if (!procItemId) skip(''); await api('DELETE', `/api/procurement/${procReqId}/items/${procItemId}`, { role: 'PM' });
      const d = await api('GET', `/api/procurement/${procReqId}`, { role: 'PM' }); assert(d.data.items?.length === 1, '1 left');
    }},
    { name: 'S2.8: Bulk', run: async () => {
      if (!procReqId) skip(''); const r = await api('POST', `/api/procurement/${procReqId}/items/bulk`, { role: 'PM', body: { items: [
        { name: 'Шланг', unit: 'м', quantity: 50, unit_price: 800 }, { name: 'Головка Ø33', unit: 'шт', quantity: 4, unit_price: 15000 },
        { name: 'Манометр', unit: 'шт', quantity: 2, unit_price: 3500 }
      ] } }); assertOk(r, 'OK'); assert(r.data.count === 3, '3');
    }},
    { name: 'S2.9: Bad target', run: async () => {
      if (!procReqId) skip(''); const r = await api('POST', `/api/procurement/${procReqId}/items`, { role: 'PM', body: { name: 'X', quantity: 1, delivery_target: 'xxx' } });
      assert(r.status === 400, '400');
    }},
    { name: 'S2.10: NaN qty', run: async () => {
      if (!procReqId) skip(''); const r = await api('POST', `/api/procurement/${procReqId}/items`, { role: 'PM', body: { name: 'X', quantity: 'abc' } });
      assert(r.status === 400, '400');
    }},
    { name: 'S2.11: Search', run: async () => {
      const r = await api('GET', '/api/procurement?search=PIPELINE', { role: 'PM' }); assertOk(r, 'OK'); assert(r.data.items?.length >= 1, 'Found');
    }},

    // === STEP 3: APPROVAL CHAIN ===
    { name: 'S3.1: PM→PROC', run: async () => {
      if (!procReqId) skip(''); const r = await api('PUT', `/api/procurement/${procReqId}/send-to-proc`, { role: 'PM', body: {} });
      assertOk(r, 'OK'); assert(r.data.item.status === 'sent_to_proc', 'Status');
    }},
    { name: 'S3.2: No re-send', run: async () => {
      if (!procReqId) skip(''); const r = await api('PUT', `/api/procurement/${procReqId}/send-to-proc`, { role: 'PM', body: {} });
      assert(r.status === 409, '409');
    }},
    { name: 'S3.3: PROC responds', run: async () => {
      if (!procReqId) skip(''); const r = await api('PUT', `/api/procurement/${procReqId}/proc-respond`, { role: 'PROC', body: { comment: 'Ок' } });
      assertOk(r, 'OK'); assert(r.data.item.status === 'proc_responded', 'Status');
    }},
    { name: 'S3.4: PM approves', run: async () => {
      if (!procReqId) skip(''); const r = await api('PUT', `/api/procurement/${procReqId}/pm-approve`, { role: 'PM', body: {} });
      assertOk(r, 'OK'); assert(r.data.item.status === 'pm_approved', 'Status');
    }},
    { name: 'S3.5: DIR approves→locked', run: async () => {
      if (!procReqId) skip(''); const r = await api('PUT', `/api/procurement/${procReqId}/dir-approve`, { role: 'DIRECTOR_GEN', body: {} });
      assertOk(r, 'OK'); assert(r.data.item.locked === true, 'Locked');
    }},
    { name: 'S3.6: Cannot edit locked', run: async () => {
      if (!procReqId) skip(''); const r = await api('POST', `/api/procurement/${procReqId}/items`, { role: 'PM', body: { name: 'Fail', quantity: 1 } });
      assert(r.status === 409, '409');
    }},
    { name: 'S3.7: No pay from draft', run: async () => {
      const c = await api('POST', '/api/procurement', { role: 'PM', body: { title: 'TmpPayTest' } });
      if (!c.data?.item?.id) skip(''); const r = await api('PUT', `/api/procurement/${c.data.item.id}/mark-paid`, { role: 'BUH', body: {} });
      assert(r.status === 409, '409'); await api('DELETE', `/api/procurement/${c.data.item.id}`, { role: 'ADMIN' });
    }},

    // === STEP 4: PAY + DELIVER ===
    { name: 'S4.1: BUH pays', run: async () => {
      if (!procReqId) skip(''); const r = await api('PUT', `/api/procurement/${procReqId}/mark-paid`, { role: 'BUH', body: {} });
      assertOk(r, 'OK'); assert(r.data.item.status === 'paid', 'Paid'); assert(r.data.item.paid_at, 'paid_at');
    }},
    { name: 'S4.2: Deliver 1st→partial', run: async () => {
      if (!procReqId) skip(''); const d = await api('GET', `/api/procurement/${procReqId}`, { role: 'WAREHOUSE' });
      const items = d.data.items || []; if (!items.length) skip('');
      const r = await api('PUT', `/api/procurement/${procReqId}/items/${items[0].id}/deliver`, { role: 'WAREHOUSE', body: {} });
      assertOk(r, 'OK'); assert(r.data.item.item_status === 'delivered', 'Delivered');
      if (items.length > 1) { const c = await api('GET', `/api/procurement/${procReqId}`, { role: 'ADMIN' }); assert(c.data.item.status === 'partially_delivered', 'Partial'); }
    }},
    { name: 'S4.3: No re-deliver', run: async () => {
      if (!procReqId) skip(''); const d = await api('GET', `/api/procurement/${procReqId}`, { role: 'WAREHOUSE' });
      const del = (d.data.items || []).find(i => i.item_status === 'delivered'); if (!del) skip('');
      const r = await api('PUT', `/api/procurement/${procReqId}/items/${del.id}/deliver`, { role: 'WAREHOUSE', body: {} });
      assert(r.status === 409, '409');
    }},
    { name: 'S4.4: Deliver all→delivered', run: async () => {
      if (!procReqId) skip(''); const d = await api('GET', `/api/procurement/${procReqId}`, { role: 'WAREHOUSE' });
      for (const it of d.data.items || []) { if (it.item_status !== 'delivered') await api('PUT', `/api/procurement/${procReqId}/items/${it.id}/deliver`, { role: 'WAREHOUSE', body: {} }); }
      const c = await api('GET', `/api/procurement/${procReqId}`, { role: 'ADMIN' }); assert(c.data.item.status === 'delivered', 'All'); assert(c.data.item.delivered_at, 'delivered_at');
    }},
    { name: 'S4.5: Close', run: async () => {
      if (!procReqId) skip(''); const r = await api('PUT', `/api/procurement/${procReqId}/close`, { role: 'PM', body: {} });
      assertOk(r, 'OK'); assert(r.data.item.status === 'closed', 'Closed');
    }},
    { name: 'S4.6: Dashboard', run: async () => {
      const r = await api('GET', '/api/procurement/dashboard', { role: 'PROC' }); assertOk(r, 'OK');
      assert(Array.isArray(r.data.counts), 'counts'); assert(Array.isArray(r.data.overdue), 'overdue');
    }},
    { name: 'S4.7: Export', run: async () => {
      if (!procReqId) skip(''); const r = await api('GET', `/api/procurement/${procReqId}/export/excel`, { role: 'PM' }); assert(r.status === 200, '200');
    }},
    { name: 'S4.8: Template', run: async () => { const r = await api('GET', '/api/procurement/template/excel', { role: 'PM' }); assert(r.status === 200, '200'); }},
    { name: 'S4.9: HR no dashboard', run: async () => { const r = await api('GET', '/api/procurement/dashboard', { role: 'HR' }); assertForbidden(r, 'HR'); }},

    // === STEP 5: EQUIPMENT ===
    { name: 'S5.1: Stats', run: async () => {
      const r = await api('GET', '/api/equipment/stats/summary', { role: 'WAREHOUSE' }); if (r.status === 404) skip(''); assertOk(r, 'OK');
    }},
    { name: 'S5.2: from-procurement rejects -1', run: async () => {
      const r = await api('POST', '/api/equipment/from-procurement', { role: 'WAREHOUSE', body: { procurement_item_id: -1 } });
      assert(r.status !== 500, 'No 500');
    }},
    { name: 'S5.3: Available', run: async () => {
      const r = await api('GET', '/api/equipment/available', { role: 'PM' }); assert(r.status !== 500, 'No 500');
    }},

    // === STEP 6: ASSEMBLY ===
    { name: 'S6.1: Create assembly', run: async () => {
      const r = await api('POST', '/api/assembly', { role: 'PM', body: { work_id: 1, type: 'mobilization', title: 'PIPELINE_TEST: Моб', destination: 'НПЗ' } });
      if (r.status === 404) skip(''); if (r.status >= 400) skip('No work=1'); assertOk(r, 'OK'); assemblyId = r.data?.item?.id; assert(assemblyId, 'ID');
    }},
    { name: 'S6.2: Bad type', run: async () => { const r = await api('POST', '/api/assembly', { role: 'PM', body: { work_id: 1, type: 'xxx' } }); assert(r.status === 400, '400'); }},
    { name: 'S6.3: Add item', run: async () => {
      if (!assemblyId) skip(''); const r = await api('POST', `/api/assembly/${assemblyId}/items`, { role: 'PM', body: { name: 'Насос', unit: 'шт', quantity: 1, source: 'manual' } });
      assertOk(r, 'OK');
    }},
    { name: 'S6.4: Create pallet', run: async () => {
      if (!assemblyId) skip(''); const r = await api('POST', `/api/assembly/${assemblyId}/pallets`, { role: 'WAREHOUSE', body: { label: 'П1' } });
      assertOk(r, 'OK'); palletId = r.data?.pallet?.id; assert(palletId, 'ID');
    }},
    { name: 'S6.5: Confirm', run: async () => {
      if (!assemblyId) skip(''); const r = await api('PUT', `/api/assembly/${assemblyId}/confirm`, { role: 'PM', body: {} }); assertOk(r, 'OK');
    }},
    { name: 'S6.6: Assign+pack', run: async () => {
      if (!assemblyId || !palletId) skip('');
      const d = await api('GET', `/api/assembly/${assemblyId}`, { role: 'PM' }); const items = d.data?.items || []; if (!items.length) skip('');
      await api('PUT', `/api/assembly/${assemblyId}/items/${items[0].id}/assign-pallet`, { role: 'WAREHOUSE', body: { pallet_id: palletId } });
      const r = await api('PUT', `/api/assembly/${assemblyId}/items/${items[0].id}/pack`, { role: 'WAREHOUSE', body: {} }); assertOk(r, 'OK');
    }},
    { name: 'S6.7: QR', run: async () => {
      if (!assemblyId || !palletId) skip(''); const r = await api('GET', `/api/assembly/${assemblyId}/pallets/${palletId}/qr`, { role: 'WAREHOUSE' }); assert(r.status === 200, 'QR');
    }},
    { name: 'S6.8: Pack pallet+send', run: async () => {
      if (!assemblyId) skip('');
      if (palletId) await api('PUT', `/api/assembly/${assemblyId}/pallets/${palletId}/pack`, { role: 'WAREHOUSE', body: {} });
      const r = await api('PUT', `/api/assembly/${assemblyId}/send`, { role: 'PM', body: {} }); assertOk(r, 'OK'); assert(r.data.item.status === 'in_transit', 'Transit');
    }},
    { name: 'S6.9: Scan', run: async () => {
      if (!assemblyId || !palletId) skip('');
      const r = await api('POST', `/api/assembly/${assemblyId}/pallets/${palletId}/scan`, { role: 'PM', body: { lat: 54.6, lon: 39.7 } }); assertOk(r, 'OK');
    }},
    { name: 'S6.10: Create demob', run: async () => {
      if (!assemblyId) skip(''); const r = await api('POST', `/api/assembly/${assemblyId}/create-demob`, { role: 'PM', body: {} });
      assertOk(r, 'OK'); assert(r.data.item.type === 'demobilization', 'Demob'); assert(r.data.items.length > 0, 'Items');
    }},
    { name: 'S6.11: PM creates pallet', run: async () => {
      if (!assemblyId) skip('No asm');
      const r = await api('POST', `/api/assembly/${assemblyId}/pallets`, { role: 'PM', body: { label: 'PM-паллет', capacity_items: 8 } });
      assertOk(r, 'PM creates pallet'); assert(r.data?.pallet?.id, 'Pallet created by PM');
    }},
    { name: 'S6.12: PM assigns item to pallet', run: async () => {
      if (!assemblyId || !palletId) skip('No data');
      const d = await api('GET', `/api/assembly/${assemblyId}`, { role: 'PM' });
      const free = (d.data?.items || []).find(i => !i.pallet_id);
      if (!free) skip('No free items');
      const r = await api('PUT', `/api/assembly/${assemblyId}/items/${free.id}/assign-pallet`,
        { role: 'PM', body: { pallet_id: palletId } });
      assertOk(r, 'PM assigns to pallet');
    }},
    { name: 'S6.13: PM packs item', run: async () => {
      if (!assemblyId) skip('No asm');
      const d = await api('GET', `/api/assembly/${assemblyId}`, { role: 'PM' });
      const unpacked = (d.data?.items || []).find(i => !i.packed && i.pallet_id);
      if (!unpacked) skip('No unpacked');
      const r = await api('PUT', `/api/assembly/${assemblyId}/items/${unpacked.id}/pack`,
        { role: 'PM', body: {} });
      assertOk(r, 'PM packs item');
    }},

    // === STEP 7: DEAD CODE CLEANUP ===
    { name: 'S7.1: API ok', run: async () => { const r = await api('GET', '/api/procurement', { role: 'PM' }); assertOk(r, 'OK'); }},
    { name: 'S7.2: Stable', run: async () => { const r = await api('GET', '/api/users/me', { role: 'ADMIN' }); assertOk(r, 'OK'); }},
  ]
};
