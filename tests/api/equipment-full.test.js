const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, skip } = require('../config');

let testEquipmentId = null;
let testCategoryId = null;
let testWorkId = null;
let testHolderId = null;

module.exports = {
  name: 'EQUIPMENT FULL (Полный цикл оборудования)',
  tests: [
    // ═══════════════════════════════════════
    // SETUP: find FK references
    // ═══════════════════════════════════════
    {
      name: 'Setup: find work and holder for FK',
      run: async () => {
        const worksResp = await api('GET', '/api/works?limit=1', { role: 'ADMIN' });
        assertOk(worksResp, 'get works');
        const works = Array.isArray(worksResp.data) ? worksResp.data : (worksResp.data?.works || worksResp.data?.data || []);
        if (works.length > 0) testWorkId = works[0].id;

        const usersResp = await api('GET', '/api/users', { role: 'ADMIN' });
        if (usersResp.ok) {
          const users = Array.isArray(usersResp.data) ? usersResp.data : (usersResp.data?.users || usersResp.data?.data || []);
          const pm = users.find(u => u.role === 'PM') || users.find(u => u.role === 'ADMIN') || users[0];
          if (pm) testHolderId = pm.id;
        }
      }
    },

    // ═══════════════════════════════════════
    // 1. ADMIN reads categories
    // ═══════════════════════════════════════
    {
      name: 'ADMIN reads equipment categories',
      run: async () => {
        const resp = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        assertOk(resp, 'categories');
        const cats = Array.isArray(resp.data) ? resp.data : (resp.data?.categories || []);
        assertArray(cats, 'categories');
      }
    },

    // ═══════════════════════════════════════
    // 2. ADMIN reads objects
    // ═══════════════════════════════════════
    {
      name: 'ADMIN reads objects',
      run: async () => {
        const resp = await api('GET', '/api/equipment/objects', { role: 'ADMIN' });
        assertOk(resp, 'objects');
        const objs = Array.isArray(resp.data) ? resp.data : (resp.data?.objects || []);
        assertArray(objs, 'objects');
      }
    },

    // ═══════════════════════════════════════
    // 3. ADMIN reads warehouses
    // ═══════════════════════════════════════
    {
      name: 'ADMIN reads warehouses',
      run: async () => {
        const resp = await api('GET', '/api/equipment/warehouses', { role: 'ADMIN' });
        assertOk(resp, 'warehouses');
        const wh = Array.isArray(resp.data) ? resp.data : (resp.data?.warehouses || []);
        assertArray(wh, 'warehouses');
      }
    },

    // ═══════════════════════════════════════
    // 4. ADMIN reads equipment list
    // ═══════════════════════════════════════
    {
      name: 'ADMIN reads equipment list',
      run: async () => {
        const resp = await api('GET', '/api/equipment', { role: 'ADMIN' });
        assertOk(resp, 'equipment list');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.equipment || resp.data?.items || []);
        assertArray(list, 'equipment list');
      }
    },

    // ═══════════════════════════════════════
    // 5. ADMIN creates equipment (with auto-category setup)
    // ═══════════════════════════════════════
    {
      name: 'ADMIN creates equipment',
      run: async () => {
        // Resolve or create a category
        const catResp = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        const cats = Array.isArray(catResp.data) ? catResp.data : (catResp.data?.categories || []);
        let catId = cats.length > 0 ? cats[0].id : null;

        if (!catId) {
          const newCatResp = await api('POST', '/api/data/equipment_categories', {
            role: 'ADMIN',
            body: { name: 'E2E_CAT_' + Date.now() }
          });
          if (newCatResp.status === 404) skip('POST equipment_categories not available');
          assertOk(newCatResp, 'create test category');
          const newCat = newCatResp.data?.category || newCatResp.data?.item || newCatResp.data;
          catId = newCat?.id;
          testCategoryId = catId;
          assert(catId, 'should return category id');
        }

        // Resolve warehouse
        const whResp = await api('GET', '/api/equipment/warehouses', { role: 'ADMIN' });
        const whs = Array.isArray(whResp.data) ? whResp.data : (whResp.data?.warehouses || []);
        const warehouseId = whs.length > 0 ? whs[0].id : undefined;

        const ts = Date.now();
        const body = {
          name: 'E2E Генератор Full-' + ts,
          serial_number: 'SN-FULL-' + ts,
          status: 'available',
          purchase_price: 50000,
          purchase_date: '2025-01-15'
        };
        if (catId) body.category_id = catId;
        if (warehouseId) body.warehouse_id = warehouseId;

        const resp = await api('POST', '/api/equipment', { role: 'ADMIN', body });
        assertOk(resp, 'create equipment');
        testEquipmentId = resp.data?.equipment?.id || resp.data?.id;
        assert(testEquipmentId, 'should return equipment id');
      }
    },

    // ═══════════════════════════════════════
    // 6. Read-back by ID
    // ═══════════════════════════════════════
    {
      name: 'Read-back equipment by ID',
      run: async () => {
        if (!testEquipmentId) skip('No equipment created');
        const resp = await api('GET', `/api/equipment/${testEquipmentId}`, { role: 'ADMIN' });
        assertOk(resp, 'read-back equipment');
        const item = resp.data?.equipment || resp.data;
        assertHasFields(item, ['id', 'name'], 'equipment detail');
        assert(item.id === testEquipmentId, `id mismatch: expected ${testEquipmentId}, got ${item.id}`);
      }
    },

    // ═══════════════════════════════════════
    // 7. ADMIN updates equipment
    // ═══════════════════════════════════════
    {
      name: 'ADMIN updates equipment',
      run: async () => {
        if (!testEquipmentId) skip('No equipment created');
        const resp = await api('PUT', `/api/equipment/${testEquipmentId}`, {
          role: 'ADMIN',
          body: { notes: 'Updated by E2E full test' }
        });
        assertOk(resp, 'update equipment');
        const item = resp.data?.equipment || resp.data;
        assertHasFields(item, ['id'], 'updated equipment');
      }
    },

    // ═══════════════════════════════════════
    // 8. Issue equipment
    // ═══════════════════════════════════════
    {
      name: 'ADMIN issues equipment from warehouse',
      run: async () => {
        if (!testEquipmentId) skip('No equipment created');
        if (!testWorkId) skip('No work found for FK');

        // Ensure equipment is on_warehouse before issuing
        const detail = await api('GET', `/api/equipment/${testEquipmentId}`, { role: 'ADMIN' });
        const eq = detail.data?.equipment || detail.data;
        if (eq?.status !== 'on_warehouse') skip('Equipment not on_warehouse, cannot issue');

        const resp = await api('POST', '/api/equipment/issue', {
          role: 'ADMIN',
          body: {
            equipment_id: testEquipmentId,
            holder_id: testHolderId,
            work_id: testWorkId,
            notes: 'E2E issue test'
          }
        });
        assertOk(resp, 'issue equipment');
      }
    },

    // ═══════════════════════════════════════
    // 9. Return equipment
    // ═══════════════════════════════════════
    {
      name: 'ADMIN returns equipment to warehouse',
      run: async () => {
        if (!testEquipmentId) skip('No equipment created');

        // Verify it was issued
        const detail = await api('GET', `/api/equipment/${testEquipmentId}`, { role: 'ADMIN' });
        const eq = detail.data?.equipment || detail.data;
        if (eq?.status !== 'issued') skip('Equipment not issued, cannot return');

        const resp = await api('POST', '/api/equipment/return', {
          role: 'ADMIN',
          body: {
            equipment_id: testEquipmentId,
            condition_after: 'good',
            notes: 'E2E return test'
          }
        });
        assertOk(resp, 'return equipment');
      }
    },

    // ═══════════════════════════════════════
    // 10. Reserve equipment
    // ═══════════════════════════════════════
    {
      name: 'ADMIN reserves equipment',
      run: async () => {
        if (!testEquipmentId) skip('No equipment created');
        if (!testWorkId) skip('No work found for FK');

        const from = new Date();
        from.setDate(from.getDate() + 30);
        const to = new Date();
        to.setDate(to.getDate() + 37);

        const resp = await api('POST', '/api/equipment/reserve', {
          role: 'ADMIN',
          body: {
            equipment_id: testEquipmentId,
            work_id: testWorkId,
            reserved_from: from.toISOString().split('T')[0],
            reserved_to: to.toISOString().split('T')[0],
            notes: 'E2E reserve test'
          }
        });
        assertOk(resp, 'reserve equipment');
        const reservation = resp.data?.reservation || resp.data;
        assertHasFields(reservation, ['id'], 'reservation');
      }
    },

    // ═══════════════════════════════════════
    // 11. Add maintenance record
    // ═══════════════════════════════════════
    {
      name: 'ADMIN adds maintenance record',
      run: async () => {
        if (!testEquipmentId) skip('No equipment created');

        const resp = await api('POST', `/api/equipment/${testEquipmentId}/maintenance`, {
          role: 'ADMIN',
          body: {
            maintenance_type: 'inspection',
            description: 'E2E maintenance test inspection',
            cost: 5000
          }
        });
        assertOk(resp, 'add maintenance');
        const maint = resp.data?.maintenance || resp.data;
        assertHasFields(maint, ['id'], 'maintenance record');
      }
    },

    // ═══════════════════════════════════════
    // 12. Available equipment
    // ═══════════════════════════════════════
    {
      name: 'ADMIN reads available equipment',
      run: async () => {
        const resp = await api('GET', '/api/equipment/available', { role: 'ADMIN' });
        assertOk(resp, 'available equipment');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.equipment || []);
        assertArray(list, 'available equipment');
      }
    },

    // ═══════════════════════════════════════
    // 13. Stats summary
    // ═══════════════════════════════════════
    {
      name: 'ADMIN reads stats summary',
      run: async () => {
        const resp = await api('GET', '/api/equipment/stats/summary', { role: 'ADMIN' });
        assertOk(resp, 'stats summary');
        const stats = resp.data?.stats || resp.data;
        assert(typeof stats === 'object', 'stats should be object');
        assertHasFields(stats, ['total'], 'stats fields');
      }
    },

    // ═══════════════════════════════════════
    // 14. Equipment requests
    // ═══════════════════════════════════════
    {
      name: 'ADMIN reads equipment requests',
      run: async () => {
        const resp = await api('GET', '/api/equipment/requests', { role: 'ADMIN' });
        assertOk(resp, 'equipment requests');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.requests || []);
        assertArray(list, 'equipment requests');
      }
    },

    // ═══════════════════════════════════════
    // 15. WAREHOUSE can create equipment
    // ═══════════════════════════════════════
    {
      name: 'WAREHOUSE can create equipment (allowed role)',
      run: async () => {
        const catResp = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        const cats = Array.isArray(catResp.data) ? catResp.data : (catResp.data?.categories || []);
        const catId = cats.length > 0 ? cats[0].id : undefined;

        const body = {
          name: 'E2E WAREHOUSE equip-' + Date.now(),
          serial_number: 'SN-WH-' + Date.now(),
          status: 'available'
        };
        if (catId) body.category_id = catId;

        const resp = await api('POST', '/api/equipment', { role: 'WAREHOUSE', body });
        assertOk(resp, 'WAREHOUSE create equipment');
        const id = resp.data?.equipment?.id || resp.data?.id;
        // Cleanup inline
        if (id) {
          await api('DELETE', `/api/data/equipment/${id}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══════════════════════════════════════
    // 16. CHIEF_ENGINEER can create equipment
    // ═══════════════════════════════════════
    {
      name: 'CHIEF_ENGINEER can create equipment (allowed role)',
      run: async () => {
        const catResp = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        const cats = Array.isArray(catResp.data) ? catResp.data : (catResp.data?.categories || []);
        const catId = cats.length > 0 ? cats[0].id : undefined;

        const body = {
          name: 'E2E CE equip-' + Date.now(),
          serial_number: 'SN-CE-' + Date.now(),
          status: 'available'
        };
        if (catId) body.category_id = catId;

        const resp = await api('POST', '/api/equipment', { role: 'CHIEF_ENGINEER', body });
        assertOk(resp, 'CHIEF_ENGINEER create equipment');
        const id = resp.data?.equipment?.id || resp.data?.id;
        if (id) {
          await api('DELETE', `/api/data/equipment/${id}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══════════════════════════════════════
    // 17. NEGATIVE: PM cannot create equipment
    // ═══════════════════════════════════════
    {
      name: 'NEGATIVE: PM cannot create equipment → 403',
      run: async () => {
        const resp = await api('POST', '/api/equipment', {
          role: 'PM',
          body: { name: 'forbidden-pm', serial_number: 'SN-FORBIDDEN-PM' }
        });
        assertForbidden(resp, 'PM create equipment');
      }
    },

    // ═══════════════════════════════════════
    // 18. NEGATIVE: HR cannot create equipment
    // ═══════════════════════════════════════
    {
      name: 'NEGATIVE: HR cannot create equipment → 403',
      run: async () => {
        const resp = await api('POST', '/api/equipment', {
          role: 'HR',
          body: { name: 'forbidden-hr', serial_number: 'SN-FORBIDDEN-HR' }
        });
        assertForbidden(resp, 'HR create equipment');
      }
    },

    // ═══════════════════════════════════════
    // 19. NEGATIVE: BUH cannot create equipment
    // ═══════════════════════════════════════
    {
      name: 'NEGATIVE: BUH cannot create equipment → 403',
      run: async () => {
        const resp = await api('POST', '/api/equipment', {
          role: 'BUH',
          body: { name: 'forbidden-buh', serial_number: 'SN-FORBIDDEN-BUH' }
        });
        assertForbidden(resp, 'BUH create equipment');
      }
    },

    // ═══════════════════════════════════════
    // 20. NEGATIVE: HR cannot issue equipment
    // ═══════════════════════════════════════
    {
      name: 'NEGATIVE: HR cannot issue equipment → 403',
      run: async () => {
        const resp = await api('POST', '/api/equipment/issue', {
          role: 'HR',
          body: { equipment_id: testEquipmentId || 999, holder_id: 1, work_id: testWorkId || 1 }
        });
        assertForbidden(resp, 'HR issue equipment');
      }
    },

    // ═══════════════════════════════════════
    // 21. NEGATIVE: BUH cannot add maintenance
    // ═══════════════════════════════════════
    {
      name: 'NEGATIVE: BUH cannot add maintenance → 403',
      run: async () => {
        const eqId = testEquipmentId || 999;
        const resp = await api('POST', `/api/equipment/${eqId}/maintenance`, {
          role: 'BUH',
          body: { maintenance_type: 'inspection', description: 'forbidden' }
        });
        assertForbidden(resp, 'BUH add maintenance');
      }
    },

    // ═══════════════════════════════════════
    // 22. Cleanup: delete test equipment
    // ═══════════════════════════════════════
    {
      name: 'Cleanup: delete test equipment',
      run: async () => {
        if (!testEquipmentId) return;
        // Try soft-delete first (decommission) to avoid FK constraint violations
        const softResp = await api('PUT', `/api/equipment/${testEquipmentId}`, {
          role: 'ADMIN',
          body: { notes: 'Decommissioned by E2E cleanup' }
        });
        const resp = await api('DELETE', `/api/data/equipment/${testEquipmentId}`, { role: 'ADMIN' });
        if (resp.status === 404) skip('equipment DELETE via data API not available');
        // Accept 400 (FK constraint) — cleanup is best-effort
        if (resp.status === 400) {
          // FK constraint prevents deletion; that's OK for cleanup
          testEquipmentId = null;
          return;
        }
        assertOk(resp, 'delete equipment');
        testEquipmentId = null;
      }
    },

    // ═══════════════════════════════════════
    // 23. Cleanup: delete test category
    // ═══════════════════════════════════════
    {
      name: 'Cleanup: delete test category if created',
      run: async () => {
        if (!testCategoryId) return;
        await api('DELETE', `/api/data/equipment_categories/${testCategoryId}`, { role: 'ADMIN' });
        testCategoryId = null;
      }
    }
  ]
};
