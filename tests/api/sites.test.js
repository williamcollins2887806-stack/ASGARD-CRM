const { api, assert, assertOk, assertForbidden } = require('../config');

let testSiteId = null;

module.exports = {
  name: 'SITES (Объекты)',
  tests: [
    {
      name: 'ADMIN reads sites list',
      run: async () => {
        const resp = await api('GET', '/api/sites', { role: 'ADMIN' });
        assertOk(resp, 'sites list');
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
        testSiteId = resp.data?.id;
      }
    },
    {
      name: 'ADMIN reads single site',
      run: async () => {
        if (!testSiteId) throw new Error('No site');
        const resp = await api('GET', `/api/sites/${testSiteId}`, { role: 'ADMIN' });
        assertOk(resp, 'get site');
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
      name: 'HEAD_PM reads sites',
      run: async () => {
        const resp = await api('GET', '/api/sites', { role: 'HEAD_PM' });
        assertOk(resp, 'HEAD_PM sites');
      }
    },
    {
      name: 'Cleanup: ADMIN deletes test site',
      run: async () => {
        if (!testSiteId) return;
        const resp = await api('DELETE', `/api/sites/${testSiteId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete site');
        testSiteId = null;
      }
    }
  ]
};
