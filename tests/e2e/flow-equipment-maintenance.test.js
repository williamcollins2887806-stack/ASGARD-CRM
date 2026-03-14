/**
 * E2E FLOW: Equipment Maintenance Lifecycle
 * WAREHOUSE creates equipment -> issues to holder -> repair -> return -> write-off
 */
const { api, assert, assertOk, assertForbidden, skip } = require('../config');
let equipmentId = null;
let workId = null;
let createdWork = false;
module.exports = {
  name: 'FLOW: Equipment Maintenance Lifecycle (Warehouse -> Issue -> Repair -> Return -> WriteOff)',
  tests: [
  {
    name: 'TO cannot create equipment (forbidden)',
    run: async () => {
      const resp = await api('POST', '/api/equipment', { role: 'TO', body: { name: 'E2E: TO attempt', quantity: 1 } });
      if (resp.status === 404) skip('Equipment endpoint not available');
      assertForbidden(resp, 'TO should not create equipment');
    }
  },
  {
    name: 'Find or create a work for equipment issue',
    run: async () => {
      const works = await api('GET', '/api/works?limit=1', { role: 'PM' });
      const wl = works.data?.works || [];
      if (wl.length > 0) { workId = wl[0].id; }
      else {
        const r = await api('POST', '/api/works', { role: 'PM', body: { work_title: 'E2E: Equipment Test Work', customer_name: 'E2E Test' } });
        if (r.data?.work?.id) { workId = r.data.work.id; createdWork = true; }
      }
      if (!workId) skip('No work available');
    }
  },
  {
    name: 'WAREHOUSE creates equipment (on_warehouse)',
    run: async () => {
      const resp = await api('POST', '/api/equipment', {
        role: 'WAREHOUSE',
        body: { name: 'E2E: Welding Machine Lincoln 500', serial_number: 'E2E-SN-' + Date.now(), purchase_price: 350000, purchase_date: '2026-01-10', quantity: 1, unit: 'pcs', brand: 'Lincoln Electric', model: 'Invertec V500-I', notes: 'E2E test equipment' }
      });
      if (resp.status === 404) skip('Equipment endpoint not available');
      assertOk(resp, 'WAREHOUSE creates equipment');
      equipmentId = resp.data?.equipment?.id;
      assert(equipmentId, 'Equipment ID must be returned');
      assert(resp.data.equipment.status === 'on_warehouse', 'Must be on_warehouse');
    }
  },
  {
    name: 'WAREHOUSE views equipment details',
    run: async () => {
      if (!equipmentId) skip('No equipment');
      const resp = await api('GET', '/api/equipment/' + equipmentId, { role: 'WAREHOUSE' });
      assertOk(resp, 'WAREHOUSE views equipment');
      assert(resp.data?.equipment?.status === 'on_warehouse', 'Status must be on_warehouse');
    }
  },
  {
    name: 'CHIEF_ENGINEER can list equipment',
    run: async () => {
      const resp = await api('GET', '/api/equipment?limit=10', { role: 'CHIEF_ENGINEER' });
      assertOk(resp, 'CHIEF_ENGINEER lists equipment');
      assert(Array.isArray(resp.data?.equipment), 'Must return equipment array');
    }
  },
  {
    name: 'WAREHOUSE issues equipment to holder',
    run: async () => {
      if (!equipmentId || !workId) skip('No equipment or work');
      const users = await api('GET', '/api/users', { role: 'ADMIN' });
      const ul = Array.isArray(users.data) ? users.data : (users.data?.users || []);
      const pm = ul.find(u => u.role === 'PM') || ul[0];
      if (!pm) skip('No PM user found');
      const resp = await api('POST', '/api/equipment/issue', {
        role: 'WAREHOUSE',
        body: { equipment_id: equipmentId, holder_id: pm.id, work_id: workId, notes: 'E2E: Issue to PM' }
      });
      assertOk(resp, 'WAREHOUSE issues equipment');
    }
  },
  {
    name: 'Verify equipment is now issued',
    run: async () => {
      if (!equipmentId) skip('No equipment');
      const resp = await api('GET', '/api/equipment/' + equipmentId, { role: 'WAREHOUSE' });
      assertOk(resp, 'Check issued status');
      assert(resp.data?.equipment?.status === 'issued', 'Must be issued');
      assert(resp.data?.equipment?.current_holder_id, 'holder must be set');
    }
  },
  {
    name: 'WAREHOUSE returns equipment then sends to repair',
    run: async () => {
      if (!equipmentId) skip('No equipment');
      const r1 = await api('POST', '/api/equipment/return', {
        role: 'WAREHOUSE', body: { equipment_id: equipmentId, condition_after: 'needs_repair', notes: 'E2E: Return for repair' }
      });
      assertOk(r1, 'Return to warehouse');
      const r2 = await api('POST', '/api/equipment/repair', {
        role: 'WAREHOUSE', body: { equipment_id: equipmentId, notes: 'E2E: Motor malfunction' }
      });
      assertOk(r2, 'Send to repair');
    }
  },
  {
    name: 'Verify equipment is in repair status',
    run: async () => {
      if (!equipmentId) skip('No equipment');
      const resp = await api('GET', '/api/equipment/' + equipmentId, { role: 'WAREHOUSE' });
      assertOk(resp, 'Check repair status');
      assert(resp.data?.equipment?.status === 'repair', 'Must be in repair');
    }
  },
  {
    name: 'WAREHOUSE creates maintenance record',
    run: async () => {
      if (!equipmentId) skip('No equipment');
      const resp = await api('POST', '/api/equipment/' + equipmentId + '/maintenance', {
        role: 'WAREHOUSE',
        body: { maintenance_type: 'repair', description: 'E2E: Motor replacement', cost: 45000, started_at: '2026-02-10', completed_at: '2026-02-15' }
      });
      assertOk(resp, 'Create maintenance record');
      assert(resp.data?.maintenance?.id, 'Maintenance ID must be returned');
    }
  },
  {
    name: 'WAREHOUSE completes repair',
    run: async () => {
      if (!equipmentId) skip('No equipment');
      const resp = await api('POST', '/api/equipment/repair-complete', {
        role: 'WAREHOUSE', body: { equipment_id: equipmentId, condition_after: 'good', notes: 'E2E: Repair done' }
      });
      assertOk(resp, 'Complete repair');
    }
  },
  {
    name: 'Verify equipment is back on warehouse',
    run: async () => {
      if (!equipmentId) skip('No equipment');
      const resp = await api('GET', '/api/equipment/' + equipmentId, { role: 'WAREHOUSE' });
      assertOk(resp, 'Check post-repair status');
      assert(resp.data?.equipment?.status === 'on_warehouse', 'Must be on_warehouse');
    }
  },
  {
    name: 'Verify movement history exists',
    run: async () => {
      if (!equipmentId) skip('No equipment');
      const resp = await api('GET', '/api/equipment/' + equipmentId, { role: 'WAREHOUSE' });
      assertOk(resp, 'Check movements');
      assert((resp.data?.movements || []).length >= 2, 'Must have movement records');
    }
  },
  {
    name: 'PM cannot write off equipment (forbidden)',
    run: async () => {
      if (!equipmentId) skip('No equipment');
      const resp = await api('POST', '/api/equipment/write-off', { role: 'PM', body: { equipment_id: equipmentId, reason: 'E2E: PM attempt' } });
      assertForbidden(resp, 'PM should not write off');
    }
  },
  {
    name: 'DIRECTOR_GEN writes off equipment',
    run: async () => {
      if (!equipmentId) skip('No equipment');
      const resp = await api('POST', '/api/equipment/write-off', {
        role: 'DIRECTOR_GEN', body: { equipment_id: equipmentId, reason: 'E2E: End of useful life, not economically viable to repair further' }
      });
      assertOk(resp, 'DIRECTOR_GEN writes off');
    }
  },
  {
    name: 'Verify equipment is written off',
    run: async () => {
      if (!equipmentId) skip('No equipment');
      const resp = await api('GET', '/api/equipment/' + equipmentId, { role: 'ADMIN' });
      assertOk(resp, 'Verify written_off');
      assert(resp.data?.equipment?.status === 'written_off', 'Must be written_off');
    }
  },
  {
    name: 'Cleanup: delete test work if created',
    run: async () => {
      if (!createdWork || !workId) return;
      await api('DELETE', '/api/works/' + workId, { role: 'ADMIN' });
    }
  }
  ]
};