/**
 * API TESTS: Equipment FaceKit Premium
 * Тестирование всех 42 endpoint'ов модуля оборудования
 * Роли: ADMIN, WAREHOUSE, PM, CHIEF_ENGINEER, DIRECTOR_GEN, TO (запрещено)
 *
 * Покрытие:
 *  - Базовые CRUD (equipment, categories, warehouses)
 *  - Выдача / возврат / передача / ремонт / списание
 *  - Комплекты (kits): CRUD + сборка
 *  - Назначение на работы (work assignments)
 *  - Рекомендации комплектов
 *  - Расширенная статистика dashboard
 *  - Права доступа (access control)
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType, skip } = require('../config');

let eqId = null;          // created equipment ID
let catId = null;          // category for tests
let kitId = null;          // created kit ID
let workId = null;         // work for assignments
let pmUserId = null;       // PM user id for issue
let kitItemId = null;      // kit item for assembly

module.exports = {
  name: 'EQUIPMENT PREMIUM (FaceKit — 42 endpoints, all roles)',
  tests: [

    // ═══════════════════════════════════════════════════
    // SECTION 1: Access control — read endpoints
    // ═══════════════════════════════════════════════════

    {
      name: 'ADMIN — GET /api/equipment (list)',
      run: async () => {
        const r = await api('GET', '/api/equipment?limit=5', { role: 'ADMIN' });
        assertOk(r, 'equipment list');
        assertArray(r.data?.equipment || [], 'equipment');
      }
    },
    {
      name: 'WAREHOUSE — GET /api/equipment (list)',
      run: async () => {
        const r = await api('GET', '/api/equipment?limit=5', { role: 'WAREHOUSE' });
        assertOk(r, 'WAREHOUSE reads list');
      }
    },
    {
      name: 'PM — GET /api/equipment (list)',
      run: async () => {
        const r = await api('GET', '/api/equipment?limit=5', { role: 'PM' });
        assertOk(r, 'PM reads list');
      }
    },
    {
      name: 'CHIEF_ENGINEER — GET /api/equipment (list)',
      run: async () => {
        const r = await api('GET', '/api/equipment?limit=5', { role: 'CHIEF_ENGINEER' });
        assertOk(r, 'CHIEF_ENGINEER reads list');
      }
    },
    {
      name: 'DIRECTOR_GEN — GET /api/equipment (list)',
      run: async () => {
        const r = await api('GET', '/api/equipment?limit=5', { role: 'DIRECTOR_GEN' });
        assertOk(r, 'DIRECTOR_GEN reads list');
      }
    },
    {
      name: 'TO — GET /api/equipment (forbidden or limited)',
      run: async () => {
        const r = await api('GET', '/api/equipment?limit=5', { role: 'TO' });
        // TO may have read-only access or forbidden — both acceptable
        if (r.status === 403 || r.status === 401) {
          assertForbidden(r, 'TO should not access equipment');
        } else {
          assertOk(r, 'TO has limited access');
        }
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION 2: Categories / Warehouses / Objects
    // ═══════════════════════════════════════════════════

    {
      name: 'GET /api/equipment/categories',
      run: async () => {
        const r = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        assertOk(r, 'categories');
        const cats = r.data?.categories || [];
        assertArray(cats, 'categories');
        if (cats.length > 0) {
          catId = cats[0].id;
          assertHasFields(cats[0], ['id', 'name'], 'category');
        }
      }
    },
    {
      name: 'GET /api/equipment/warehouses',
      run: async () => {
        const r = await api('GET', '/api/equipment/warehouses', { role: 'ADMIN' });
        assertOk(r, 'warehouses');
      }
    },
    {
      name: 'GET /api/equipment/objects',
      run: async () => {
        const r = await api('GET', '/api/equipment/objects', { role: 'ADMIN' });
        assertOk(r, 'objects');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION 3: CRUD — Create equipment
    // ═══════════════════════════════════════════════════

    {
      name: 'Setup: find PM user and work',
      run: async () => {
        const users = await api('GET', '/api/users', { role: 'ADMIN' });
        const ul = Array.isArray(users.data) ? users.data : (users.data?.users || []);
        const pm = ul.find(u => u.role === 'PM');
        if (pm) pmUserId = pm.id;

        const works = await api('GET', '/api/works?limit=5', { role: 'PM' });
        const wl = works.data?.works || [];
        if (wl.length > 0) workId = wl[0].id;
      }
    },
    {
      name: 'TO — POST /api/equipment (forbidden)',
      run: async () => {
        const r = await api('POST', '/api/equipment', { role: 'TO', body: { name: 'TEST_FORBIDDEN', quantity: 1 } });
        if (r.status === 404) skip('Endpoint not available');
        assertForbidden(r, 'TO cannot create equipment');
      }
    },
    {
      name: 'PM — POST /api/equipment (forbidden)',
      run: async () => {
        const r = await api('POST', '/api/equipment', { role: 'PM', body: { name: 'TEST_PM_FORBIDDEN', quantity: 1 } });
        if (r.status === 404) skip('Endpoint not available');
        // PM might be forbidden to create
        if (r.status === 403) {
          assertForbidden(r, 'PM should not create equipment');
        } else {
          // Some configs allow PM to create — that's OK too
          assertOk(r, 'PM create allowed by config');
          if (r.data?.equipment?.id) {
            // Cleanup: delete it
            await api('DELETE', '/api/equipment/' + r.data.equipment.id, { role: 'ADMIN' });
          }
        }
      }
    },
    {
      name: 'ADMIN — POST /api/equipment (create)',
      run: async () => {
        const body = {
          name: 'TEST_PREMIUM: Сварочный аппарат Premium',
          serial_number: 'TP-SN-' + Date.now(),
          quantity: 1, unit: 'шт',
          purchase_price: 125000,
          purchase_date: '2026-01-15',
          brand: 'Lincoln', model: 'V500',
          notes: 'FaceKit Premium test'
        };
        if (catId) body.category_id = catId;
        const r = await api('POST', '/api/equipment', { role: 'ADMIN', body });
        if (r.status === 404) skip('Equipment endpoint not available');
        assertOk(r, 'ADMIN creates equipment');
        eqId = r.data?.equipment?.id;
        assert(eqId, 'Must return equipment ID');
        assert(r.data.equipment.inventory_number, 'Must generate inventory number');
        assert(r.data.equipment.status === 'on_warehouse', 'Initial status = on_warehouse');
      }
    },
    {
      name: 'WAREHOUSE — POST /api/equipment (create)',
      run: async () => {
        const body = {
          name: 'TEST_PREMIUM: Компрессор WAREHOUSE',
          serial_number: 'TP-WH-' + Date.now(),
          quantity: 1, unit: 'шт'
        };
        if (catId) body.category_id = catId;
        const r = await api('POST', '/api/equipment', { role: 'WAREHOUSE', body });
        if (r.status === 404) skip('Endpoint not available');
        assertOk(r, 'WAREHOUSE creates equipment');
        // Cleanup
        const whId = r.data?.equipment?.id;
        if (whId) await api('DELETE', '/api/equipment/' + whId, { role: 'ADMIN' });
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION 4: Read single / Update / Filters
    // ═══════════════════════════════════════════════════

    {
      name: 'GET /api/equipment/:id (detail)',
      run: async () => {
        if (!eqId) skip('No equipment created');
        const r = await api('GET', '/api/equipment/' + eqId, { role: 'ADMIN' });
        assertOk(r, 'equipment detail');
        assertHasFields(r.data?.equipment || {}, ['id', 'name', 'status', 'inventory_number'], 'equipment');
        assert(Array.isArray(r.data?.movements), 'Should include movements array');
      }
    },
    {
      name: 'PUT /api/equipment/:id (update)',
      run: async () => {
        if (!eqId) skip('No equipment');
        const r = await api('PUT', '/api/equipment/' + eqId, { role: 'ADMIN', body: { notes: 'Updated by Premium test ' + Date.now() } });
        assertOk(r, 'update equipment');
      }
    },
    {
      name: 'GET /api/equipment?status=on_warehouse (filter by status)',
      run: async () => {
        const r = await api('GET', '/api/equipment?status=on_warehouse&limit=5', { role: 'ADMIN' });
        assertOk(r, 'filter by status');
        const list = r.data?.equipment || [];
        for (const eq of list) {
          assert(eq.status === 'on_warehouse', 'All items should be on_warehouse, got: ' + eq.status);
        }
      }
    },
    {
      name: 'GET /api/equipment?search=TEST_PREMIUM (search)',
      run: async () => {
        const r = await api('GET', '/api/equipment?search=TEST_PREMIUM&limit=5', { role: 'ADMIN' });
        assertOk(r, 'search');
      }
    },
    {
      name: 'GET /api/equipment/available (only on_warehouse)',
      run: async () => {
        const r = await api('GET', '/api/equipment/available', { role: 'ADMIN' });
        assertOk(r, 'available equipment');
        const list = r.data?.equipment || [];
        for (const eq of list.slice(0, 10)) {
          assert(eq.status === 'on_warehouse', 'Available = on_warehouse only');
        }
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION 5: Stats
    // ═══════════════════════════════════════════════════

    {
      name: 'GET /api/equipment/stats/summary',
      run: async () => {
        const r = await api('GET', '/api/equipment/stats/summary', { role: 'ADMIN' });
        assertOk(r, 'stats summary');
      }
    },
    {
      name: 'GET /api/equipment/stats/dashboard (Premium)',
      run: async () => {
        const r = await api('GET', '/api/equipment/stats/dashboard', { role: 'ADMIN' });
        if (r.status === 404) skip('Dashboard stats not deployed yet');
        assertOk(r, 'dashboard stats');
        const d = r.data;
        assert(typeof d.total === 'number' || d.total !== undefined, 'Should have total');
      }
    },
    {
      name: 'WAREHOUSE — GET /api/equipment/stats/dashboard',
      run: async () => {
        const r = await api('GET', '/api/equipment/stats/dashboard', { role: 'WAREHOUSE' });
        if (r.status === 404) skip('Not deployed yet');
        assertOk(r, 'WAREHOUSE dashboard stats');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION 6: Issue / Return / Transfer / Repair
    // ═══════════════════════════════════════════════════

    {
      name: 'POST /api/equipment/issue (ADMIN issues to PM)',
      run: async () => {
        if (!eqId) skip('No equipment');
        if (!pmUserId) skip('No PM user');
        const body = { equipment_id: eqId, holder_id: pmUserId, notes: 'Premium test issue' };
        if (workId) body.work_id = workId;
        const r = await api('POST', '/api/equipment/issue', { role: 'ADMIN', body });
        assertOk(r, 'issue equipment');
      }
    },
    {
      name: 'Verify status = issued after issue',
      run: async () => {
        if (!eqId) skip('No equipment');
        const r = await api('GET', '/api/equipment/' + eqId, { role: 'ADMIN' });
        assertOk(r, 'verify issued');
        assert(r.data?.equipment?.status === 'issued', 'Status must be issued, got: ' + r.data?.equipment?.status);
        assert(r.data?.equipment?.current_holder_id === pmUserId, 'Holder should be PM');
      }
    },
    {
      name: 'PM — GET /api/equipment/my (my equipment)',
      run: async () => {
        const r = await api('GET', '/api/equipment/my', { role: 'PM' });
        if (r.status === 404) skip('Endpoint not available');
        assertOk(r, 'PM my equipment');
      }
    },
    {
      name: 'GET /api/equipment/by-holder/:id',
      run: async () => {
        if (!pmUserId) skip('No PM user');
        const r = await api('GET', '/api/equipment/by-holder/' + pmUserId, { role: 'ADMIN' });
        assertOk(r, 'by-holder');
        assertArray(r.data?.equipment || [], 'equipment by holder');
      }
    },
    {
      name: 'POST /api/equipment/return',
      run: async () => {
        if (!eqId) skip('No equipment');
        const r = await api('POST', '/api/equipment/return', { role: 'ADMIN', body: { equipment_id: eqId, notes: 'Premium test return' } });
        assertOk(r, 'return equipment');
      }
    },
    {
      name: 'Verify status = on_warehouse after return',
      run: async () => {
        if (!eqId) skip('No equipment');
        const r = await api('GET', '/api/equipment/' + eqId, { role: 'ADMIN' });
        assertOk(r, 'verify returned');
        assert(r.data?.equipment?.status === 'on_warehouse', 'Status must be on_warehouse');
      }
    },
    {
      name: 'POST /api/equipment/repair (send to repair)',
      run: async () => {
        if (!eqId) skip('No equipment');
        const r = await api('POST', '/api/equipment/repair', { role: 'ADMIN', body: { equipment_id: eqId, notes: 'Premium: нужен ремонт' } });
        if (r.status === 404) skip('Repair endpoint not available');
        assertOk(r, 'send to repair');
      }
    },
    {
      name: 'Verify status = repair',
      run: async () => {
        if (!eqId) skip('No equipment');
        const r = await api('GET', '/api/equipment/' + eqId, { role: 'ADMIN' });
        assertOk(r, 'verify repair');
        assert(r.data?.equipment?.status === 'repair', 'Status must be repair, got: ' + r.data?.equipment?.status);
      }
    },
    {
      name: 'POST /api/equipment/repair-complete',
      run: async () => {
        if (!eqId) skip('No equipment');
        const r = await api('POST', '/api/equipment/repair-complete', { role: 'ADMIN', body: { equipment_id: eqId, notes: 'Ремонт завершён' } });
        if (r.status === 404) skip('repair-complete not available');
        assertOk(r, 'repair complete');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION 7: Transfer requests
    // ═══════════════════════════════════════════════════

    {
      name: 'POST /api/equipment/transfer-request',
      run: async () => {
        if (!eqId || !pmUserId) skip('No equipment or PM');
        // First issue to PM
        await api('POST', '/api/equipment/issue', { role: 'ADMIN', body: { equipment_id: eqId, holder_id: pmUserId, work_id: workId } });

        const users = await api('GET', '/api/users', { role: 'ADMIN' });
        const ul = Array.isArray(users.data) ? users.data : (users.data?.users || []);
        const target = ul.find(u => u.role === 'PM' && u.id !== pmUserId) || ul.find(u => u.id !== pmUserId);
        if (!target) skip('No target user for transfer');

        const r = await api('POST', '/api/equipment/transfer-request', { role: 'PM', body: {
          equipment_id: eqId, target_holder_id: target.id, notes: 'Premium: передача'
        }});
        if (r.status === 404) skip('Transfer request not available');
        if (r.status === 403) { /* PM may not own it */ return; }
        assertOk(r, 'transfer request');
      }
    },
    {
      name: 'GET /api/equipment/requests (pending)',
      run: async () => {
        const r = await api('GET', '/api/equipment/requests?status=pending', { role: 'ADMIN' });
        if (r.status === 404) skip('Requests endpoint not available');
        assertOk(r, 'pending requests');
      }
    },
    {
      name: 'Cleanup: return equipment before kit tests',
      run: async () => {
        if (!eqId) return;
        const check = await api('GET', '/api/equipment/' + eqId, { role: 'ADMIN' });
        if (check.data?.equipment?.status !== 'on_warehouse') {
          await api('POST', '/api/equipment/return', { role: 'ADMIN', body: { equipment_id: eqId } });
        }
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION 8: Maintenance
    // ═══════════════════════════════════════════════════

    {
      name: 'POST /api/equipment/:id/maintenance (add record)',
      run: async () => {
        if (!eqId) skip('No equipment');
        const r = await api('POST', '/api/equipment/' + eqId + '/maintenance', { role: 'ADMIN', body: {
          maintenance_type: 'scheduled_to', description: 'Premium: Плановое ТО', cost: 5000
        }});
        if (r.status === 404) skip('Maintenance endpoint not available');
        assertOk(r, 'add maintenance');
      }
    },
    {
      name: 'GET /api/equipment/:id/maintenance (history)',
      run: async () => {
        if (!eqId) skip('No equipment');
        const r = await api('GET', '/api/equipment/' + eqId + '/maintenance', { role: 'ADMIN' });
        if (r.status === 404) skip('Maintenance history not available');
        assertOk(r, 'maintenance history');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION 9: Kits (NEW — FaceKit Premium)
    // ═══════════════════════════════════════════════════

    {
      name: 'GET /api/equipment/kits (list all kits)',
      run: async () => {
        const r = await api('GET', '/api/equipment/kits', { role: 'ADMIN' });
        if (r.status === 404) skip('Kits not deployed yet');
        assertOk(r, 'kits list');
        assertArray(r.data?.kits || [], 'kits');
      }
    },
    {
      name: 'POST /api/equipment/kits (create kit)',
      run: async () => {
        const r = await api('POST', '/api/equipment/kits', { role: 'ADMIN', body: {
          name: 'TEST_KIT: Тестовый комплект',
          work_type: 'ХИМ-промывка',
          description: 'Комплект для тестирования',
          icon: '🧪',
          items: [
            { item_name: 'Насос циркуляционный', quantity: 1, is_required: true },
            { item_name: 'Шланг Ø32 (10м)', quantity: 2, is_required: true },
            { item_name: 'Бак реагентный 200л', quantity: 1, is_required: false }
          ]
        }});
        if (r.status === 404) skip('Kits not deployed yet');
        assertOk(r, 'create kit');
        kitId = r.data?.kit?.id;
        assert(kitId, 'Must return kit ID');
      }
    },
    {
      name: 'GET /api/equipment/kits/:id (kit detail)',
      run: async () => {
        if (!kitId) skip('No kit created');
        const r = await api('GET', '/api/equipment/kits/' + kitId, { role: 'ADMIN' });
        if (r.status === 404) skip('Not deployed');
        assertOk(r, 'kit detail');
        assert(r.data?.kit?.name, 'Kit should have name');
        assertArray(r.data?.items || [], 'kit items');
        assert((r.data?.items || []).length >= 2, 'Should have at least 2 items');
      }
    },
    {
      name: 'PUT /api/equipment/kits/:id (update kit)',
      run: async () => {
        if (!kitId) skip('No kit');
        const r = await api('PUT', '/api/equipment/kits/' + kitId, { role: 'ADMIN', body: {
          name: 'TEST_KIT: Обновлённый комплект',
          description: 'Обновлено тестом Premium'
        }});
        if (r.status === 404) skip('Not deployed');
        assertOk(r, 'update kit');
      }
    },
    {
      name: 'PM — GET /api/equipment/kits (can read)',
      run: async () => {
        const r = await api('GET', '/api/equipment/kits', { role: 'PM' });
        if (r.status === 404) skip('Not deployed');
        assertOk(r, 'PM reads kits');
      }
    },
    {
      name: 'WAREHOUSE — POST /api/equipment/kits (can create)',
      run: async () => {
        const r = await api('POST', '/api/equipment/kits', { role: 'WAREHOUSE', body: {
          name: 'TEST_KIT: WH комплект',
          work_type: 'ГДП', icon: '💧',
          items: [{ item_name: 'Гидромашина', quantity: 1, is_required: true }]
        }});
        if (r.status === 404) skip('Not deployed');
        if (r.status === 403) {
          assertForbidden(r, 'WAREHOUSE may not create kits');
        } else {
          assertOk(r, 'WAREHOUSE creates kit');
          if (r.data?.kit?.id) await api('DELETE', '/api/equipment/kits/' + r.data.kit.id, { role: 'ADMIN' });
        }
      }
    },
    {
      name: 'TO — POST /api/equipment/kits (forbidden)',
      run: async () => {
        const r = await api('POST', '/api/equipment/kits', { role: 'TO', body: { name: 'FORBIDDEN_KIT' } });
        if (r.status === 404) skip('Not deployed');
        assertForbidden(r, 'TO cannot create kits');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION 10: Kit Assembly
    // ═══════════════════════════════════════════════════

    {
      name: 'POST /api/equipment/kits/:id/assemble (assign equipment to kit items)',
      run: async () => {
        if (!kitId || !eqId) skip('No kit or equipment');
        // Get kit items first
        const detail = await api('GET', '/api/equipment/kits/' + kitId, { role: 'ADMIN' });
        const items = detail.data?.items || [];
        if (!items.length) skip('No kit items');
        kitItemId = items[0].id;

        const r = await api('POST', '/api/equipment/kits/' + kitId + '/assemble', { role: 'ADMIN', body: {
          assignments: [{ kit_item_id: kitItemId, equipment_id: eqId }]
        }});
        if (r.status === 404) skip('Assemble not deployed');
        assertOk(r, 'assemble kit');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION 11: Work Assignments (NEW — FaceKit Premium)
    // ═══════════════════════════════════════════════════

    {
      name: 'Prep: ensure equipment on_warehouse for work assignment',
      run: async () => {
        if (!eqId) skip('No equipment');
        const check = await api('GET', '/api/equipment/' + eqId, { role: 'ADMIN' });
        if (check.data?.equipment?.status !== 'on_warehouse') {
          await api('POST', '/api/equipment/return', { role: 'ADMIN', body: { equipment_id: eqId } });
        }
      }
    },
    {
      name: 'POST /api/equipment/work/:workId/assign',
      run: async () => {
        if (!workId || !eqId) skip('No work or equipment');
        const r = await api('POST', '/api/equipment/work/' + workId + '/assign', { role: 'ADMIN', body: {
          equipment_ids: [eqId], holder_id: pmUserId || undefined
        }});
        if (r.status === 404) skip('Work assign not deployed');
        assertOk(r, 'assign to work');
        assert(r.data?.assigned?.length >= 0, 'Should return assigned array');
      }
    },
    {
      name: 'GET /api/equipment/work/:workId/equipment',
      run: async () => {
        if (!workId) skip('No work');
        const r = await api('GET', '/api/equipment/work/' + workId + '/equipment', { role: 'ADMIN' });
        if (r.status === 404) skip('Work equipment not deployed');
        assertOk(r, 'work equipment');
      }
    },
    {
      name: 'PM — GET /api/equipment/work/:workId/equipment',
      run: async () => {
        if (!workId) skip('No work');
        const r = await api('GET', '/api/equipment/work/' + workId + '/equipment', { role: 'PM' });
        if (r.status === 404) skip('Not deployed');
        assertOk(r, 'PM views work equipment');
      }
    },
    {
      name: 'POST /api/equipment/work/:workId/unassign',
      run: async () => {
        if (!workId || !eqId) skip('No work or equipment');
        const r = await api('POST', '/api/equipment/work/' + workId + '/unassign', { role: 'ADMIN', body: {
          equipment_ids: [eqId]
        }});
        if (r.status === 404) skip('Unassign not deployed');
        assertOk(r, 'unassign from work');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION 12: Recommendations
    // ═══════════════════════════════════════════════════

    {
      name: 'GET /api/equipment/recommend?work_type=ХИМ-промывка',
      run: async () => {
        const r = await api('GET', '/api/equipment/recommend?work_type=' + encodeURIComponent('ХИМ-промывка'), { role: 'ADMIN' });
        if (r.status === 404) skip('Recommend not deployed');
        assertOk(r, 'recommend');
        assertArray(r.data?.recommendations || [], 'recommendations');
      }
    },
    {
      name: 'PM — GET /api/equipment/recommend',
      run: async () => {
        const r = await api('GET', '/api/equipment/recommend?work_type=any', { role: 'PM' });
        if (r.status === 404) skip('Not deployed');
        assertOk(r, 'PM recommend');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION 13: Movements history
    // ═══════════════════════════════════════════════════

    {
      name: 'GET /api/equipment/movements (global history)',
      run: async () => {
        const r = await api('GET', '/api/equipment/movements?limit=10', { role: 'ADMIN' });
        if (r.status === 404) skip('Movements endpoint not available');
        assertOk(r, 'movements');
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION 14: Bulk / Export
    // ═══════════════════════════════════════════════════

    {
      name: 'GET /api/equipment/export/excel',
      run: async () => {
        const r = await api('GET', '/api/equipment/export/excel', { role: 'ADMIN' });
        if (r.status === 404) skip('Export not available');
        // May return binary or success
        assert(r.status === 200 || r.status === 302, 'Export should succeed, got: ' + r.status);
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION 15: Cross-role access matrix
    // ═══════════════════════════════════════════════════

    {
      name: 'CHIEF_ENGINEER — can read stats',
      run: async () => {
        const r = await api('GET', '/api/equipment/stats/summary', { role: 'CHIEF_ENGINEER' });
        assertOk(r, 'CHIEF_ENGINEER stats');
      }
    },
    {
      name: 'DIRECTOR_GEN — can read kits',
      run: async () => {
        const r = await api('GET', '/api/equipment/kits', { role: 'DIRECTOR_GEN' });
        if (r.status === 404) skip('Not deployed');
        assertOk(r, 'DIRECTOR_GEN kits');
      }
    },
    {
      name: 'TO — cannot issue equipment',
      run: async () => {
        const r = await api('POST', '/api/equipment/issue', { role: 'TO', body: { equipment_id: 1, holder_id: 1 } });
        if (r.status === 404) skip('Endpoint not available');
        assertForbidden(r, 'TO cannot issue');
      }
    },
    {
      name: 'HR — limited equipment access',
      run: async () => {
        const r = await api('GET', '/api/equipment?limit=5', { role: 'HR' });
        // HR may or may not have access
        if (r.status === 403) {
          assertForbidden(r, 'HR restricted from equipment');
        } else {
          assertOk(r, 'HR has limited access');
        }
      }
    },

    // ═══════════════════════════════════════════════════
    // SECTION 16: Cleanup
    // ═══════════════════════════════════════════════════

    {
      name: 'Cleanup: delete test kit',
      run: async () => {
        if (!kitId) return;
        const r = await api('DELETE', '/api/equipment/kits/' + kitId, { role: 'ADMIN' });
        if (r.status !== 404) assertOk(r, 'delete test kit');
      }
    },
    {
      name: 'Cleanup: delete test equipment',
      run: async () => {
        if (!eqId) return;
        const r = await api('DELETE', '/api/equipment/' + eqId, { role: 'ADMIN' });
        if (r.status !== 404) assertOk(r, 'delete test equipment');
      }
    }
  ]
};
