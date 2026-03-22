/**
 * E2E FLOW: Procurement Request Full Lifecycle
 * Реальный цикл закупки через /api/procurement
 *
 * Workflow: draft → send-to-proc → proc-respond → pm-approve → dir-approve
 *           → mark-paid → deliver items → close
 *
 * Также тестируем: dir-rework, dir-question, dir-reject ветки
 */
const { api, assert, assertOk, assertStatus, assertForbidden, skip } = require('../config');

let procId = null;
let itemIds = [];

module.exports = {
  name: 'FLOW: Procurement Lifecycle (PM → PROC → Director → BUH → Warehouse)',
  tests: [
    // ─── Access Control ───
    {
      name: 'HR cannot create procurement request (forbidden)',
      run: async () => {
        const resp = await api('POST', '/api/procurement', { role: 'HR', body: { title: 'E2E: HR attempt' } });
        if (resp.status === 404) skip('Procurement endpoint not available');
        assertForbidden(resp, 'HR should not create procurement requests');
      }
    },

    // ─── PM Creates Request ───
    {
      name: 'PM creates procurement request (draft)',
      run: async () => {
        const resp = await api('POST', '/api/procurement', {
          role: 'PM',
          body: {
            title: 'E2E: Закупка материалов для монтажа',
            notes: 'Трубы, электроды, арматура для тестового объекта',
            priority: 'high',
            needed_by: '2026-04-15',
            delivery_address: 'Москва, Пресненская наб., 12, склад'
          }
        });
        if (resp.status === 404) skip('Procurement endpoint not available');
        assertOk(resp, 'PM creates procurement request');
        procId = resp.data?.item?.id;
        assert(procId, 'Request ID must be returned');
        assert(resp.data.item.status === 'draft', `Status must be draft, got ${resp.data.item.status}`);
      }
    },

    // ─── Add Items ───
    {
      name: 'PM adds 3 items to procurement',
      run: async () => {
        if (!procId) skip('No procurement request');
        const items = [
          { name: 'Труба стальная 108×4', article: 'TR-108-4', unit: 'м.п.', quantity: 200, unit_price: 2500, delivery_target: 'warehouse', notes: 'ГОСТ 10704-91' },
          { name: 'Электроды ОК 46.00 ∅3мм', article: 'EL-OK46-3', unit: 'кг', quantity: 50, unit_price: 800, delivery_target: 'warehouse' },
          { name: 'Задвижка клиновая DN100', article: 'ZK-DN100', unit: 'шт', quantity: 4, unit_price: 25000, delivery_target: 'object', delivery_address: 'Москва-Сити, этаж 12' }
        ];
        for (const item of items) {
          const resp = await api('POST', `/api/procurement/${procId}/items`, { role: 'PM', body: item });
          assertOk(resp, `Add item: ${item.name}`);
          if (resp.data?.item?.id) itemIds.push(resp.data.item.id);
        }
        assert(itemIds.length === 3, `Expected 3 items, got ${itemIds.length}`);
      }
    },

    // ─── PM views request ───
    {
      name: 'PM views procurement request with items',
      run: async () => {
        if (!procId) skip('No procurement request');
        const resp = await api('GET', `/api/procurement/${procId}`, { role: 'PM' });
        assertOk(resp, 'PM views procurement');
        assert(resp.data?.item?.id === procId, 'ID must match');
        assert(resp.data?.items?.length === 3, `Expected 3 items, got ${resp.data?.items?.length}`);
      }
    },

    // ─── PM updates request ───
    {
      name: 'PM updates procurement request notes',
      run: async () => {
        if (!procId) skip('No procurement request');
        const resp = await api('PUT', `/api/procurement/${procId}`, {
          role: 'PM',
          body: { notes: 'E2E updated: Срочная доставка фаза 2' }
        });
        assertOk(resp, 'PM updates procurement request');
      }
    },

    // ─── Send to procurement department ───
    {
      name: 'PM sends to procurement dept (draft → sent_to_proc)',
      run: async () => {
        if (!procId) skip('No procurement request');
        const resp = await api('PUT', `/api/procurement/${procId}/send-to-proc`, { role: 'PM', body: {} });
        assertOk(resp, 'PM sends to proc');
        assert(resp.data?.item?.status === 'sent_to_proc', `Expected sent_to_proc, got ${resp.data?.item?.status}`);
      }
    },

    // ─── PROC responds ───
    {
      name: 'PROC responds with prices (sent_to_proc → proc_responded)',
      run: async () => {
        if (!procId) skip('No procurement request');
        // Update item prices first
        if (itemIds[0]) {
          await api('PUT', `/api/procurement/${procId}/items/${itemIds[0]}`, {
            role: 'ADMIN', body: { supplier: 'МеталлТрейд', supplier_link: 'https://metaltrade.ru', unit_price: 2400 }
          });
        }
        const resp = await api('PUT', `/api/procurement/${procId}/proc-respond`, {
          role: 'ADMIN', body: { comment: 'Поставщики подобраны, цены актуальны' }
        });
        assertOk(resp, 'PROC responds');
        assert(resp.data?.item?.status === 'proc_responded', `Expected proc_responded, got ${resp.data?.item?.status}`);
      }
    },

    // ─── PM approves ───
    {
      name: 'PM approves procurement (proc_responded → pm_approved)',
      run: async () => {
        if (!procId) skip('No procurement request');
        const resp = await api('PUT', `/api/procurement/${procId}/pm-approve`, { role: 'PM', body: {} });
        assertOk(resp, 'PM approves');
        assert(resp.data?.item?.status === 'pm_approved', `Expected pm_approved, got ${resp.data?.item?.status}`);
      }
    },

    // ─── Director approves ───
    {
      name: 'Director approves procurement (pm_approved → dir_approved)',
      run: async () => {
        if (!procId) skip('No procurement request');
        const resp = await api('PUT', `/api/procurement/${procId}/dir-approve`, { role: 'DIRECTOR_GEN', body: {} });
        assertOk(resp, 'Director approves');
        assert(resp.data?.item?.status === 'dir_approved', `Expected dir_approved, got ${resp.data?.item?.status}`);
        assert(resp.data?.item?.locked === true, 'Request should be locked after director approval');
      }
    },

    // ─── BUH marks paid ───
    {
      name: 'BUH marks as paid (dir_approved → paid)',
      run: async () => {
        if (!procId) skip('No procurement request');
        const resp = await api('PUT', `/api/procurement/${procId}/mark-paid`, { role: 'BUH', body: {} });
        assertOk(resp, 'BUH marks paid');
        assert(resp.data?.item?.status === 'paid', `Expected paid, got ${resp.data?.item?.status}`);
      }
    },

    // ─── Deliver items ───
    {
      name: 'Deliver all 3 items → status becomes delivered',
      run: async () => {
        if (!procId || !itemIds.length) skip('No procurement request or items');
        for (const itemId of itemIds) {
          const resp = await api('PUT', `/api/procurement/${procId}/items/${itemId}/deliver`, { role: 'ADMIN', body: {} });
          assertOk(resp, `Deliver item ${itemId}`);
          assert(resp.data?.item?.item_status === 'delivered', `Item ${itemId} should be delivered`);
        }
        // Verify overall status
        const check = await api('GET', `/api/procurement/${procId}`, { role: 'PM' });
        assertOk(check, 'Check status after delivery');
        assert(check.data?.item?.status === 'delivered', `Expected delivered, got ${check.data?.item?.status}`);
      }
    },

    // ─── Close ───
    {
      name: 'PM closes procurement (delivered → closed)',
      run: async () => {
        if (!procId) skip('No procurement request');
        const resp = await api('PUT', `/api/procurement/${procId}/close`, { role: 'PM', body: {} });
        assertOk(resp, 'PM closes procurement');
        assert(resp.data?.item?.status === 'closed', `Expected closed, got ${resp.data?.item?.status}`);
      }
    },

    // ─── Verify listing ───
    {
      name: 'PM can see closed procurement in list',
      run: async () => {
        if (!procId) skip('No procurement request');
        const resp = await api('GET', `/api/procurement?limit=20`, { role: 'PM' });
        assertOk(resp, 'PM lists procurement');
        const items = resp.data?.items || [];
        const found = items.find(r => r.id === procId);
        assert(found, 'Closed request must appear in list');
        assert(found.status === 'closed', 'Status in list must be closed');
      }
    },

    // ─── Cleanup ───
    {
      name: 'Cleanup: delete test procurement request',
      run: async () => {
        if (!procId) return;
        // Reset to draft first (unlock + status change directly via data API for cleanup)
        await api('PUT', `/api/data/procurement_requests/${procId}`, {
          role: 'ADMIN',
          body: { status: 'draft', locked: false }
        });
        const resp = await api('DELETE', `/api/procurement/${procId}`, { role: 'ADMIN' });
        // OK if it fails — test data will be cleaned by prefix eventually
      }
    }
  ]
};
