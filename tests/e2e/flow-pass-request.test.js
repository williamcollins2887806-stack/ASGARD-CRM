/**
 * E2E FLOW: Pass Request Lifecycle
 * PM creates pass request for work site -> submits -> DIRECTOR_GEN approves -> verify status chain
 * Statuses: draft -> submitted -> approved -> issued -> expired
 */
const { api, assert, assertOk, assertStatus, assertForbidden, skip } = require('../config');

let passId = null;

module.exports = {
  name: 'FLOW: Pass Request Lifecycle (PM -> Director approval -> Status chain)',
  tests: [
    {
      name: 'BUH cannot create pass request (forbidden)',
      run: async () => {
        const resp = await api('POST', '/api/pass-requests', { role: 'BUH', body: { object_name: 'E2E: BUH attempt pass', pass_date_from: '2026-03-01', pass_date_to: '2026-03-31' } });
        if (resp.status === 404) skip('Pass requests endpoint not available');
        assertForbidden(resp, 'BUH should not create pass requests');
      }
    },
    {
      name: 'PM creates pass request (draft)',
      run: async () => {
        const resp = await api('POST', '/api/pass-requests', {
          role: 'PM',
          body: {
            object_name: 'E2E: Noyabrsk Oil Field Site Alpha',
            pass_date_from: '2026-03-01',
            pass_date_to: '2026-03-31',
            employees_json: [
              { fio: 'Ivanov Ivan', passport: '1234 567890', position: 'Welder' },
              { fio: 'Petrov Petr', passport: '2345 678901', position: 'Fitter' }
            ],
            vehicles_json: [ { brand: 'KAMAZ 65115', plate: 'A123BC89' } ],
            equipment_json: [ { name: 'Welding machine Lincoln 500', serial: 'WM-2024-001' } ],
            contact_person: 'Sidorov S.S.',
            contact_phone: '+7-900-123-4567',
            notes: 'E2E test pass request for pipeline maintenance crew'
          }
        });
        if (resp.status === 404) skip('Pass requests endpoint not available');
        assertOk(resp, 'PM creates pass request');
        passId = resp.data?.item?.id;
        assert(passId, 'Pass request ID must be returned');
        assert(resp.data.item.status === 'draft', 'New pass request must be in draft status');
      }
    },
    {
      name: 'PM views created pass request',
      run: async () => {
        if (!passId) skip('No pass request created');
        const resp = await api('GET', '/api/pass-requests/' + passId, { role: 'PM' });
        assertOk(resp, 'PM views pass request');
        assert(resp.data?.item?.id === passId, 'Pass ID must match');
        assert(resp.data.item.object_name === 'E2E: Noyabrsk Oil Field Site Alpha', 'Object name must match');
      }
    },
    {
      name: 'PM updates pass request details',
      run: async () => {
        if (!passId) skip('No pass request created');
        const resp = await api('PUT', '/api/pass-requests/' + passId, { role: 'PM', body: { notes: 'Updated: E2E test, added safety briefing' } });
        assertOk(resp, 'PM updates pass request');
      }
    },
    {
      name: 'PM submits pass request (draft -> submitted)',
      run: async () => {
        if (!passId) skip('No pass request created');
        const resp = await api('PUT', '/api/pass-requests/' + passId + '/status', { role: 'PM', body: { status: 'submitted' } });
        assertOk(resp, 'PM submits pass request');
        assert(resp.data?.item?.status === 'submitted', 'Status must be submitted');
      }
    },
    {
      name: 'PM lists pass requests and finds the created one',
      run: async () => {
        if (!passId) skip('No pass request created');
        const resp = await api('GET', '/api/pass-requests?limit=20', { role: 'PM' });
        assertOk(resp, 'PM lists pass requests');
        const items = resp.data?.items || [];
        const found = items.find(r => r.id === passId);
        assert(found, 'Created pass request must appear in list');
      }
    },
    {
      name: 'DIRECTOR_GEN approves pass request (submitted -> approved)',
      run: async () => {
        if (!passId) skip('No pass request created');
        const resp = await api('PUT', '/api/pass-requests/' + passId + '/status', { role: 'DIRECTOR_GEN', body: { status: 'approved' } });
        assertOk(resp, 'DIRECTOR_GEN approves pass request');
        assert(resp.data?.item?.status === 'approved', 'Status must be approved');
        assert(resp.data?.item?.approved_by, 'approved_by must be set');
      }
    },
    {
      name: 'HR marks pass as issued (approved -> issued)',
      run: async () => {
        if (!passId) skip('No pass request created');
        const resp = await api('PUT', '/api/pass-requests/' + passId + '/status', { role: 'HR', body: { status: 'issued' } });
        assertOk(resp, 'HR marks pass as issued');
        assert(resp.data?.item?.status === 'issued', 'Status must be issued');
      }
    },
    {
      name: 'Verify final pass request state',
      run: async () => {
        if (!passId) skip('No pass request created');
        const resp = await api('GET', '/api/pass-requests/' + passId, { role: 'ADMIN' });
        assertOk(resp, 'Verify final pass state');
        assert(resp.data?.item?.status === 'issued', 'Final status must be issued');
        assert(resp.data?.item?.approved_by, 'approved_by must be set');
      }
    },
    {
      name: 'Pass request PDF generation',
      run: async () => {
        if (!passId) skip('No pass request created');
        const resp = await api('GET', '/api/pass-requests/' + passId + '/pdf', { role: 'PM' });
        if (resp.status === 404) skip('PDF generation not available');
        assert(resp.status === 200 || resp.status === 302, 'PDF endpoint must return 200 or 302');
      }
    },
    {
      name: 'Verify invalid status is rejected',
      run: async () => {
        if (!passId) skip('No pass request created');
        const resp = await api('PUT', '/api/pass-requests/' + passId + '/status', { role: 'PM', body: { status: 'bogus_status' } });
        assert(resp.status === 400, 'Invalid status must be rejected with 400');
      }
    },
    {
      name: 'Cleanup: reset to draft and delete',
      run: async () => {
        if (!passId) return;
        await api('PUT', '/api/pass-requests/' + passId + '/status', { role: 'ADMIN', body: { status: 'draft' } });
        const resp = await api('DELETE', '/api/pass-requests/' + passId, { role: 'ADMIN' });
        assertOk(resp, 'Cleanup pass request');
      }
    }
  ]
};
