/**
 * E2E FLOW: TKP (Technical-Commercial Proposal) Lifecycle
 * TO creates TKP -> adds items/content -> PM reviews -> status changes -> PDF generation
 */
const { api, assert, assertOk, assertStatus, assertForbidden, skip } = require('../config');

let tkpId = null;

module.exports = {
  name: 'FLOW: TKP Lifecycle (TO -> PM review -> Status -> PDF)',
  tests: [
    {
      name: 'HR cannot create TKP (forbidden)',
      run: async () => {
        const resp = await api('POST', '/api/tkp', { role: 'HR', body: { title: 'E2E: HR attempt TKP', customer_name: 'Test' } });
        if (resp.status === 404) skip('TKP endpoint not available');
        assertForbidden(resp, 'HR should not create TKP');
      }
    },
    {
      name: 'TO creates TKP draft',
      run: async () => {
        const resp = await api('POST', '/api/tkp', {
          role: 'TO',
          body: {
            title: 'E2E: Test Commercial Proposal',
            customer_name: 'E2E Test Client LLC',
            customer_email: 'test@e2e.local',
            services: 'Pipeline inspection, Welding works, Equipment maintenance',
            total_sum: 2500000,
            deadline: '60 calendar days',
            validity_days: 30,
            content_json: {
              description: 'Technical-commercial proposal for pipeline services',
              items: [
                { name: 'Pipeline inspection', quantity: 1, unit: 'lot', price: 1000000, total: 1000000 },
                { name: 'Welding works', quantity: 50, unit: 'm', price: 20000, total: 1000000 },
                { name: 'Equipment maintenance', quantity: 5, unit: 'unit', price: 100000, total: 500000 }
              ]
            }
          }
        });
        if (resp.status === 404) skip('TKP endpoint not available');
        assertOk(resp, 'TO creates TKP');
        tkpId = resp.data?.item?.id;
        assert(tkpId, 'TKP ID must be returned');
        assert(resp.data.item.status === 'draft', 'New TKP must be in draft status');
      }
    },
    {
      name: 'TO views created TKP details',
      run: async () => {
        if (!tkpId) skip('No TKP created');
        const resp = await api('GET', '/api/tkp/' + tkpId, { role: 'TO' });
        assertOk(resp, 'TO views TKP');
        const item = resp.data?.item;
        assert(item.id === tkpId, 'TKP ID must match');
        assert(item.customer_name === 'E2E Test Client LLC', 'Customer name must match');
        assert(parseFloat(item.total_sum) === 2500000, 'Total sum must match');
      }
    },
    {
      name: 'PM can list TKPs (sees own only), ADMIN finds the created one',
      run: async () => {
        if (!tkpId) skip('No TKP created');
        // PM only sees own TKPs (SEE_ALL_ROLES: ADMIN, DIRECTOR_GEN, etc.)
        const pmResp = await api('GET', '/api/tkp?limit=20', { role: 'PM' });
        assertOk(pmResp, 'PM lists TKPs');
        // ADMIN can see all TKPs
        const resp = await api('GET', '/api/tkp?limit=100', { role: 'ADMIN' });
        assertOk(resp, 'ADMIN lists TKPs');
        const items = resp.data?.items || [];
        const found = items.find(t => t.id === tkpId);
        assert(found, 'Created TKP must appear in ADMIN list');
      }
    },
    {
      name: 'PM updates TKP content (review edits)',
      run: async () => {
        if (!tkpId) skip('No TKP created');
        const resp = await api('PUT', '/api/tkp/' + tkpId, { role: 'PM', body: { total_sum: 2600000, services: 'Pipeline inspection, Welding works, Equipment maintenance, Safety audit' } });
        assertOk(resp, 'PM updates TKP');
        assert(parseFloat(resp.data?.item?.total_sum) === 2600000, 'Updated total sum must match');
      }
    },
    {
      name: 'PM changes TKP status to sent',
      run: async () => {
        if (!tkpId) skip('No TKP created');
        const resp = await api('PUT', '/api/tkp/' + tkpId + '/status', { role: 'PM', body: { status: 'sent' } });
        assertOk(resp, 'PM marks TKP as sent');
        assert(resp.data?.item?.status === 'sent', 'Status must be sent');
      }
    },
    {
      name: 'PM changes TKP status to accepted',
      run: async () => {
        if (!tkpId) skip('No TKP created');
        const resp = await api('PUT', '/api/tkp/' + tkpId + '/status', { role: 'PM', body: { status: 'accepted' } });
        assertOk(resp, 'PM marks TKP as accepted');
        assert(resp.data?.item?.status === 'accepted', 'Status must be accepted');
      }
    },
    {
      name: 'TKP PDF generation returns valid response',
      run: async () => {
        if (!tkpId) skip('No TKP created');
        const resp = await api('GET', '/api/tkp/' + tkpId + '/pdf', { role: 'PM' });
        if (resp.status === 404) skip('PDF generation not available');
        assert(resp.status === 200 || resp.status === 302, 'PDF endpoint must return 200 or 302');
      }
    },
    {
      name: 'Verify invalid status is rejected',
      run: async () => {
        if (!tkpId) skip('No TKP created');
        const resp = await api('PUT', '/api/tkp/' + tkpId + '/status', { role: 'PM', body: { status: 'invalid_status' } });
        assert(resp.status === 400, 'Invalid status must be rejected with 400');
      }
    },
    {
      name: 'Reset TKP to draft for cleanup',
      run: async () => {
        if (!tkpId) skip('No TKP created');
        await api('PUT', '/api/tkp/' + tkpId + '/status', { role: 'PM', body: { status: 'draft' } });
      }
    },
    {
      name: 'Cleanup: ADMIN deletes TKP draft',
      run: async () => {
        if (!tkpId) return;
        const resp = await api('DELETE', '/api/tkp/' + tkpId, { role: 'ADMIN' });
        assertOk(resp, 'Cleanup TKP');
      }
    }
  ]
};
