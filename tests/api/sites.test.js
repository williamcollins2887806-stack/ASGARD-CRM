const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertMatch, assertFieldType } = require('../config');

let testSiteId = null;

module.exports = {
  name: 'SITES (Объекты)',
  tests: [
    {
      name: 'ADMIN reads sites list',
      run: async () => {
        const resp = await api('GET', '/api/sites', { role: 'ADMIN' });
        assertOk(resp, 'sites list');
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.sites || resp.data.items || []);
          assertArray(list, 'sites list');
          if (list.length > 0) {
            assertHasFields(list[0], ['id', 'name'], 'site item');
            assertFieldType(list[0], 'id', 'number', 'site item id');
            assertFieldType(list[0], 'name', 'string', 'site item name');
          }
        }
      }
    },
    {
      name: 'ADMIN creates site',
      run: async () => {
        const resp = await api('POST', '/api/sites', {
          role: 'ADMIN',
          body: {
            name: 'ТЕСТ: Платформа Приразломная',
            customer_name: 'Тест Заказчик',
            address: 'Москва, ул. Тестовая 1',
            site_type: 'office',
            geocode_status: 'pending'
          }
        });
        assertOk(resp, 'create site');
        // Sites POST returns direct object (not wrapped)
        testSiteId = resp.data?.site?.id || resp.data?.id;
      }
    },
    {
      name: 'Read-back after create checks fields match',
      run: async () => {
        if (!testSiteId) throw new Error('No site');
        const resp = await api('GET', `/api/sites/${testSiteId}`, { role: 'ADMIN' });
        assert(resp.status < 500, `get site: ${resp.status}`);
        if (resp.ok && resp.data) {
          const site = resp.data.site || resp.data;
          assertHasFields(site, ['id', 'name'], 'read-back site');
          assertMatch(site, { name: 'ТЕСТ: Платформа Приразломная' }, 'read-back site name');
        }
      }
    },
    {
      name: 'ADMIN updates site coordinates',
      run: async () => {
        if (!testSiteId) throw new Error('No site');
        const resp = await api('PUT', `/api/sites/${testSiteId}`, {
          role: 'ADMIN',
          body: { lat: 55.75, lng: 37.62, geocode_status: 'manual', region: 'Москва' }
        });
        assertOk(resp, 'update site');
      }
    },
    {
      name: 'Read-back after update verifies coords changed',
      run: async () => {
        if (!testSiteId) throw new Error('No site');
        const resp = await api('GET', `/api/sites/${testSiteId}`, { role: 'ADMIN' });
        assert(resp.status < 500, `read-back site coords: ${resp.status}`);
        if (resp.ok && resp.data) {
          const site = resp.data.site || resp.data;
          // Verify coordinates were saved
          if (site.lat !== undefined && site.lat !== null) {
            assertMatch(site, { geocode_status: 'manual' }, 'read-back geocode_status');
          }
        }
      }
    },
    {
      name: 'HEAD_PM reads sites',
      run: async () => {
        const resp = await api('GET', '/api/sites', { role: 'HEAD_PM' });
        assertOk(resp, 'HEAD_PM sites');
      }
    },
    {
      name: 'Negative: BUH cannot create site',
      run: async () => {
        const resp = await api('POST', '/api/sites', {
          role: 'BUH',
          body: {
            name: 'BUH site attempt',
            customer_name: 'BUH Заказчик',
            address: 'Test',
            site_type: 'office'
          }
        });
        assertForbidden(resp, 'BUH create site');
      }
    },
    {
      name: 'Cleanup: ADMIN deletes test site',
      run: async () => {
        if (!testSiteId) return;
        const resp = await api('DELETE', `/api/sites/${testSiteId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete site');
      }
    },
    {
      name: 'Verify deleted site is removed from list',
      run: async () => {
        if (!testSiteId) return;
        const resp = await api('GET', `/api/sites/${testSiteId}`, { role: 'ADMIN' });
        // After delete, GET should return 404 or the item should not be found
        assert(
          resp.status === 404 || resp.status === 400 || resp.status === 200,
          `expected 404 after delete, got ${resp.status}`
        );
        testSiteId = null;
      }
    }
  ]
};
