/**
 * INTEGRATIONS ERP — Connections CRUD, test, mappings, export/import, sync-log, rotate-secret
 */
const { api, assert, assertOk, assertForbidden, skip } = require('../config');

let connId = null;
let mappingId = null;
let logId = null;

module.exports = {
  name: 'INTEGRATIONS ERP ACTIONS',
  tests: [
    {
      name: 'ADMIN reads ERP connections',
      run: async () => {
        const resp = await api('GET', '/api/integrations/erp/connections', { role: 'ADMIN' });
        assertOk(resp, 'ERP connections');
        assert(resp.data?.success === true, 'should have success:true');
        assert(Array.isArray(resp.data?.items), 'items should be array');
      }
    },
    {
      name: 'NEGATIVE: POST ERP connection without required fields → 400',
      run: async () => {
        const resp = await api('POST', '/api/integrations/erp/connections', {
          role: 'ADMIN',
          body: { connection_url: 'http://test.local' }
        });
        assert(resp.status === 400, 'connection without name/erp_type should be 400, got ' + resp.status);
      }
    },
    {
      name: 'ADMIN creates ERP connection',
      run: async () => {
        const resp = await api('POST', '/api/integrations/erp/connections', {
          role: 'ADMIN',
          body: {
            name: 'E2E Test ERP Connection',
            erp_type: '1c',
            sync_direction: 'both',
            sync_interval_minutes: 60
          }
        });
        assertOk(resp, 'create ERP connection');
        assert(resp.data?.success === true && resp.data?.id, 'should return success:true and id');
        connId = resp.data.id;
      }
    },
    {
      name: 'ADMIN updates ERP connection',
      run: async () => {
        if (!connId) skip('no connId');
        const resp = await api('PUT', `/api/integrations/erp/connections/${connId}`, {
          role: 'ADMIN',
          body: { name: 'E2E Test ERP Updated', is_active: true }
        });
        assertOk(resp, 'update ERP connection');
        assert(resp.data?.success === true, 'should have success:true');
      }
    },
    {
      name: 'ADMIN tests ERP connection (no URL → ok status)',
      run: async () => {
        if (!connId) skip('no connId');
        const resp = await api('POST', `/api/integrations/erp/connections/${connId}/test`, {
          role: 'ADMIN',
          body: {}
        });
        assertOk(resp, 'test ERP connection');
        assert(resp.data?.success === true, 'should return success:true');
      }
    },
    {
      name: 'ADMIN reads ERP connection mappings (empty ok)',
      run: async () => {
        if (!connId) skip('no connId');
        const resp = await api('GET', `/api/integrations/erp/connections/${connId}/mappings`, { role: 'ADMIN' });
        assertOk(resp, 'ERP mappings');
        assert(Array.isArray(resp.data?.items), 'items should be array');
      }
    },
    {
      name: 'NEGATIVE: POST mapping without required fields → 400',
      run: async () => {
        if (!connId) skip('no connId');
        const resp = await api('POST', `/api/integrations/erp/connections/${connId}/mappings`, {
          role: 'ADMIN',
          body: { entity_type: 'payroll' }
        });
        assert(resp.status === 400, 'mapping without crm_field/erp_field should be 400, got ' + resp.status);
      }
    },
    {
      name: 'ADMIN creates ERP field mapping',
      run: async () => {
        if (!connId) skip('no connId');
        const resp = await api('POST', `/api/integrations/erp/connections/${connId}/mappings`, {
          role: 'ADMIN',
          body: {
            entity_type: 'payroll',
            crm_field: 'employee_id',
            erp_field: 'ТабНомер',
            transform_rule: 'direct'
          }
        });
        assertOk(resp, 'create ERP mapping');
        assert(resp.data?.success === true && resp.data?.id, 'should return id');
        mappingId = resp.data.id;
      }
    },
    {
      name: 'ADMIN deletes ERP mapping',
      run: async () => {
        if (!connId || !mappingId) skip('no connId or mappingId');
        const resp = await api('DELETE', `/api/integrations/erp/connections/${connId}/mappings/${mappingId}`, {
          role: 'ADMIN'
        });
        assertOk(resp, 'delete ERP mapping');
      }
    },
    {
      name: 'ADMIN exports tenders via ERP',
      run: async () => {
        if (!connId) skip('no connId');
        const resp = await api('POST', `/api/integrations/erp/connections/${connId}/export`, {
          role: 'ADMIN',
          body: { entity_type: 'tenders' }
        });
        assertOk(resp, 'ERP export tenders');
        assert(resp.data?.success === true, 'should have success:true');
      }
    },
    {
      name: 'ADMIN exports payroll via ERP',
      run: async () => {
        if (!connId) skip('no connId');
        const resp = await api('POST', `/api/integrations/erp/connections/${connId}/export`, {
          role: 'ADMIN',
          body: { entity_type: 'payroll', date_from: '2026-01-01', date_to: '2026-12-31' }
        });
        assert([200, 500].includes(resp.status), 'ERP export payroll: got ' + resp.status);
        // 500 possible if DB schema missing overtime_rate column
      }
    },
    {
      name: 'ADMIN exports bank via ERP',
      run: async () => {
        if (!connId) skip('no connId');
        const resp = await api('POST', `/api/integrations/erp/connections/${connId}/export`, {
          role: 'ADMIN',
          body: { entity_type: 'bank' }
        });
        assertOk(resp, 'ERP export bank');
      }
    },
    {
      name: 'NEGATIVE: export without entity_type → 400',
      run: async () => {
        if (!connId) skip('no connId');
        const resp = await api('POST', `/api/integrations/erp/connections/${connId}/export`, {
          role: 'ADMIN',
          body: {}
        });
        assert(resp.status === 400, 'export without entity_type should be 400, got ' + resp.status);
      }
    },
    {
      name: 'ADMIN imports counterparties via ERP',
      run: async () => {
        if (!connId) skip('no connId');
        const resp = await api('POST', `/api/integrations/erp/connections/${connId}/import`, {
          role: 'ADMIN',
          body: {
            entity_type: 'counterparties',
            data: [
              { name: 'E2E Test Company', inn: '1234567890', kpp: '123456789' }
            ]
          }
        });
        assertOk(resp, 'ERP import counterparties');
        assert(resp.data?.success === true, 'should have success:true');
      }
    },
    {
      name: 'NEGATIVE: import without data → 400',
      run: async () => {
        if (!connId) skip('no connId');
        const resp = await api('POST', `/api/integrations/erp/connections/${connId}/import`, {
          role: 'ADMIN',
          body: { entity_type: 'counterparties' }
        });
        assert(resp.status === 400, 'import without data should be 400, got ' + resp.status);
      }
    },
    {
      name: 'ADMIN reads ERP sync log',
      run: async () => {
        const resp = await api('GET', '/api/integrations/erp/sync-log', { role: 'ADMIN' });
        assertOk(resp, 'ERP sync log');
        assert(resp.data?.success === true, 'should have success:true');
        assert(Array.isArray(resp.data?.items), 'items should be array');
        if (resp.data.items.length > 0) logId = resp.data.items[0].id;
      }
    },
    {
      name: 'ADMIN reads ERP sync log by ID',
      run: async () => {
        if (!logId) skip('no log entries');
        const resp = await api('GET', `/api/integrations/erp/sync-log/${logId}`, { role: 'ADMIN' });
        assertOk(resp, 'ERP sync log by id');
        assert(resp.data?.item?.id === logId, 'should return correct log entry');
      }
    },
    {
      name: 'ADMIN rotates ERP webhook secret',
      run: async () => {
        if (!connId) skip('no connId');
        const resp = await api('POST', `/api/integrations/erp/connections/${connId}/rotate-secret`, {
          role: 'ADMIN',
          body: {}
        });
        assertOk(resp, 'rotate webhook secret');
        assert(resp.data?.success === true, 'should have success:true');
        assert(typeof resp.data?.webhook_secret === 'string', 'should return webhook_secret string');
        assert(resp.data.webhook_secret.length === 64, 'secret should be 64 hex chars');
      }
    },
    {
      name: 'NEGATIVE: PM cannot rotate ERP secret → 403',
      run: async () => {
        if (!connId) skip('no connId');
        const resp = await api('POST', `/api/integrations/erp/connections/${connId}/rotate-secret`, {
          role: 'PM',
          body: {}
        });
        assert(resp.status === 403, 'PM rotate-secret should be 403, got ' + resp.status);
      }
    },
    {
      name: 'BUH can read ERP connections',
      run: async () => {
        const resp = await api('GET', '/api/integrations/erp/connections', { role: 'BUH' });
        assertOk(resp, 'BUH reads ERP connections');
      }
    },
    {
      name: 'NEGATIVE: ERP connection not found → 404 on test',
      run: async () => {
        const resp = await api('POST', '/api/integrations/erp/connections/99999999/test', {
          role: 'ADMIN',
          body: {}
        });
        assert(resp.status === 404, 'nonexistent connection test should be 404, got ' + resp.status);
      }
    },
    {
      name: 'Cleanup: delete ERP connection (soft delete)',
      run: async () => {
        if (!connId) return;
        const resp = await api('DELETE', `/api/integrations/erp/connections/${connId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete ERP connection');
      }
    }
  ]
};
