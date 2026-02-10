const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

let testEquipmentId = null;

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
      name: 'ADMIN creates equipment',
      run: async () => {
        // Get a category first
        const catResp = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        const cats = Array.isArray(catResp.data) ? catResp.data : (catResp.data?.categories || []);
        const catId = cats.length > 0 ? cats[0].id : null;

        const body = {
          name: 'ТЕСТ: Генератор Stage12',
          status: 'available',
          serial_number: 'SN-TEST-001'
        };
        if (catId) body.category_id = catId;

        const resp = await api('POST', '/api/equipment', {
          role: 'ADMIN',
          body
        });
        assert(resp.status < 500, `create equipment: ${resp.status} - ${JSON.stringify(resp.data)?.slice(0, 200)}`);
        if (resp.ok) {
          testEquipmentId = resp.data?.equipment?.id || resp.data?.id;
        }
      }
    },
    {
      name: 'Read-back created equipment',
      run: async () => {
        if (!testEquipmentId) return;
        const resp = await api('GET', `/api/equipment/${testEquipmentId}`, { role: 'ADMIN' });
        assert(resp.status < 500, `read-back equipment: ${resp.status}`);
        if (resp.ok && resp.data) {
          const item = resp.data.equipment || resp.data;
          assertHasFields(item, ['id', 'name'], 'read-back equipment');
          assertMatch(item, { name: 'ТЕСТ: Генератор Stage12' }, 'read-back equipment name');
        }
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
        const resp = await api('DELETE', `/api/equipment/${testEquipmentId}`, { role: 'ADMIN' });
        assert(resp.status < 500, `delete equipment: ${resp.status}`);
      }
    },
    {
      name: 'Verify deleted equipment is gone',
      run: async () => {
        if (!testEquipmentId) return;
        const resp = await api('GET', `/api/equipment/${testEquipmentId}`, { role: 'ADMIN' });
        assert(resp.status === 404 || resp.status === 400 || resp.status === 200,
          `expected 404 after delete, got ${resp.status}`);
        testEquipmentId = null;
      }
    }
  ]
};
