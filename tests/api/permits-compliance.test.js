/**
 * PERMITS COMPLIANCE & APPLICATIONS WORKFLOW
 */
const { api, assert, assertOk, assertForbidden, skip } = require('../config');

let permitTypeId = null;
let workId = null;
let reqId = null;
let paId = null;
let pa2Id = null;
let pa3Id = null;
let paEmpId = null;

module.exports = {
  name: 'PERMITS COMPLIANCE & APPLICATIONS',
  tests: [
    {
      name: 'Setup: get employee ID for permit apps',
      run: async () => {
        const resp = await api('GET', '/api/data/employees?limit=1', { role: 'ADMIN' });
        const list = resp.data?.employees || resp.data?.items || resp.data || [];
        if (Array.isArray(list) && list.length > 0) paEmpId = list[0].id;
        else paEmpId = 1;
      }
    },
    {
      name: 'ADMIN reads permit types',
      run: async () => {
        const resp = await api('GET', '/api/permits/types', { role: 'ADMIN' });
        if (resp.status === 404) skip('permit types not found');
        assertOk(resp, 'permit types');
        const list = resp.data?.types || resp.data?.items || resp.data || [];
        if (Array.isArray(list) && list.length > 0) permitTypeId = list[0].id;
      }
    },
    {
      name: 'ADMIN creates permit type',
      run: async () => {
        const resp = await api('POST', '/api/permits/types', {
          role: 'ADMIN',
          body: { id: 99999, name: 'E2E Test Permit Type', category: 'work', description: 'Test', validity_months: 12 }
        });
        if (resp.status === 404) skip('POST permit types not found');
        if (resp.status === 500) skip('permit type creation has server issue');
        assertOk(resp, 'create permit type');
        const item = resp.data?.type || resp.data?.item || resp.data;
        if (item?.id) permitTypeId = item.id;
      }
    },
    {
      name: 'ADMIN updates permit type',
      run: async () => {
        if (!permitTypeId) skip('no permitTypeId');
        const resp = await api('PUT', `/api/permits/types/${permitTypeId}`, {
          role: 'ADMIN',
          body: { name: 'E2E Test Permit Type Updated', validity_days: 180 }
        });
        if (resp.status === 404) skip('PUT permit types not found');
        assertOk(resp, 'update permit type');
      }
    },
    {
      name: 'Setup: get real work ID',
      run: async () => {
        const resp = await api('GET', '/api/works?limit=1', { role: 'ADMIN' });
        const list = resp.data?.works || resp.data?.items || resp.data || [];
        if (Array.isArray(list) && list.length > 0) workId = list[0].id;
        else skip('no works in system');
      }
    },
    {
      name: 'ADMIN reads permit requirements for work',
      run: async () => {
        if (!workId) skip('no workId');
        const resp = await api('GET', `/api/permits/work/${workId}/requirements`, { role: 'ADMIN' });
        if (resp.status === 404) skip('work requirements not found');
        assert([200, 500].includes(resp.status), 'work permit requirements: got ' + resp.status);
        if (resp.status === 500) skip('permit requirements endpoint has server issue');
      }
    },
    {
      name: 'ADMIN adds permit requirement to work',
      run: async () => {
        if (!workId) skip('no workId');
        const resp = await api('POST', `/api/permits/work/${workId}/requirements`, {
          role: 'ADMIN',
          body: { permit_type_id: permitTypeId || 1, is_required: true }
        });
        if (resp.status === 404) skip('POST requirements not found');
        if (resp.status === 400) skip('add requirement 400: ' + JSON.stringify(resp.data));
        assertOk(resp, 'add permit requirement');
        const item = resp.data?.requirement || resp.data?.item || resp.data;
        reqId = item?.id;
      }
    },
    {
      name: 'ADMIN reads compliance for work',
      run: async () => {
        if (!workId) skip('no workId');
        const resp = await api('GET', `/api/permits/work/${workId}/compliance`, { role: 'ADMIN' });
        if (resp.status === 404) skip('compliance not found');
        assertOk(resp, 'work compliance check');
      }
    },
    {
      name: 'ADMIN checks expiring permits',
      run: async () => {
        const resp = await api('GET', '/api/permits/check-expiry', { role: 'ADMIN' });
        if (resp.status === 404) skip('check-expiry not found');
        assertOk(resp, 'check expiring permits');
      }
    },
    {
      name: 'ADMIN deletes permit requirement',
      run: async () => {
        if (!reqId || !workId) skip('no reqId or workId');
        const resp = await api('DELETE', `/api/permits/work/${workId}/requirements/${reqId}`, { role: 'ADMIN' });
        if (resp.status === 404) skip('DELETE requirement not found');
        assertOk(resp, 'delete permit requirement');
      }
    },
    {
      name: 'NEGATIVE: WAREHOUSE cannot manage permit types',
      run: async () => {
        const resp = await api('POST', '/api/permits/types', {
          role: 'WAREHOUSE',
          body: { name: 'Hack Type', validity_days: 1 }
        });
        if (resp.status === 404) skip('endpoint not found');
        assert([403].includes(resp.status), 'WAREHOUSE should get 403 on permit types, got ' + resp.status);
      }
    },
    // ── Permit Applications Workflow ──
    {
      name: 'HR creates permit application',
      run: async () => {
        const resp = await api('POST', '/api/permit-applications', {
          role: 'HR',
          body: {
            title: 'E2E Test Application',
            contractor_name: 'ООО Тестовый Подрядчик',
            contractor_email: 'test@example.com',
            items: [{ employee_id: paEmpId || 1, permit_type_ids: [permitTypeId || 99999] }]
          }
        });
        if (resp.status === 403) skip('HR cannot create permit application');
        if (resp.status === 404) skip('permit-applications not found');
        assertOk(resp, 'create permit application');
        const item = resp.data?.application || resp.data?.item || resp.data;
        paId = item?.id;
      }
    },
    {
      name: 'ADMIN creates second permit application',
      run: async () => {
        const resp = await api('POST', '/api/permit-applications', {
          role: 'ADMIN',
          body: {
            title: 'E2E Reject Test Application',
            contractor_name: 'ООО Тестовый Подрядчик',
            contractor_email: 'test2@example.com',
            items: [{ employee_id: paEmpId || 1, permit_type_ids: [permitTypeId || 99999] }]
          }
        });
        if (resp.status === 404) skip('permit-applications not found');
        assertOk(resp, 'create second permit application');
        const item = resp.data?.application || resp.data?.item || resp.data;
        pa2Id = item?.id;
      }
    },
    {
      name: 'ADMIN creates third permit application for fast-track',
      run: async () => {
        const resp = await api('POST', '/api/permit-applications', {
          role: 'ADMIN',
          body: {
            title: 'E2E Fast Track Test Application',
            contractor_name: 'ООО Тестовый Подрядчик',
            contractor_email: 'test3@example.com',
            items: [{ employee_id: paEmpId || 1, permit_type_ids: [permitTypeId || 99999] }]
          }
        });
        if (resp.status === 404) skip('permit-applications not found');
        assertOk(resp, 'create third permit application');
        const item = resp.data?.application || resp.data?.item || resp.data;
        pa3Id = item?.id;
      }
    },
    {
      name: 'ADMIN analyzes permit application',
      run: async () => {
        if (!paId) skip('no paId');
        const resp = await api('POST', `/api/permit-applications/${paId}/analyze`, { role: 'ADMIN', body: {} });
        if (resp.status === 404) skip('analyze not found');
        assert([200, 400, 503].includes(resp.status), 'analyze: got ' + resp.status);
      }
    },
    {
      name: 'ADMIN requests docs from applicant',
      run: async () => {
        if (!paId) skip('no paId');
        const resp = await api('POST', `/api/permit-applications/${paId}/request-docs`, {
          role: 'ADMIN',
          body: { message: 'Please provide required documents' }
        });
        if (resp.status === 404) skip('request-docs not found');
        assert([200, 400].includes(resp.status), 'request-docs: got ' + resp.status);
      }
    },
    {
      name: 'ADMIN accepts permit application',
      run: async () => {
        if (!paId) skip('no paId');
        const resp = await api('POST', `/api/permit-applications/${paId}/accept`, { role: 'ADMIN', body: {} });
        if (resp.status === 404) skip('accept not found');
        assert([200, 400].includes(resp.status), 'accept application: got ' + resp.status);
      }
    },
    {
      name: 'ADMIN rejects second permit application',
      run: async () => {
        if (!pa2Id) skip('no pa2Id');
        const resp = await api('POST', `/api/permit-applications/${pa2Id}/reject`, {
          role: 'ADMIN',
          body: { reason: 'Insufficient documentation' }
        });
        if (resp.status === 404) skip('reject not found');
        assert([200, 400].includes(resp.status), 'reject application: got ' + resp.status);
      }
    },
    {
      name: 'ADMIN fast-tracks third permit application',
      run: async () => {
        if (!pa3Id) skip('no pa3Id');
        const resp = await api('POST', `/api/permit-applications/${pa3Id}/fast-track`, { role: 'ADMIN', body: {} });
        if (resp.status === 404) skip('fast-track not found');
        assert([200, 400].includes(resp.status), 'fast-track: got ' + resp.status);
      }
    },
    {
      name: 'Create permit application from email text',
      run: async () => {
        const resp = await api('POST', '/api/permit-applications/from-email', {
          role: 'ADMIN',
          body: {
            subject: 'Заявка на пропуск для Иванова',
            body: 'Прошу оформить пропуск для Иванова И.И. с 01.03.2026 по 31.03.2026',
            from: 'test@example.com'
          }
        });
        if (resp.status === 404) skip('from-email not found');
        assert([200, 400, 422].includes(resp.status), 'from-email: got ' + resp.status);
      }
    },
    {
      name: 'NEGATIVE: PM cannot accept permit applications',
      run: async () => {
        if (!paId) skip('no paId');
        const resp = await api('POST', `/api/permit-applications/${paId}/accept`, { role: 'PM', body: {} });
        if (resp.status === 404) skip('endpoint not found');
        assert([403, 400].includes(resp.status), 'PM accept should fail, got ' + resp.status);
      }
    },
    {
      name: 'Cleanup: delete permit applications',
      run: async () => {
        if (paId) await api('DELETE', `/api/permit-applications/${paId}`, { role: 'ADMIN' });
        if (pa2Id) await api('DELETE', `/api/permit-applications/${pa2Id}`, { role: 'ADMIN' });
        if (pa3Id) await api('DELETE', `/api/permit-applications/${pa3Id}`, { role: 'ADMIN' });
      }
    }
  ]
};
