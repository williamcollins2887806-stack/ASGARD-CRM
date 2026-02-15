/**
 * TMC_REQUESTS — Full CRUD + status + export + role access + negative tests
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, skip } = require('../config');

let testTmcId = null;
let testWorkId = null;

module.exports = {
  name: 'TMC REQUESTS (Заявки на ТМЦ)',
  tests: [
    // ── Setup ──
    {
      name: 'Setup: find work for FK',
      run: async () => {
        const resp = await api('GET', '/api/works?limit=1', { role: 'ADMIN' });
        assertOk(resp, 'get works');
        const works = Array.isArray(resp.data) ? resp.data : (resp.data?.works || resp.data?.data || []);
        if (works.length > 0) testWorkId = works[0].id;
      }
    },
    // ── READ ──
    {
      name: 'ADMIN reads TMC requests list',
      run: async () => {
        const resp = await api('GET', '/api/tmc-requests', { role: 'ADMIN' });
        assertOk(resp, 'tmc list');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.tmc_requests || resp.data?.data || resp.data?.items || []);
        assertArray(list, 'tmc requests');
      }
    },
    {
      name: 'PM reads TMC requests',
      run: async () => {
        const resp = await api('GET', '/api/tmc-requests', { role: 'PM' });
        assertOk(resp, 'PM tmc list');
      }
    },
    {
      name: 'BUH reads TMC requests',
      run: async () => {
        const resp = await api('GET', '/api/tmc-requests', { role: 'BUH' });
        assertOk(resp, 'BUH tmc list');
      }
    },
    // ── EXPORT ──
    {
      name: 'ADMIN exports TMC requests',
      run: async () => {
        const resp = await api('GET', '/api/tmc-requests/export', { role: 'ADMIN' });
        assert(resp.status < 500, `export should not 5xx, got ${resp.status}`);
      }
    },
    // ── CREATE ──
    {
      name: 'ADMIN creates TMC request',
      run: async () => {
        const resp = await api('POST', '/api/tmc-requests', {
          role: 'ADMIN',
          body: {
            work_id: testWorkId || null,
            title: 'E2E TMC: Материалы для стройки',
            items: JSON.stringify([{ name: 'Цемент', quantity: 10, unit: 'мешок' }]),
            description: 'E2E autotest TMC request',
            urgency: 'normal'
          }
        });
        assertOk(resp, 'create tmc request');
        const tmc = resp.data?.tmc_request || resp.data;
        if (tmc?.id) testTmcId = tmc.id;
      }
    },
    {
      name: 'PM creates TMC request',
      run: async () => {
        const resp = await api('POST', '/api/tmc-requests', {
          role: 'PM',
          body: {
            title: 'PM TMC test',
            description: 'PM autotest'
          }
        });
        assertOk(resp, 'PM create tmc');
        const tmc = resp.data?.tmc_request || resp.data;
        if (tmc?.id) await api('DELETE', `/api/tmc-requests/${tmc.id}`, { role: 'ADMIN' });
      }
    },
    // ── NEGATIVE: forbidden roles ──
    {
      name: 'NEGATIVE: HR cannot create TMC request → 403',
      run: async () => {
        const resp = await api('POST', '/api/tmc-requests', {
          role: 'HR',
          body: { title: 'forbidden' }
        });
        assertForbidden(resp, 'HR create tmc');
      }
    },
    {
      name: 'NEGATIVE: WAREHOUSE cannot create TMC request → 403',
      run: async () => {
        const resp = await api('POST', '/api/tmc-requests', {
          role: 'WAREHOUSE',
          body: { title: 'forbidden' }
        });
        assertForbidden(resp, 'WAREHOUSE create tmc');
      }
    },
    {
      name: 'NEGATIVE: OFFICE_MANAGER cannot create TMC request → 403',
      run: async () => {
        const resp = await api('POST', '/api/tmc-requests', {
          role: 'OFFICE_MANAGER',
          body: { title: 'forbidden' }
        });
        assertForbidden(resp, 'OFFICE_MANAGER create tmc');
      }
    },
    // ── READ by ID ──
    {
      name: 'Read TMC request by ID',
      run: async () => {
        if (!testTmcId) return;
        const resp = await api('GET', `/api/tmc-requests/${testTmcId}`, { role: 'ADMIN' });
        assertOk(resp, 'get tmc by id');
        const tmc = resp.data?.tmc_request || resp.data;
        assertHasFields(tmc, ['id'], 'tmc detail');
      }
    },
    // ── UPDATE ──
    {
      name: 'ADMIN updates TMC request',
      run: async () => {
        if (!testTmcId) return;
        const resp = await api('PUT', `/api/tmc-requests/${testTmcId}`, {
          role: 'ADMIN',
          body: { description: 'Updated TMC request' }
        });
        assertOk(resp, 'update tmc');
      }
    },
    // ── STATUS ──
    {
      name: 'Change TMC request status',
      run: async () => {
        if (!testTmcId) return;
        const resp = await api('PUT', `/api/tmc-requests/${testTmcId}/status`, {
          role: 'ADMIN',
          body: { status: 'approved' }
        });
        if (resp.status === 404) skip('tmc status endpoint not found');
        assertOk(resp, 'tmc status change');
      }
    },
    // ── EXCEL ──
    {
      name: 'TMC request Excel export',
      run: async () => {
        if (!testTmcId) return;
        const resp = await api('GET', `/api/tmc-requests/${testTmcId}/excel`, { role: 'ADMIN' });
        assert(resp.status < 500, `excel should not 5xx, got ${resp.status}`);
      }
    },
    // ── DELETE: only ADMIN ──
    {
      name: 'NEGATIVE: PM cannot delete TMC request → 403',
      run: async () => {
        if (!testTmcId) return;
        const resp = await api('DELETE', `/api/tmc-requests/${testTmcId}`, { role: 'PM' });
        assertForbidden(resp, 'PM delete tmc');
      }
    },
    {
      name: 'NEGATIVE: TO cannot delete TMC request → 403',
      run: async () => {
        if (!testTmcId) return;
        const resp = await api('DELETE', `/api/tmc-requests/${testTmcId}`, { role: 'TO' });
        assertForbidden(resp, 'TO delete tmc');
      }
    },
    {
      name: 'Cleanup: ADMIN deletes TMC request',
      run: async () => {
        if (!testTmcId) return;
        const resp = await api('DELETE', `/api/tmc-requests/${testTmcId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete tmc');
        testTmcId = null;
      }
    }
  ]
};
