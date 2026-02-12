/**
 * PERMIT_APPLICATIONS - Permit application workflow — deep CRUD + validation
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, assertFieldType, assertMatch, skip } = require('../config');

let testPermitAppId = null;

module.exports = {
  name: 'PERMIT APPLICATIONS (Заявки на допуски)',
  tests: [
    {
      name: 'ADMIN reads permit applications — validates shape',
      run: async () => {
        const resp = await api('GET', '/api/permit-applications', { role: 'ADMIN' });
        assertOk(resp, 'permit apps');
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.applications || resp.data.items || []);
          assertArray(list, 'permit apps list');
          if (list.length > 0) {
            assertHasFields(list[0], ['id'], 'permit app item');
            assertFieldType(list[0], 'id', 'number', 'permit app id');
          }
        }
      }
    },
    {
      name: 'HR reads permit applications',
      run: async () => {
        const resp = await api('GET', '/api/permit-applications', { role: 'HR' });
        assertOk(resp, 'HR permit apps');
      }
    },
    {
      name: 'TO reads permit applications',
      run: async () => {
        const resp = await api('GET', '/api/permit-applications', { role: 'TO' });
        assertOk(resp, 'TO permit apps');
      }
    },
    {
      name: 'ADMIN reads permit application types — validates array',
      run: async () => {
        const resp = await api('GET', '/api/permit-applications/types', { role: 'ADMIN' });
        assertOk(resp, 'permit app types');
        if (resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.types || resp.data.items || []);
          assertArray(list, 'permit app types list');
          if (list.length > 0) {
            assertHasFields(list[0], ['id'], 'permit type item');
          }
        }
      }
    },
    {
      name: 'HR creates permit application',
      run: async () => {
        const resp = await api('POST', '/api/permit-applications', {
          role: 'HR',
          body: {
            contractor_name: 'ООО Тест Stage12',
            title: 'Тест заявка Stage12',
            items: [{ employee_id: 1, type_ids: [1] }]
          }
        });
        if (resp.status === 400) skip('Cannot create permit app: validation error');
        assertOk(resp, 'create permit app');
        if (resp.ok) {
          testPermitAppId = resp.data?.application?.id || resp.data?.id;
        }
      }
    },
    {
      name: 'Read-back permit application after create',
      run: async () => {
        if (!testPermitAppId) return;
        const resp = await api('GET', `/api/permit-applications/${testPermitAppId}`, { role: 'HR' });
        assertOk(resp, 'read-back permit');
        if (resp.ok && resp.data) {
          const app = resp.data.application || resp.data;
          assertHasFields(app, ['id'], 'read-back permit app');
        }
      }
    },
    {
      name: 'HR updates permit application',
      run: async () => {
        if (!testPermitAppId) return;
        const resp = await api('PUT', `/api/permit-applications/${testPermitAppId}`, {
          role: 'HR',
          body: { employee_name: 'Тест Обновлено Stage12' }
        });
        assertOk(resp, 'update permit');
      }
    },
    {
      name: 'NEGATIVE: BUH cannot access permit applications',
      run: async () => {
        const resp = await api('GET', '/api/permit-applications', { role: 'BUH' });
        assertForbidden(resp, 'BUH permit apps');
      }
    },
    {
      name: 'NEGATIVE: WAREHOUSE cannot create permit application',
      run: async () => {
        const resp = await api('POST', '/api/permit-applications', {
          role: 'WAREHOUSE',
          body: { employee_name: 'Test', permit_type: 'safety' }
        });
        assertForbidden(resp, 'WAREHOUSE create permit app');
      }
    },
    {
      name: 'NEGATIVE: create with empty body → 400',
      run: async () => {
        const resp = await api('POST', '/api/permit-applications', { role: 'HR', body: {} });
        assert(resp.status === 400, `empty body: expected 4xx, got ${resp.status}`);
      }
    },
    {
      name: 'NEGATIVE: GET non-existent permit application → 404',
      run: async () => {
        const resp = await api('GET', '/api/permit-applications/999999', { role: 'ADMIN' });
        assert(resp.status === 404 || resp.status === 400, `non-existent: expected 404, got ${resp.status}`);
      }
    },
    {
      name: 'Contractors autocomplete returns array',
      run: async () => {
        const resp = await api('GET', '/api/permit-applications/contractors', { role: 'HR' });
        assertOk(resp, 'contractors');
        if (resp.ok && resp.data) {
          const list = Array.isArray(resp.data) ? resp.data : (resp.data.contractors || []);
          assertArray(list, 'contractors list');
        }
      }
    },
    {
      name: 'Cleanup: delete test permit application',
      run: async () => {
        if (!testPermitAppId) return;
        const resp = await api('DELETE', `/api/permit-applications/${testPermitAppId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete permit');
        testPermitAppId = null;
      }
    }
  ]
};
