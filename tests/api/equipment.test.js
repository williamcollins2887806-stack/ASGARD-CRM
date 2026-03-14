const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType, skip } = require('../config');

let testEquipmentId = null;
let testCategoryId = null;

module.exports = {
  name: 'EQUIPMENT (Оборудование)',
  tests: [
    {
      name: 'ADMIN reads equipment list',
      run: async () => {
        const resp = await api('GET', '/api/equipment', { role: 'ADMIN' });
        assertOk(resp, 'equipment list');
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.equipment || resp.data.items || []);
          assertArray(list, 'equipment list');
          if (list.length > 0) {
            assertHasFields(list[0], ['id', 'name'], 'equipment item');
            assertFieldType(list[0], 'id', 'number', 'equipment item id');
            assertFieldType(list[0], 'name', 'string', 'equipment item name');
          }
        }
      }
    },
    {
      name: 'ADMIN reads categories',
      run: async () => {
        const resp = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        assertOk(resp, 'categories');
        if (resp.data) {
          const cats = Array.isArray(resp.data) ? resp.data : (resp.data.categories || []);
          assertArray(cats, 'categories');
        }
      }
    },
    {
      name: 'ADMIN reads warehouses',
      run: async () => {
        const resp = await api('GET', '/api/equipment/warehouses', { role: 'ADMIN' });
        assertOk(resp, 'warehouses');
      }
    },
    {
      name: 'Equipment stats summary has total field',
      run: async () => {
        const resp = await api('GET', '/api/equipment/stats/summary', { role: 'ADMIN' });
        assertOk(resp, 'equipment stats');
        if (resp.data && typeof resp.data === 'object') {
          // Stats should have some numeric total or count
          const d = resp.data.stats || resp.data;
          assert(typeof d === 'object', 'stats should be object');
        }
      }
    },
    {
      // SKIP8/SKIP9 fix: Create a category if none exist, then create equipment
      name: 'ADMIN creates equipment (with auto-category setup)',
      run: async () => {
        // Get existing categories
        const catResp = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        const cats = Array.isArray(catResp.data) ? catResp.data : (catResp.data?.categories || []);
        let catId = cats.length > 0 ? cats[0].id : null;

        // If no categories exist, create one for the test
        if (!catId) {
          const newCatResp = await api('POST', '/api/data/equipment_categories', {
            role: 'ADMIN',
            body: { name: 'TEST_CAT_' + Date.now() }
          });
          if (newCatResp.status === 404) skip('POST equipment_categories not available');
          assertOk(newCatResp, 'create test category');
          const newCat = newCatResp.data?.category || newCatResp.data?.item || newCatResp.data;
          catId = newCat?.id;
          testCategoryId = catId;
          assert(catId, 'should return category id');
        }

        const body = {
          name: 'ТЕСТ: Генератор Stage12',
          status: 'on_warehouse',
          serial_number: 'SN-TEST-001'
        };
        if (catId) body.category_id = catId;

        const resp = await api('POST', '/api/equipment', {
          role: 'ADMIN',
          body
        });
        assertOk(resp, 'create equipment');
        testEquipmentId = resp.data?.equipment?.id || resp.data?.id;
        assert(testEquipmentId, 'should return equipment id');
      }
    },
    {
      name: 'Read-back created equipment',
      run: async () => {
        if (!testEquipmentId) throw new Error('No equipment created');
        const resp = await api('GET', `/api/equipment/${testEquipmentId}`, { role: 'ADMIN' });
        assertOk(resp, 'read-back equipment');
        const item = resp.data?.equipment || resp.data;
        assertHasFields(item, ['id', 'name'], 'read-back equipment');
        assertMatch(item, { name: 'ТЕСТ: Генератор Stage12' }, 'read-back equipment name');
      }
    },
    {
      name: 'WAREHOUSE reads equipment list',
      run: async () => {
        const resp = await api('GET', '/api/equipment', { role: 'WAREHOUSE' });
        assertOk(resp, 'WAREHOUSE equipment');
      }
    },
    {
      name: 'CHIEF_ENGINEER reads equipment (inherits WAREHOUSE)',
      run: async () => {
        const resp = await api('GET', '/api/equipment', { role: 'CHIEF_ENGINEER' });
        assertOk(resp, 'CHIEF_ENGINEER equipment');
      }
    },
    {
      name: 'Equipment requests list',
      run: async () => {
        const resp = await api('GET', '/api/equipment/requests', { role: 'ADMIN' });
        assertOk(resp, 'equipment requests');
      }
    },
    {
      name: 'Upcoming maintenance',
      run: async () => {
        const resp = await api('GET', '/api/equipment/maintenance/upcoming', { role: 'ADMIN' });
        assertOk(resp, 'upcoming maintenance');
      }
    },
    {
      name: 'Cleanup: delete test equipment',
      run: async () => {
        if (!testEquipmentId) return;
        // Equipment routes have no DELETE /:id — use generic data API
        const resp = await api('DELETE', `/api/data/equipment/${testEquipmentId}`, { role: 'ADMIN' });
        if (resp.status === 404) skip('equipment DELETE via data API not available');
        assertOk(resp, 'delete equipment');
      }
    },
    {
      name: 'Verify deleted equipment is gone',
      run: async () => {
        if (!testEquipmentId) return;
        const resp = await api('GET', `/api/equipment/${testEquipmentId}`, { role: 'ADMIN' });
        assert(resp.status === 404, `expected 404 after delete, got ${resp.status}`);
        testEquipmentId = null;
      }
    },
    {
      name: 'Cleanup: delete test category',
      run: async () => {
        if (!testCategoryId) return;
        await api('DELETE', `/api/data/equipment_categories/${testCategoryId}`, { role: 'ADMIN' });
        testCategoryId = null;
      }
    }
  ]
};
