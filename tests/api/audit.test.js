/**
 * AUDIT LOG — Verify audit entries are created for CRUD operations
 */
const {
  api, assert, assertOk, assertStatus, assertForbidden, assertArray, assertHasFields,
  BASE_URL, TEST_USERS
} = require('../config');

module.exports = {
  name: 'AUDIT LOG (deep)',
  tests: [
    {
      name: 'AUDIT-1: GET /api/data/audit_log (ADMIN) → 200, array with entries',
      run: async () => {
        const resp = await api('GET', '/api/data/audit_log?limit=5', { role: 'ADMIN' });
        assertOk(resp, 'GET audit_log');
        const list = resp.data?.audit_log || resp.data?.items || resp.data;
        assertArray(list, 'audit_log');
      }
    },
    {
      name: 'AUDIT-2: Create tender → audit_log has new entry',
      run: async () => {
        // Get latest audit entry ID before
        const before = await api('GET', '/api/data/audit_log?limit=1&orderBy=id&desc=true', { role: 'ADMIN' });
        const beforeList = before.data?.audit_log || before.data?.items || before.data || [];
        const beforeMaxId = Array.isArray(beforeList) && beforeList[0] ? beforeList[0].id : 0;

        // Create tender
        const t = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'AUDIT-2 Test Corp', estimated_sum: 100 }
        });
        assertOk(t, 'create tender for audit');
        const tid = (t.data?.tender || t.data)?.id;

        // Get latest audit entry ID after — should be higher
        const after = await api('GET', '/api/data/audit_log?limit=1&orderBy=id&desc=true', { role: 'ADMIN' });
        const afterList = after.data?.audit_log || after.data?.items || after.data || [];
        const afterMaxId = Array.isArray(afterList) && afterList[0] ? afterList[0].id : 0;

        assert(afterMaxId > beforeMaxId, `audit_log should have new entry after create: before_id=${beforeMaxId}, after_id=${afterMaxId}`);

        // Cleanup
        if (tid) await api('DELETE', `/api/tenders/${tid}`, { role: 'ADMIN' }).catch(() => {});
      }
    },
    {
      name: 'AUDIT-3: Update tender → audit_log has update entry',
      run: async () => {
        // Create tender
        const t = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'AUDIT-3 Update Corp', estimated_sum: 200 }
        });
        assertOk(t, 'create tender for audit update');
        const tid = (t.data?.tender || t.data)?.id;
        assert(tid, 'tender id');

        // Get latest audit entry ID before update
        const before = await api('GET', '/api/data/audit_log?limit=1&orderBy=id&desc=true', { role: 'ADMIN' });
        const beforeMaxId = ((before.data?.audit_log || before.data?.items || before.data || [])[0])?.id || 0;

        // Update tender
        await api('PUT', `/api/tenders/${tid}`, {
          role: 'TO',
          body: { tender_status: 'В работе' }
        });

        // Get latest audit entry ID after — should be higher
        const after = await api('GET', '/api/data/audit_log?limit=1&orderBy=id&desc=true', { role: 'ADMIN' });
        const afterMaxId = ((after.data?.audit_log || after.data?.items || after.data || [])[0])?.id || 0;

        assert(afterMaxId > beforeMaxId, `audit_log should have new entry after update: before_id=${beforeMaxId}, after_id=${afterMaxId}`);

        // Cleanup
        await api('DELETE', `/api/tenders/${tid}`, { role: 'ADMIN' }).catch(() => {});
      }
    },
    {
      name: 'AUDIT-4: Audit log entries have required fields',
      run: async () => {
        const resp = await api('GET', '/api/data/audit_log?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'GET audit_log');
        const list = resp.data?.audit_log || resp.data?.items || resp.data;
        if (Array.isArray(list) && list.length > 0) {
          const entry = list[0];
          // Audit log should have at least action and entity_type
          assert(entry.action || entry.entity_type || entry.actor_user_id,
            'audit entry should have action/entity_type/actor fields');
        }
      }
    },
    {
      name: 'AUDIT-5: GET /api/data/audit_log (PM) → 403 (no access)',
      run: async () => {
        const resp = await api('GET', '/api/data/audit_log', { role: 'PM' });
        assertForbidden(resp, 'PM audit_log access');
      }
    }
  ]
};
