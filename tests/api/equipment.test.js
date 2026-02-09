const { api, assert, assertOk } = require('../config');

module.exports = {
  name: 'EQUIPMENT (Оборудование)',
  tests: [
    {
      name: 'ADMIN reads equipment list',
      run: async () => {
        const resp = await api('GET', '/api/equipment', { role: 'ADMIN' });
        assertOk(resp, 'equipment list');
      }
    },
    {
      name: 'ADMIN reads categories',
      run: async () => {
        const resp = await api('GET', '/api/equipment/categories', { role: 'ADMIN' });
        assertOk(resp, 'categories');
      }
    },
    {
      name: 'ADMIN reads warehouses',
      run: async () => {
        const resp = await api('GET', '/api/equipment/warehouses', { role: 'ADMIN' });
        assertOk(resp, 'warehouses');
      }
    },
    {
      name: 'WAREHOUSE reads equipment list',
      run: async () => {
        const resp = await api('GET', '/api/equipment', { role: 'WAREHOUSE' });
        assertOk(resp, 'WAREHOUSE equipment');
      }
    },
    {
      name: 'CHIEF_ENGINEER reads equipment (inherits WAREHOUSE)',
      run: async () => {
        const resp = await api('GET', '/api/equipment', { role: 'CHIEF_ENGINEER' });
        assertOk(resp, 'CHIEF_ENGINEER equipment');
      }
    },
    {
      name: 'Equipment stats summary',
      run: async () => {
        const resp = await api('GET', '/api/equipment/stats/summary', { role: 'ADMIN' });
        assertOk(resp, 'equipment stats');
      }
    },
    {
      name: 'Equipment requests list',
      run: async () => {
        const resp = await api('GET', '/api/equipment/requests', { role: 'ADMIN' });
        assertOk(resp, 'equipment requests');
      }
    },
    {
      name: 'Upcoming maintenance',
      run: async () => {
        const resp = await api('GET', '/api/equipment/maintenance/upcoming', { role: 'ADMIN' });
        assertOk(resp, 'upcoming maintenance');
      }
    }
  ]
};
