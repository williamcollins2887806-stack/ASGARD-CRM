/**
 * SITES — Full CRUD + geocode + role access + negative tests
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, skip } = require('../config');

let testSiteId = null;

module.exports = {
  name: 'SITES FULL (Объекты)',
  tests: [
    // ── READ ──
    {
      name: 'ADMIN reads sites list',
      run: async () => {
        const resp = await api('GET', '/api/sites', { role: 'ADMIN' });
        assertOk(resp, 'sites list');
        const list = Array.isArray(resp.data) ? resp.data : (resp.data?.sites || resp.data?.data || []);
        assertArray(list, 'sites');
      }
    },
    {
      name: 'PM reads sites list',
      run: async () => {
        const resp = await api('GET', '/api/sites', { role: 'PM' });
        assertOk(resp, 'PM sites list');
      }
    },
    {
      name: 'TO reads sites list',
      run: async () => {
        const resp = await api('GET', '/api/sites', { role: 'TO' });
        assertOk(resp, 'TO sites list');
      }
    },
    // ── CREATE ──
    {
      name: 'ADMIN creates site',
      run: async () => {
        const resp = await api('POST', '/api/sites', {
          role: 'ADMIN',
          body: {
            name: 'E2E Тестовый объект',
            address: 'Москва, ул. Тестовая, д. 1',
            description: 'E2E autotest site',
            latitude: 55.7558,
            longitude: 37.6173
          }
        });
        assertOk(resp, 'create site');
        const site = resp.data?.site || resp.data;
        if (site?.id) testSiteId = site.id;
      }
    },
    {
      name: 'PM creates site',
      run: async () => {
        const resp = await api('POST', '/api/sites', {
          role: 'PM',
          body: { name: 'PM Test Site', address: 'Test address' }
        });
        assertOk(resp, 'PM create site');
        const s = resp.data?.site || resp.data;
        if (s?.id) await api('DELETE', `/api/sites/${s.id}`, { role: 'ADMIN' });
      }
    },
    // ── NEGATIVE: forbidden roles cannot create ──
    {
      name: 'NEGATIVE: TO cannot create site → 403',
      run: async () => {
        const resp = await api('POST', '/api/sites', {
          role: 'TO',
          body: { name: 'forbidden', address: 'test' }
        });
        assertForbidden(resp, 'TO create site');
      }
    },
    {
      name: 'NEGATIVE: BUH cannot create site → 403',
      run: async () => {
        const resp = await api('POST', '/api/sites', {
          role: 'BUH',
          body: { name: 'forbidden', address: 'test' }
        });
        assertForbidden(resp, 'BUH create site');
      }
    },
    {
      name: 'NEGATIVE: WAREHOUSE cannot create site → 403',
      run: async () => {
        const resp = await api('POST', '/api/sites', {
          role: 'WAREHOUSE',
          body: { name: 'forbidden' }
        });
        assertForbidden(resp, 'WAREHOUSE create site');
      }
    },
    {
      name: 'NEGATIVE: HR cannot create site → 403',
      run: async () => {
        const resp = await api('POST', '/api/sites', {
          role: 'HR',
          body: { name: 'forbidden' }
        });
        assertForbidden(resp, 'HR create site');
      }
    },
    // ── READ by ID ──
    {
      name: 'Read site by ID',
      run: async () => {
        if (!testSiteId) return;
        const resp = await api('GET', `/api/sites/${testSiteId}`, { role: 'ADMIN' });
        assertOk(resp, 'get site');
        const site = resp.data?.site || resp.data;
        assertHasFields(site, ['id', 'name'], 'site detail');
      }
    },
    // ── UPDATE ──
    {
      name: 'ADMIN updates site',
      run: async () => {
        if (!testSiteId) return;
        const resp = await api('PUT', `/api/sites/${testSiteId}`, {
          role: 'ADMIN',
          body: { name: 'Updated E2E Site', description: 'updated' }
        });
        assertOk(resp, 'update site');
      }
    },
    {
      name: 'NEGATIVE: HR cannot update site → 403',
      run: async () => {
        if (!testSiteId) return;
        const resp = await api('PUT', `/api/sites/${testSiteId}`, {
          role: 'HR',
          body: { name: 'hacked' }
        });
        assertForbidden(resp, 'HR update site');
      }
    },
    // ── GEOCODE ──
    {
      name: 'Geocode endpoint accessible',
      run: async () => {
        const resp = await api('POST', '/api/sites/geocode', {
          role: 'ADMIN',
          body: { address: 'Москва' }
        });
        assert(resp.status < 500, `geocode should not 5xx, got ${resp.status}`);
      }
    },
    // ── DELETE: ADMIN only ──
    {
      name: 'NEGATIVE: PM cannot delete site → 403',
      run: async () => {
        if (!testSiteId) return;
        const resp = await api('DELETE', `/api/sites/${testSiteId}`, { role: 'PM' });
        assertForbidden(resp, 'PM delete site');
      }
    },
    {
      name: 'NEGATIVE: DIRECTOR_COMM cannot delete site → 403',
      run: async () => {
        if (!testSiteId) return;
        const resp = await api('DELETE', `/api/sites/${testSiteId}`, { role: 'DIRECTOR_COMM' });
        assertForbidden(resp, 'DIRECTOR_COMM delete site');
      }
    },
    {
      name: 'Cleanup: ADMIN deletes site',
      run: async () => {
        if (!testSiteId) return;
        const resp = await api('DELETE', `/api/sites/${testSiteId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete site');
        testSiteId = null;
      }
    }
  ]
};
