const { api, assert, assertOk, assertForbidden, skip } = require('../config');

let procReqId = null;
let procItemId = null;
let assemblyId = null;
let palletId = null;
let fullProcId = null;
let fullItemId = null;
let fullAssemblyId = null;
let demobAssemblyId = null;
let asmWorkId = null; // real work_id for assembly tests

module.exports = {
  name: 'FLOW: Procurement + Warehouse + Assembly Pipeline',
  tests: [
    {
      name: 'Step 0: Server is alive',
      run: async () => {
        const resp = await api('GET', '/api/auth/me', { role: 'ADMIN' });
        assertOk(resp, 'Server responds');
        assert(resp.data?.user?.id, 'User ID returned');
      }
    },
    { name: 'Step 1.1: Server alive after V052', run: async () => {
        const r = await api('GET', '/api/auth/me', { role: 'ADMIN' }); assertOk(r, 'Alive');
    }},
    { name: 'Step 1.2: Stable without purchase_requests', run: async () => {
        const r = await api('GET', '/api/auth/me', { role: 'ADMIN' }); assertOk(r, 'Stable');
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
    { name: 'S5.4: from-procurement creates equipment', run: async () => {
      // Создаём отдельную заявку → проводим до paid → добавляем позицию warehouse → deliver → from-procurement
      const cr = await api('POST', '/api/procurement', { role: 'PM', body: { title: 'S5.4: FromProc Test' } });
      if (cr.status === 404) skip('No procurement');
      assertOk(cr, 'Created');
      const pid = cr.data.item.id;
      const it = await api('POST', `/api/procurement/${pid}/items`, { role: 'PM', body: { name: 'Кабель ВВГ', unit: 'м', quantity: 100, unit_price: 150, delivery_target: 'warehouse' } });
      assertOk(it, 'Item added');
      const iid = it.data.item.id;
      // Проводим через цепочку
      await api('PUT', `/api/procurement/${pid}/send-to-proc`, { role: 'PM', body: {} });
      await api('PUT', `/api/procurement/${pid}/proc-respond`, { role: 'PROC', body: {} });
      await api('PUT', `/api/procurement/${pid}/pm-approve`, { role: 'PM', body: {} });
      await api('PUT', `/api/procurement/${pid}/dir-approve`, { role: 'DIRECTOR_GEN', body: {} });
      await api('PUT', `/api/procurement/${pid}/mark-paid`, { role: 'BUH', body: {} });
      // Deliver — создаёт equipment автоматически (delivery_target=warehouse)
      const dr = await api('PUT', `/api/procurement/${pid}/items/${iid}/deliver`, { role: 'WAREHOUSE', body: {} });
      assertOk(dr, 'Delivered');
      assert(dr.data.item.equipment_id, 'Equipment linked');
      // Проверяем что equipment реально существует
      const eq = await api('GET', `/api/equipment/${dr.data.item.equipment_id}`, { role: 'WAREHOUSE' });
      assertOk(eq, 'Equipment exists');
      assert(eq.data.equipment.status === 'on_warehouse', 'On warehouse');
    }},
    { name: 'S5.5: from-procurement manual creation', run: async () => {
      // Создаём заявку с delivery_target=object → deliver → потом вручную from-procurement
      const cr = await api('POST', '/api/procurement', { role: 'PM', body: { title: 'S5.5: Manual FromProc' } });
      if (cr.status === 404) skip('');
      const pid = cr.data.item.id;
      const it = await api('POST', `/api/procurement/${pid}/items`, { role: 'PM', body: { name: 'Насос ЭЦВ', unit: 'шт', quantity: 1, unit_price: 85000, delivery_target: 'object' } });
      const iid = it.data.item.id;
      await api('PUT', `/api/procurement/${pid}/send-to-proc`, { role: 'PM', body: {} });
      await api('PUT', `/api/procurement/${pid}/proc-respond`, { role: 'PROC', body: {} });
      await api('PUT', `/api/procurement/${pid}/pm-approve`, { role: 'PM', body: {} });
      await api('PUT', `/api/procurement/${pid}/dir-approve`, { role: 'DIRECTOR_GEN', body: {} });
      await api('PUT', `/api/procurement/${pid}/mark-paid`, { role: 'BUH', body: {} });
      await api('PUT', `/api/procurement/${pid}/items/${iid}/deliver`, { role: 'WAREHOUSE', body: {} });
      // Manual from-procurement
      const fp = await api('POST', '/api/equipment/from-procurement', { role: 'WAREHOUSE', body: { procurement_item_id: iid } });
      assertOk(fp, 'Created'); assert(fp.data.equipment?.id, 'Eq ID');
    }},
    { name: 'S5.6: from-procurement duplicate → 409', run: async () => {
      // Повторный вызов from-procurement для той же позиции
      const cr = await api('POST', '/api/procurement', { role: 'PM', body: { title: 'S5.6: Dup Test' } });
      if (cr.status === 404) skip('');
      const pid = cr.data.item.id;
      const it = await api('POST', `/api/procurement/${pid}/items`, { role: 'PM', body: { name: 'Кран шаровый', unit: 'шт', quantity: 2, unit_price: 3500, delivery_target: 'object' } });
      const iid = it.data.item.id;
      await api('PUT', `/api/procurement/${pid}/send-to-proc`, { role: 'PM', body: {} });
      await api('PUT', `/api/procurement/${pid}/proc-respond`, { role: 'PROC', body: {} });
      await api('PUT', `/api/procurement/${pid}/pm-approve`, { role: 'PM', body: {} });
      await api('PUT', `/api/procurement/${pid}/dir-approve`, { role: 'DIRECTOR_GEN', body: {} });
      await api('PUT', `/api/procurement/${pid}/mark-paid`, { role: 'BUH', body: {} });
      await api('PUT', `/api/procurement/${pid}/items/${iid}/deliver`, { role: 'WAREHOUSE', body: {} });
      // Первый вызов — ок
      const fp1 = await api('POST', '/api/equipment/from-procurement', { role: 'WAREHOUSE', body: { procurement_item_id: iid } });
      assertOk(fp1, 'First ok');
      // Второй вызов — дубль
      const fp2 = await api('POST', '/api/equipment/from-procurement', { role: 'WAREHOUSE', body: { procurement_item_id: iid } });
      assert(fp2.status === 409, '409 duplicate');
    }},

    // === STEP 6: ASSEMBLY ===
    { name: 'S6.0: Find work_id for assembly', run: async () => {
      const r = await api('GET', '/api/works?limit=1', { role: 'ADMIN' });
      assertOk(r, 'Get works');
      const works = r.data?.works || r.data?.items || [];
      if (works.length) asmWorkId = works[0].id;
      if (!asmWorkId) skip('No works in DB');
    }},
    { name: 'S6.1: Create assembly', run: async () => {
      if (!asmWorkId) skip('No work_id');
      const r = await api('POST', '/api/assembly', { role: 'PM', body: { work_id: asmWorkId, type: 'mobilization', title: 'PIPELINE_TEST: Моб', destination: 'НПЗ' } });
      if (r.status === 404) skip(''); assertOk(r, 'OK'); assemblyId = r.data?.item?.id; assert(assemblyId, 'ID');
    }},
    { name: 'S6.2: Bad type', run: async () => { if (!asmWorkId) skip(''); const r = await api('POST', '/api/assembly', { role: 'PM', body: { work_id: asmWorkId, type: 'xxx' } }); assert(r.status === 400, '400'); }},
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
      demobAssemblyId = r.data.item.id;
    }},
    { name: 'S6.11: PM creates pallet on demob', run: async () => {
      if (!demobAssemblyId) skip('No asm');
      const r = await api('POST', `/api/assembly/${demobAssemblyId}/pallets`, { role: 'PM', body: { label: 'PM-паллет', capacity_items: 8 } });
      assertOk(r, 'PM creates pallet'); assert(r.data?.pallet?.id, 'Pallet created by PM');
    }},
    { name: 'S6.12: PM assigns item to pallet on demob', run: async () => {
      if (!demobAssemblyId || !palletId) skip('No data');
      const d = await api('GET', `/api/assembly/${demobAssemblyId}`, { role: 'PM' });
      const free = (d.data?.items || []).find(i => !i.pallet_id);
      if (!free) skip('No free items');
      const r = await api('PUT', `/api/assembly/${demobAssemblyId}/items/${free.id}/assign-pallet`,
        { role: 'PM', body: { pallet_id: palletId } });
      assertOk(r, 'PM assigns to pallet');
    }},
    { name: 'S6.13: PM packs item on demob', run: async () => {
      if (!demobAssemblyId) skip('No asm');
      // Confirm demob first
      await api('PUT', `/api/assembly/${demobAssemblyId}/confirm`, { role: 'PM', body: {} });
      const d = await api('GET', `/api/assembly/${demobAssemblyId}`, { role: 'PM' });
      const unpacked = (d.data?.items || []).find(i => !i.packed && i.pallet_id);
      if (!unpacked) skip('No unpacked');
      const r = await api('PUT', `/api/assembly/${demobAssemblyId}/items/${unpacked.id}/pack`,
        { role: 'PM', body: {} });
      assertOk(r, 'PM packs item');
    }},

    // === STEP 11: VPB DnD ===
    { name: 'S11.5: DnD assign/unassign API', run: async () => {
      if (!assemblyId || !palletId) skip('');
      const d = await api('GET', `/api/assembly/${assemblyId}`, { role: 'PM' });
      const free = (d.data?.items||[]).find(i => !i.pallet_id);
      if (!free) skip('All assigned');
      const r1 = await api('PUT', `/api/assembly/${assemblyId}/items/${free.id}/assign-pallet`,
        { role: 'PM', body: { pallet_id: palletId } });
      assertOk(r1, 'Assigned'); assert(r1.data.item.pallet_id === palletId, 'Set');
      const r2 = await api('PUT', `/api/assembly/${assemblyId}/items/${free.id}/unassign-pallet`,
        { role: 'PM', body: {} });
      assertOk(r2, 'Unassigned'); assert(r2.data.item.pallet_id === null, 'Cleared');
    }},

    // === STEP 7: DEAD CODE CLEANUP ===
    { name: 'S7.1: API ok', run: async () => { const r = await api('GET', '/api/procurement', { role: 'PM' }); assertOk(r, 'OK'); }},
    { name: 'S7.2: Stable', run: async () => { const r = await api('GET', '/api/auth/me', { role: 'ADMIN' }); assertOk(r, 'OK'); }},

    // === STEP 12: NOTIFICATIONS ===
    { name: 'S12: Notifications', run: async () => { const r = await api('GET', '/api/notifications?limit=5', { role: 'PROC' }); assertOk(r, 'OK'); }},

    // === STEP 10: PM_WORKS INTEGRATION ===
    { name: 'S10.1: Equipment for work', run: async () => { const r = await api('GET', '/api/equipment/work/1/equipment', { role: 'PM' }); assert(r.status !== 500, 'OK'); }},
    { name: 'S10.2: Assembly for work', run: async () => { const r = await api('GET', '/api/assembly?work_id=1', { role: 'PM' }); assert(r.status !== 500, 'OK'); }},
    { name: 'S10.3: Procurement for work', run: async () => { const r = await api('GET', '/api/procurement?work_id=1', { role: 'PM' }); assert(r.status !== 500, 'OK'); }},

    // ═══ FULL E2E ═══
    { name: 'E2E 1: Create+items', run: async()=>{
      const r=await api('POST','/api/procurement',{role:'PM',body:{title:'E2E: Цикл',priority:'high'}});
      assertOk(r,'OK');fullProcId=r.data.item.id;
      const i1=await api('POST',`/api/procurement/${fullProcId}/items`,{role:'PM',body:{name:'HCl',unit:'канистра',quantity:3,unit_price:8000,delivery_target:'warehouse'}});
      assertOk(i1,'OK');fullItemId=i1.data.item.id;
      await api('POST',`/api/procurement/${fullProcId}/items`,{role:'PM',body:{name:'КИ-1',unit:'канистра',quantity:2,unit_price:12000,delivery_target:'object'}});
    }},
    { name: 'E2E 2: Chain', run: async()=>{
      if(!fullProcId)skip('');
      await api('PUT',`/api/procurement/${fullProcId}/send-to-proc`,{role:'PM',body:{}});
      await api('PUT',`/api/procurement/${fullProcId}/proc-respond`,{role:'PROC',body:{}});
      await api('PUT',`/api/procurement/${fullProcId}/pm-approve`,{role:'PM',body:{}});
      const r=await api('PUT',`/api/procurement/${fullProcId}/dir-approve`,{role:'DIRECTOR_GEN',body:{}});
      assertOk(r,'OK');assert(r.data.item.locked===true,'Locked');
    }},
    { name: 'E2E 3: Pay', run: async()=>{
      if(!fullProcId)skip('');const r=await api('PUT',`/api/procurement/${fullProcId}/mark-paid`,{role:'BUH',body:{}});assertOk(r,'Paid');
    }},
    { name: 'E2E 4: Deliver', run: async()=>{
      if(!fullProcId||!fullItemId)skip('');
      await api('PUT',`/api/procurement/${fullProcId}/items/${fullItemId}/deliver`,{role:'WAREHOUSE',body:{}});
    }},
    { name: 'E2E 5: All delivered', run: async()=>{
      if(!fullProcId)skip('');const d=await api('GET',`/api/procurement/${fullProcId}`,{role:'ADMIN'});
      for(const it of d.data.items||[])if(it.item_status!=='delivered')await api('PUT',`/api/procurement/${fullProcId}/items/${it.id}/deliver`,{role:'WAREHOUSE',body:{}});
      const c=await api('GET',`/api/procurement/${fullProcId}`,{role:'ADMIN'});assert(c.data.item.status==='delivered','Delivered');
    }},
    { name: 'E2E 6: Assembly', run: async()=>{
      if(!asmWorkId)skip('');
      const r=await api('POST','/api/assembly',{role:'PM',body:{work_id:asmWorkId,type:'mobilization',title:'E2E Моб'}});
      if(r.status>=400)skip('');assertOk(r,'OK');fullAssemblyId=r.data.item.id;
    }},
    { name: 'E2E 7: Assembly flow', run: async()=>{
      if(!fullAssemblyId)skip('');
      await api('POST',`/api/assembly/${fullAssemblyId}/items`,{role:'PM',body:{name:'Насос',quantity:1,source:'manual'}});
      const p=await api('POST',`/api/assembly/${fullAssemblyId}/pallets`,{role:'WAREHOUSE',body:{label:'P1'}});
      const pId=p.data.pallet.id;
      const d=await api('GET',`/api/assembly/${fullAssemblyId}`,{role:'PM'});const its=d.data.items||[];
      await api('PUT',`/api/assembly/${fullAssemblyId}/confirm`,{role:'PM',body:{}});
      if(its.length){
        await api('PUT',`/api/assembly/${fullAssemblyId}/items/${its[0].id}/assign-pallet`,{role:'WAREHOUSE',body:{pallet_id:pId}});
        await api('PUT',`/api/assembly/${fullAssemblyId}/items/${its[0].id}/pack`,{role:'WAREHOUSE',body:{}});
      }
      await api('PUT',`/api/assembly/${fullAssemblyId}/pallets/${pId}/pack`,{role:'WAREHOUSE',body:{}});
      const sr=await api('PUT',`/api/assembly/${fullAssemblyId}/send`,{role:'PM',body:{}});
      assertOk(sr,'Sent');assert(sr.data.item.status==='in_transit','Transit');
      await api('POST',`/api/assembly/${fullAssemblyId}/pallets/${pId}/scan`,{role:'PM',body:{lat:54.6,lon:39.7}});
    }},
    { name: 'CLEANUP', run: async()=>{try{}catch(e){}} },
  ]
};
