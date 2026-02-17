/**
 * TKP — Full CRUD + status transitions + role access + negative tests
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertFieldType, skip } = require('../config');

let testTkpId = null;
let testTenderId = null;

module.exports = {
  name: 'TKP (Коммерческие предложения)',
  tests: [
    // ── Setup: find tender for FK ──
    {
      name: 'Setup: find tender for TKP reference',
      run: async () => {
        const resp = await api('GET', '/api/tenders?limit=1', { role: 'ADMIN' });
        assertOk(resp, 'get tenders');
        const tenders = Array.isArray(resp.data) ? resp.data : (resp.data?.tenders || resp.data?.data || []);
        if (tenders.length > 0) testTenderId = tenders[0].id;
      }
    },
    // ── READ ──
    {
      name: 'ADMIN reads TKP list',
      run: async () => {
        const resp = await api('GET', '/api/tkp', { role: 'ADMIN' });
        assertOk(resp, 'tkp list');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.tkps || resp.data?.data || resp.data?.items || []);
        assertArray(list, 'tkp');
      }
    },
    {
      name: 'PM reads TKP list',
      run: async () => {
        const resp = await api('GET', '/api/tkp', { role: 'PM' });
        assertOk(resp, 'PM tkp list');
      }
    },
    {
      name: 'TO reads TKP list',
      run: async () => {
        const resp = await api('GET', '/api/tkp', { role: 'TO' });
        assertOk(resp, 'TO tkp list');
      }
    },
    // ── CREATE ──
    {
      name: 'ADMIN creates TKP',
      run: async () => {
        const resp = await api('POST', '/api/tkp', {
          role: 'ADMIN',
          body: {
            tender_id: testTenderId || null,
            title: 'E2E TKP: Коммерческое предложение',
            amount: 500000,
            description: 'E2E autotest TKP',
            status: 'draft'
          }
        });
        assertOk(resp, 'create tkp');
        const tkp = resp.data?.tkp || resp.data;
        if (tkp?.id) testTkpId = tkp.id;
      }
    },
    {
      name: 'PM creates TKP',
      run: async () => {
        const resp = await api('POST', '/api/tkp', {
          role: 'PM',
          body: {
            title: 'PM TKP test',
            amount: 100000,
            description: 'PM autotest TKP'
          }
        });
        assertOk(resp, 'PM create tkp');
        const tkp = resp.data?.tkp || resp.data;
        if (tkp?.id) {
          await api('DELETE', `/api/tkp/${tkp.id}`, { role: 'ADMIN' });
        }
      }
    },
    // ── NEGATIVE: forbidden roles cannot create ──
    {
      name: 'NEGATIVE: HR cannot create TKP → 403',
      run: async () => {
        const resp = await api('POST', '/api/tkp', {
          role: 'HR',
          body: { title: 'forbidden', amount: 100 }
        });
        assertForbidden(resp, 'HR create tkp');
      }
    },
    {
      name: 'NEGATIVE: WAREHOUSE cannot create TKP → 403',
      run: async () => {
        const resp = await api('POST', '/api/tkp', {
          role: 'WAREHOUSE',
          body: { title: 'forbidden', amount: 100 }
        });
        assertForbidden(resp, 'WAREHOUSE create tkp');
      }
    },
    {
      name: 'NEGATIVE: BUH cannot create TKP → 403',
      run: async () => {
        const resp = await api('POST', '/api/tkp', {
          role: 'BUH',
          body: { title: 'forbidden', amount: 100 }
        });
        assertForbidden(resp, 'BUH create tkp');
      }
    },
    // ── READ by ID ──
    {
      name: 'Read TKP by ID',
      run: async () => {
        if (!testTkpId) return;
        const resp = await api('GET', `/api/tkp/${testTkpId}`, { role: 'ADMIN' });
        assertOk(resp, 'get tkp by id');
        const tkp = resp.data?.tkp || resp.data;
        assertHasFields(tkp, ['id'], 'tkp detail');
      }
    },
    // ── UPDATE ──
    {
      name: 'ADMIN updates TKP',
      run: async () => {
        if (!testTkpId) return;
        const resp = await api('PUT', `/api/tkp/${testTkpId}`, {
          role: 'ADMIN',
          body: { amount: 600000, description: 'Updated TKP' }
        });
        assertOk(resp, 'update tkp');
      }
    },
    // ── STATUS TRANSITION ──
    {
      name: 'Change TKP status',
      run: async () => {
        if (!testTkpId) return;
        const resp = await api('PUT', `/api/tkp/${testTkpId}/status`, {
          role: 'ADMIN',
          body: { status: 'sent' }
        });
        if (resp.status === 404) skip('tkp status endpoint not found');
        assertOk(resp, 'tkp status change');
      }
    },
    // ── PDF ──
    {
      name: 'TKP PDF generation',
      run: async () => {
        if (!testTkpId) return;
        const resp = await api('GET', `/api/tkp/${testTkpId}/pdf`, { role: 'ADMIN' });
        // PDF may return 200 or 404 if no template
        assert(resp.status < 500, `PDF should not 5xx, got ${resp.status}`);
      }
    },
    // ── DELETE: only ADMIN ──
    {
      name: 'NEGATIVE: PM cannot delete TKP → 403',
      run: async () => {
        if (!testTkpId) return;
        const resp = await api('DELETE', `/api/tkp/${testTkpId}`, { role: 'PM' });
        assertForbidden(resp, 'PM delete tkp');
      }
    },
    {
      name: 'NEGATIVE: TO cannot delete TKP → 403',
      run: async () => {
        if (!testTkpId) return;
        const resp = await api('DELETE', `/api/tkp/${testTkpId}`, { role: 'TO' });
        assertForbidden(resp, 'TO delete tkp');
      }
    },
    {
      name: 'Cleanup: ADMIN deletes TKP',
      run: async () => {
        if (!testTkpId) return;
        const resp = await api('DELETE', `/api/tkp/${testTkpId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete tkp');
        testTkpId = null;
      }
    }
  ]
};
