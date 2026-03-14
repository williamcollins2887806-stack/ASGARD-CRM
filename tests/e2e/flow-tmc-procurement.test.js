/**
 * E2E FLOW: TMC Procurement Request Lifecycle
 * PM creates TMC request -> submits -> DIRECTOR_GEN approves -> status changes -> delivery
 * Statuses: draft -> submitted -> approved -> ordered -> delivered -> closed
 */
const { api, assert, assertOk, assertStatus, assertForbidden, skip } = require('../config');

let requestId = null;

module.exports = {
  name: 'FLOW: TMC Procurement Lifecycle (PM -> Director -> Delivery)',
  tests: [
    {
      name: 'HR cannot create TMC request (forbidden)',
      run: async () => {
        const resp = await api('POST', '/api/tmc-requests', { role: 'HR', body: { title: 'E2E: HR attempt TMC', total_sum: 5000 } });
        if (resp.status === 404) skip('TMC requests endpoint not available');
        assertForbidden(resp, 'HR should not create TMC requests');
      }
    },
    {
      name: 'PM creates TMC request (draft)',
      run: async () => {
        const resp = await api('POST', '/api/tmc-requests', {
          role: 'PM',
          body: {
            title: 'E2E: TMC Procurement Test',
            items_json: [
              { name: 'Steel pipe 108mm', article: 'SP-108', quantity: 50, unit: 'm', price: 2500, total: 125000 },
              { name: 'Welding electrodes', article: 'WE-3.0', quantity: 100, unit: 'kg', price: 500, total: 50000 }
            ],
            total_sum: 175000,
            priority: 'high',
            needed_by: '2026-03-15',
            delivery_address: 'Site Noyabrsk, Base camp',
            supplier: 'MetalTrade LLC',
            notes: 'Urgent delivery needed for pipeline project'
          }
        });
        if (resp.status === 404) skip('TMC requests endpoint not available');
        assertOk(resp, 'PM creates TMC request');
        requestId = resp.data?.item?.id;
        assert(requestId, 'Request ID must be returned');
        assert(resp.data.item.status === 'draft', 'New request must be in draft status');
      }
    },
    {
      name: 'PM views created TMC request',
      run: async () => {
        if (!requestId) skip('No TMC request created');
        const resp = await api('GET', '/api/tmc-requests/' + requestId, { role: 'PM' });
        assertOk(resp, 'PM views TMC request');
        assert(resp.data?.item?.id === requestId, 'Request ID must match');
        assert(resp.data.item.priority === 'high', 'Priority must be high');
      }
    },
    {
      name: 'PM updates TMC request details',
      run: async () => {
        if (!requestId) skip('No TMC request created');
        const resp = await api('PUT', '/api/tmc-requests/' + requestId, { role: 'PM', body: { total_sum: 180000, notes: 'Updated: Urgent delivery phase 2' } });
        assertOk(resp, 'PM updates TMC request');
      }
    },
    {
      name: 'PM submits TMC request (draft -> submitted)',
      run: async () => {
        if (!requestId) skip('No TMC request created');
        const resp = await api('PUT', '/api/tmc-requests/' + requestId + '/status', { role: 'PM', body: { status: 'submitted' } });
        assertOk(resp, 'PM submits TMC request');
        assert(resp.data?.item?.status === 'submitted', 'Status must be submitted');
      }
    },
    {
      name: 'PM lists TMC requests and finds the created one',
      run: async () => {
        if (!requestId) skip('No TMC request created');
        const resp = await api('GET', '/api/tmc-requests?limit=20', { role: 'PM' });
        assertOk(resp, 'PM lists TMC requests');
        const items = resp.data?.items || [];
        const found = items.find(r => r.id === requestId);
        assert(found, 'Created request must appear in list');
      }
    },
    {
      name: 'DIRECTOR_GEN approves TMC request (submitted -> approved)',
      run: async () => {
        if (!requestId) skip('No TMC request created');
        const resp = await api('PUT', '/api/tmc-requests/' + requestId + '/status', { role: 'DIRECTOR_GEN', body: { status: 'approved' } });
        assertOk(resp, 'DIRECTOR_GEN approves TMC request');
        assert(resp.data?.item?.status === 'approved', 'Status must be approved');
        assert(resp.data?.item?.approved_by, 'approved_by must be set');
      }
    },
    {
      name: 'BUH marks as ordered (approved -> ordered)',
      run: async () => {
        if (!requestId) skip('No TMC request created');
        const resp = await api('PUT', '/api/tmc-requests/' + requestId + '/status', { role: 'BUH', body: { status: 'ordered' } });
        assertOk(resp, 'BUH marks TMC as ordered');
        assert(resp.data?.item?.status === 'ordered', 'Status must be ordered');
      }
    },
    {
      name: 'PM marks as delivered (ordered -> delivered)',
      run: async () => {
        if (!requestId) skip('No TMC request created');
        const resp = await api('PUT', '/api/tmc-requests/' + requestId + '/status', { role: 'PM', body: { status: 'delivered' } });
        assertOk(resp, 'PM marks TMC as delivered');
        assert(resp.data?.item?.status === 'delivered', 'Status must be delivered');
      }
    },
    {
      name: 'PM closes request (delivered -> closed)',
      run: async () => {
        if (!requestId) skip('No TMC request created');
        const resp = await api('PUT', '/api/tmc-requests/' + requestId + '/status', { role: 'PM', body: { status: 'closed' } });
        assertOk(resp, 'PM closes TMC request');
        assert(resp.data?.item?.status === 'closed', 'Status must be closed');
      }
    },
    {
      name: 'Verify invalid status is rejected',
      run: async () => {
        if (!requestId) skip('No TMC request created');
        const resp = await api('PUT', '/api/tmc-requests/' + requestId + '/status', { role: 'PM', body: { status: 'bogus_status' } });
        assert(resp.status === 400, 'Invalid status must be rejected with 400');
      }
    },
    {
      name: 'Cleanup: reset to draft and delete',
      run: async () => {
        if (!requestId) return;
        await api('PUT', '/api/tmc-requests/' + requestId + '/status', { role: 'ADMIN', body: { status: 'draft' } });
        const resp = await api('DELETE', '/api/tmc-requests/' + requestId, { role: 'ADMIN' });
        assertOk(resp, 'Cleanup TMC request');
      }
    }
  ]
};
