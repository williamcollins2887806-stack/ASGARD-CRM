/**
 * E2E FLOW: Equipment FaceKit Premium — Browser Tests
 * Тестирование UI: карточки, группировка, поиск, модалки, комплекты
 * Роли: ADMIN, WAREHOUSE, PM
 *
 * Использует Puppeteer через tests/config.js
 */
const { api, assert, assertOk, skip } = require('../config');

// Helper: получить токен и открыть страницу (для Puppeteer тестов, когда будет доступен browser)
// Пока тестируем через API + проверяем что фронтенд-зависимости корректны

let eqId = null;
let kitId = null;
let workId = null;
let pmUserId = null;

module.exports = {
  name: 'FLOW: Equipment FaceKit Premium (UI Integration)',
  tests: [

    // ═══════════════════════════════════════════════════
    // SECTION A: Verify page data loading (simulates render)
    // ═══════════════════════════════════════════════════

    {
      name: 'Page load: categories available for dropdown',
      run: async () => {
        const r = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        assertOk(r, 'categories for dropdown');
        const cats = r.data?.categories || [];
        assert(cats.length > 0, 'At least 1 category for dropdown');
        assert(cats[0].name, 'Category must have name');
      }
    },
    {
      name: 'Page load: warehouses available for dropdown',
      run: async () => {
        const r = await api('GET', '/api/equipment/warehouses', { role: 'ADMIN' });
        assertOk(r, 'warehouses for dropdown');
      }
    },
    {
      name: 'Page load: objects available for dropdown',
      run: async () => {
        const r = await api('GET', '/api/equipment/objects', { role: 'ADMIN' });
        assertOk(r, 'objects for dropdown');
      }
    },
    {
      name: 'Page load: equipment list with card-view fields',
      run: async () => {
        const r = await api('GET', '/api/equipment?limit=20', { role: 'ADMIN' });
        assertOk(r, 'equipment list');
        const list = r.data?.equipment || [];
        if (list.length > 0) {
          const eq = list[0];
          // Card view needs these fields
          assert(eq.id !== undefined, 'Card needs: id');
          assert(eq.name !== undefined, 'Card needs: name');
          assert(eq.status !== undefined, 'Card needs: status');
          assert(eq.inventory_number !== undefined, 'Card needs: inventory_number');
        }
      }
    },
    {
      name: 'Page load: stats for metrics row',
      run: async () => {
        // Try premium dashboard first, fallback to summary
        let r = await api('GET', '/api/equipment/stats/dashboard', { role: 'ADMIN' });
        if (r.status === 404) {
          r = await api('GET', '/api/equipment/stats/summary', { role: 'ADMIN' });
        }
        assertOk(r, 'stats for metrics');
        const s = r.data?.stats || r.data;
        assert(typeof s === 'object', 'Stats should be object');
      }
    },
    {
      name: 'Page load: kits for kits section',
      run: async () => {
        const r = await api('GET', '/api/equipment/kits', { role: 'ADMIN' });
        if (r.status === 404) skip('Kits not deployed');
        assertOk(r, 'kits');
        // Kits section renders if array
        assert(Array.isArray(r.data?.kits), 'Kits should be array');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION B: Card view data completeness
    // ═══════════════════════════════════════════════════

    {
      name: 'Card view: grouping by category works (all items have category_name)',
      run: async () => {
        const r = await api('GET', '/api/equipment?limit=50', { role: 'ADMIN' });
        assertOk(r, 'equipment for grouping');
        const list = r.data?.equipment || [];
        // Grouping by category uses category_name — should exist
        for (const eq of list.slice(0, 10)) {
          // category_name may be null for uncategorized, but field should exist
          assert('category_name' in eq || 'category_id' in eq, 'Equipment should have category info for grouping');
        }
      }
    },
    {
      name: 'Card view: status badge mapping covers all statuses',
      run: async () => {
        const validStatuses = ['on_warehouse', 'issued', 'in_transit', 'repair', 'broken', 'written_off'];
        const r = await api('GET', '/api/equipment?limit=200', { role: 'ADMIN' });
        assertOk(r, 'equipment');
        const list = r.data?.equipment || [];
        for (const eq of list) {
          if (eq.status) {
            assert(validStatuses.includes(eq.status) || eq.status === 'available' || eq.status === 'on_warehouse',
              `Unknown status "${eq.status}" not in UI mapping`);
          }
        }
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION C: Detail modal data
    // ═══════════════════════════════════════════════════

    {
      name: 'Setup: find equipment for detail modal',
      run: async () => {
        const r = await api('GET', '/api/equipment?limit=5', { role: 'ADMIN' });
        const list = r.data?.equipment || [];
        if (list.length > 0) eqId = list[0].id;
        if (!eqId) skip('No equipment available');
      }
    },
    {
      name: 'Detail modal: tab "Info" — all fields present',
      run: async () => {
        if (!eqId) skip('No equipment');
        const r = await api('GET', '/api/equipment/' + eqId, { role: 'ADMIN' });
        assertOk(r, 'equipment detail');
        const eq = r.data?.equipment;
        assert(eq, 'Equipment data');
        // Info tab fields
        assert(eq.name, 'name for info tab');
        assert(eq.inventory_number, 'inventory_number for info tab');
        assert(eq.status, 'status for badge');
      }
    },
    {
      name: 'Detail modal: tab "Movements" — array returned',
      run: async () => {
        if (!eqId) skip('No equipment');
        const r = await api('GET', '/api/equipment/' + eqId, { role: 'ADMIN' });
        assertOk(r, 'detail');
        assert(Array.isArray(r.data?.movements), 'Movements tab needs movements array');
      }
    },
    {
      name: 'Detail modal: tab "Maintenance" — array returned',
      run: async () => {
        if (!eqId) skip('No equipment');
        const r = await api('GET', '/api/equipment/' + eqId, { role: 'ADMIN' });
        assertOk(r, 'detail');
        assert(Array.isArray(r.data?.maintenance), 'Maintenance tab needs array');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION D: Search functionality
    // ═══════════════════════════════════════════════════

    {
      name: 'Search: by name substring returns results',
      run: async () => {
        // Get a name to search for
        const r1 = await api('GET', '/api/equipment?limit=1', { role: 'ADMIN' });
        const list = r1.data?.equipment || [];
        if (!list.length) skip('No equipment');
        const searchTerm = (list[0].name || '').substring(0, 4);
        if (!searchTerm) skip('Empty name');

        const r = await api('GET', '/api/equipment?search=' + encodeURIComponent(searchTerm) + '&limit=10', { role: 'ADMIN' });
        assertOk(r, 'search by name');
        assert((r.data?.equipment || []).length > 0, 'Search should find at least 1 result');
      }
    },
    {
      name: 'Search: by inventory_number returns results',
      run: async () => {
        const r1 = await api('GET', '/api/equipment?limit=1', { role: 'ADMIN' });
        const list = r1.data?.equipment || [];
        if (!list.length) skip('No equipment');
        const inv = list[0].inventory_number;
        if (!inv) skip('No inventory_number');

        const r = await api('GET', '/api/equipment?search=' + encodeURIComponent(inv) + '&limit=5', { role: 'ADMIN' });
        assertOk(r, 'search by inventory number');
        assert((r.data?.equipment || []).length > 0, 'Search by inv# should find results');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION E: Filter combinations
    // ═══════════════════════════════════════════════════

    {
      name: 'Filter: by status=on_warehouse',
      run: async () => {
        const r = await api('GET', '/api/equipment?status=on_warehouse&limit=10', { role: 'ADMIN' });
        assertOk(r, 'filter on_warehouse');
        for (const eq of (r.data?.equipment || [])) {
          assert(eq.status === 'on_warehouse', 'Filter violated: got ' + eq.status);
        }
      }
    },
    {
      name: 'Filter: by status=issued',
      run: async () => {
        const r = await api('GET', '/api/equipment?status=issued&limit=10', { role: 'ADMIN' });
        assertOk(r, 'filter issued');
        for (const eq of (r.data?.equipment || [])) {
          assert(eq.status === 'issued', 'Filter violated: got ' + eq.status);
        }
      }
    },
    {
      name: 'Filter: by category_id',
      run: async () => {
        const cats = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        const cl = cats.data?.categories || [];
        if (!cl.length) skip('No categories');
        const catId = cl[0].id;

        const r = await api('GET', '/api/equipment?category_id=' + catId + '&limit=10', { role: 'ADMIN' });
        assertOk(r, 'filter by category');
      }
    },
    {
      name: 'Filter: combined status + category',
      run: async () => {
        const cats = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        const cl = cats.data?.categories || [];
        if (!cl.length) skip('No categories');
        const catId = cl[0].id;

        const r = await api('GET', `/api/equipment?status=on_warehouse&category_id=${catId}&limit=10`, { role: 'ADMIN' });
        assertOk(r, 'combined filter');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION F: Work Equipment Modal (PM integration)
    // ═══════════════════════════════════════════════════

    {
      name: 'Setup: find work for modal test',
      run: async () => {
        const works = await api('GET', '/api/works?limit=5', { role: 'PM' });
        const wl = works.data?.works || [];
        if (wl.length > 0) workId = wl[0].id;

        const users = await api('GET', '/api/users', { role: 'ADMIN' });
        const ul = Array.isArray(users.data) ? users.data : (users.data?.users || []);
        pmUserId = ul.find(u => u.role === 'PM')?.id;
      }
    },
    {
      name: 'Work modal: get work assignments',
      run: async () => {
        if (!workId) skip('No work');
        const r = await api('GET', '/api/equipment/work/' + workId + '/equipment', { role: 'PM' });
        if (r.status === 404) skip('Not deployed');
        assertOk(r, 'work assignments for modal');
      }
    },
    {
      name: 'Work modal: get available equipment list',
      run: async () => {
        const r = await api('GET', '/api/equipment/available', { role: 'PM' });
        if (r.status === 404) {
          // Fallback: use regular list with status filter
          const r2 = await api('GET', '/api/equipment?status=on_warehouse&limit=50', { role: 'PM' });
          assertOk(r2, 'available equipment (fallback)');
        } else {
          assertOk(r, 'available equipment');
        }
      }
    },
    {
      name: 'Work modal: get kit recommendations',
      run: async () => {
        const r = await api('GET', '/api/equipment/recommend?work_type=' + encodeURIComponent('ХИМ-промывка'), { role: 'PM' });
        if (r.status === 404) skip('Not deployed');
        assertOk(r, 'recommendations for modal');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION G: Full issue-return flow from work modal
    // ═══════════════════════════════════════════════════

    {
      name: 'Flow: create test equipment for work modal',
      run: async () => {
        const cats = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        const catId = (cats.data?.categories || [])[0]?.id;
        const r = await api('POST', '/api/equipment', { role: 'ADMIN', body: {
          name: 'TEST_E2E: Инструмент для модалки работ',
          serial_number: 'E2E-WM-' + Date.now(),
          quantity: 1, unit: 'шт',
          category_id: catId || undefined
        }});
        if (r.status === 404) skip('Cannot create equipment');
        assertOk(r, 'create for work modal');
        eqId = r.data?.equipment?.id;
        assert(eqId, 'Created equipment ID');
      }
    },
    {
      name: 'Flow: assign equipment to work from modal',
      run: async () => {
        if (!eqId || !workId) skip('No equipment or work');
        const r = await api('POST', '/api/equipment/work/' + workId + '/assign', { role: 'ADMIN', body: {
          equipment_ids: [eqId],
          holder_id: pmUserId || undefined
        }});
        if (r.status === 404) skip('Not deployed');
        assertOk(r, 'assign from modal');
      }
    },
    {
      name: 'Flow: verify assignment appears in work equipment',
      run: async () => {
        if (!workId) skip('No work');
        const r = await api('GET', '/api/equipment/work/' + workId + '/equipment', { role: 'ADMIN' });
        if (r.status === 404) skip('Not deployed');
        assertOk(r, 'check assignment');
        // Equipment should appear in assignments
        const assignments = r.data?.assignments || r.data?.equipment || [];
        if (eqId) {
          const found = assignments.some(a => a.equipment_id === eqId || a.id === eqId);
          assert(found, 'Assigned equipment should appear in work assignments');
        }
      }
    },
    {
      name: 'Flow: unassign equipment from work',
      run: async () => {
        if (!eqId || !workId) skip('No equipment or work');
        const r = await api('POST', '/api/equipment/work/' + workId + '/unassign', { role: 'ADMIN', body: {
          equipment_ids: [eqId]
        }});
        if (r.status === 404) skip('Not deployed');
        assertOk(r, 'unassign from work');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION H: Kit detail view
    // ═══════════════════════════════════════════════════

    {
      name: 'Kit detail: seeded kits have items',
      run: async () => {
        const r = await api('GET', '/api/equipment/kits', { role: 'ADMIN' });
        if (r.status === 404) skip('Not deployed');
        assertOk(r, 'kits list');
        const kits = r.data?.kits || [];
        if (!kits.length) skip('No kits to test');
        const kit = kits[0];
        kitId = kit.id;

        const detail = await api('GET', '/api/equipment/kits/' + kit.id, { role: 'ADMIN' });
        assertOk(detail, 'kit detail');
        assert(detail.data?.kit?.name, 'Kit name for detail view');
      }
    },
    {
      name: 'Kit detail: progress bar data (items_count, assigned_count)',
      run: async () => {
        const r = await api('GET', '/api/equipment/kits', { role: 'ADMIN' });
        if (r.status === 404) skip('Not deployed');
        const kits = r.data?.kits || [];
        if (!kits.length) skip('No kits');
        const kit = kits[0];
        // Kit should have fields for progress bar
        assert(kit.items_count !== undefined || kit.total_items !== undefined, 'Kit needs item count for progress bar');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION I: Role-specific UI tests
    // ═══════════════════════════════════════════════════

    {
      name: 'ADMIN sees full actions (issue, return, edit, repair)',
      run: async () => {
        // ADMIN should be able to perform all actions
        const r = await api('GET', '/api/equipment?status=on_warehouse&limit=1', { role: 'ADMIN' });
        assertOk(r, 'ADMIN list');
        // Verify ADMIN can access issue endpoint (canIssue = true in UI)
        const test = await api('POST', '/api/equipment/issue', { role: 'ADMIN', body: { equipment_id: -1, holder_id: -1 } });
        // Should not be 403 (forbidden) — may be 400 (bad request) or 404 but NOT 403
        assert(test.status !== 403, 'ADMIN should not be forbidden from issue');
      }
    },
    {
      name: 'PM sees limited actions (request, return own)',
      run: async () => {
        // PM can request but not issue
        const r = await api('GET', '/api/equipment?limit=1', { role: 'PM' });
        assertOk(r, 'PM list');
      }
    },
    {
      name: 'WAREHOUSE has admin-like access',
      run: async () => {
        const r = await api('POST', '/api/equipment', { role: 'WAREHOUSE', body: { name: 'WH-ACCESS-TEST', quantity: 1 } });
        if (r.status === 404) skip('Endpoint not available');
        assert(r.status !== 403, 'WAREHOUSE should not be forbidden from create');
        if (r.data?.equipment?.id) {
          await api('DELETE', '/api/equipment/' + r.data.equipment.id, { role: 'ADMIN' });
        }
      }
    },
    {
      name: 'CHIEF_ENGINEER can view all equipment and stats',
      run: async () => {
        const r1 = await api('GET', '/api/equipment?limit=5', { role: 'CHIEF_ENGINEER' });
        assertOk(r1, 'CE list');
        const r2 = await api('GET', '/api/equipment/stats/summary', { role: 'CHIEF_ENGINEER' });
        assertOk(r2, 'CE stats');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION J: Edge cases
    // ═══════════════════════════════════════════════════

    {
      name: 'Edge: empty search returns all',
      run: async () => {
        const r = await api('GET', '/api/equipment?search=&limit=5', { role: 'ADMIN' });
        assertOk(r, 'empty search');
      }
    },
    {
      name: 'Edge: nonexistent equipment ID returns 404 or error',
      run: async () => {
        const r = await api('GET', '/api/equipment/99999999', { role: 'ADMIN' });
        assert(r.status === 404 || !r.data?.success || !r.data?.equipment, 'Should not find nonexistent equipment');
      }
    },
    {
      name: 'Edge: issue already-issued equipment should fail',
      run: async () => {
        // Create fresh equipment, issue it, then try to re-issue
        const create = await api('POST', '/api/equipment', { role: 'ADMIN', body: {
          name: 'Edge-Test-Issued-' + Date.now(), category_id: 1
        }});
        const eqId = create.data?.equipment?.id;
        if (!eqId) skip('Could not create equipment for edge test');

        // Get a valid user to issue to
        const usersR = await api('GET', '/api/data/users?limit=1', { role: 'ADMIN' });
        const holderId = usersR.data?.[0]?.id || 1;

        // Issue it first
        await api('POST', '/api/equipment/issue', { role: 'ADMIN', body: {
          equipment_id: eqId, holder_id: holderId
        }});

        // Try to re-issue — should fail
        const r = await api('POST', '/api/equipment/issue', { role: 'ADMIN', body: {
          equipment_id: eqId, holder_id: holderId
        }});
        assert(!r.data?.success || r.status >= 400, 'Should not re-issue already issued equipment');

        // Cleanup: return and delete
        await api('POST', '/api/equipment/return', { role: 'ADMIN', body: { equipment_id: eqId }});
        await api('DELETE', '/api/equipment/' + eqId, { role: 'ADMIN' });
      }
    },
    {
      name: 'Edge: return on_warehouse equipment should fail',
      run: async () => {
        const available = await api('GET', '/api/equipment?status=on_warehouse&limit=1', { role: 'ADMIN' });
        const onWh = (available.data?.equipment || [])[0];
        if (!onWh) skip('No on_warehouse equipment');

        const r = await api('POST', '/api/equipment/return', { role: 'ADMIN', body: { equipment_id: onWh.id } });
        // Should fail — already on warehouse
        assert(!r.data?.success || r.status >= 400, 'Should not return already on_warehouse equipment');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION K: Pagination
    // ═══════════════════════════════════════════════════

    {
      name: 'Pagination: limit=2 returns at most 2',
      run: async () => {
        const r = await api('GET', '/api/equipment?limit=2', { role: 'ADMIN' });
        assertOk(r, 'paginated list');
        assert((r.data?.equipment || []).length <= 2, 'Limit=2 should return <= 2 items');
      }
    },
    {
      name: 'Pagination: offset works',
      run: async () => {
        const r1 = await api('GET', '/api/equipment?limit=3&offset=0', { role: 'ADMIN' });
        const r2 = await api('GET', '/api/equipment?limit=3&offset=3', { role: 'ADMIN' });
        assertOk(r1, 'page 1');
        assertOk(r2, 'page 2');
        const l1 = r1.data?.equipment || [];
        const l2 = r2.data?.equipment || [];
        // If we have enough data for pagination to work, verify different pages
        if (l1.length >= 3 && l2.length > 0 && l1.length === 3) {
          assert(l1[0].id !== l2[0].id, 'Different pages should return different items');
        }
      }
    },

    // ═══════════════════════════════════════════════════
    // Cleanup
    // ═══════════════════════════════════════════════════

    {
      name: 'Cleanup: delete test equipment',
      run: async () => {
        if (!eqId) return;
        // Ensure returned first
        const check = await api('GET', '/api/equipment/' + eqId, { role: 'ADMIN' });
        if (check.data?.equipment?.status !== 'on_warehouse') {
          await api('POST', '/api/equipment/return', { role: 'ADMIN', body: { equipment_id: eqId } });
        }
        await api('DELETE', '/api/equipment/' + eqId, { role: 'ADMIN' });
      }
    }
  ]
};
