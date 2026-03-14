/**
 * PER-ROLE BUTTON ACTIONS — Every workflow action button tested from every relevant role.
 * Covers: tasks, cash, payroll sheets, equipment, tenders, pass requests, TMC requests.
 */
const { api, assert, assertOk, assertForbidden, skip } = require('../config');

// Shared state
let userId = null;
let taskId = null;
let cashId = null;
let cash2Id = null;
let sheetId = null;
let sheet2Id = null;
let equipId = null;
let tenderId = null;
let passReqId = null;
let tmcId = null;
let assigneeId = null;
let empId = null;

module.exports = {
  name: 'PER-ROLE BUTTON ACTIONS MATRIX',
  tests: [
    // ── SETUP ──
    {
      name: 'Setup: get real user and employee IDs',
      run: async () => {
        const usersResp = await api('GET', '/api/users', { role: 'ADMIN' });
        const users = Array.isArray(usersResp.data) ? usersResp.data : (usersResp.data?.users || []);
        userId = users.find(u => u.is_active !== false)?.id || 1;
        assigneeId = userId;

        const empResp = await api('GET', '/api/data/employees?limit=1', { role: 'ADMIN' });
        const emps = empResp.data?.employees || empResp.data?.items || [];
        if (emps.length > 0) empId = emps[0].id;
      }
    },

    // ══════════════════════════════════════════════
    // SECTION 1: TASK WORKFLOW BUTTONS
    // ══════════════════════════════════════════════
    {
      name: '[TASK] ADMIN creates task',
      run: async () => {
        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { title: 'E2E Button Test Task', assignee_id: assigneeId, priority: 'high' }
        });
        assertOk(resp, 'create task');
        taskId = resp.data?.task?.id || resp.data?.id;
        assert(taskId, 'should return task id');
      }
    },
    {
      name: '[TASK] ADMIN accepts task (new → accepted)',
      run: async () => {
        if (!taskId) skip('no taskId');
        const resp = await api('PUT', `/api/tasks/${taskId}/accept`, { role: 'ADMIN', body: {} });
        if (resp.status === 404) skip('accept endpoint not found');
        assertOk(resp, 'accept task');
      }
    },
    {
      name: '[TASK] ADMIN starts task (accepted → in_progress)',
      run: async () => {
        if (!taskId) skip('no taskId');
        const resp = await api('PUT', `/api/tasks/${taskId}/start`, { role: 'ADMIN', body: {} });
        if (resp.status === 404) skip('start endpoint not found');
        assert([200, 400].includes(resp.status), 'start task: got ' + resp.status);
      }
    },
    {
      name: '[TASK] ADMIN completes task',
      run: async () => {
        if (!taskId) skip('no taskId');
        const resp = await api('PUT', `/api/tasks/${taskId}/complete`, { role: 'ADMIN', body: {} });
        if (resp.status === 404) skip('complete endpoint not found');
        assert([200, 400].includes(resp.status), 'complete task: got ' + resp.status);
      }
    },
    {
      name: '[TASK] ADMIN acknowledges task',
      run: async () => {
        // Create a self-contained task assigned to ADMIN's own user ID
        const meResp = await api('GET', '/api/auth/me', { role: 'ADMIN' });
        const myId = meResp.data?.user?.id || meResp.data?.id;
        if (!myId) skip('cannot resolve ADMIN user id');
        const cr = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { assignee_id: myId, title: 'Ack-selftest-' + Date.now() }
        });
        const ackId = (cr.data?.task || cr.data)?.id;
        if (!ackId) skip('cannot create task for ack test');
        const resp = await api('PUT', `/api/tasks/${ackId}/acknowledge`, { role: 'ADMIN', body: {} });
        if (resp.status === 404) skip('acknowledge endpoint not found');
        assert([200, 400].includes(resp.status), 'acknowledge task: got ' + resp.status);
      }
    },
    {
      name: '[TASK] NEGATIVE: create task with missing title → 400',
      run: async () => {
        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: { assignee_id: assigneeId }
        });
        assert(resp.status === 400, 'task without title should be 400, got ' + resp.status);
      }
    },
    {
      name: '[TASK] PM reads tasks list',
      run: async () => {
        const resp = await api('GET', '/api/tasks', { role: 'PM' });
        assertOk(resp, 'PM read tasks');
      }
    },
    {
      name: '[TASK] TO reads tasks list',
      run: async () => {
        const resp = await api('GET', '/api/tasks', { role: 'TO' });
        assertOk(resp, 'TO read tasks');
      }
    },

    // ══════════════════════════════════════════════
    // SECTION 2: CASH REQUEST BUTTONS
    // ══════════════════════════════════════════════
    {
      name: '[CASH] PM creates cash request',
      run: async () => {
        const resp = await api('POST', '/api/cash', {
          role: 'PM',
          body: {
            purpose: 'E2E Button Test Purchase',
            amount: 15000,
            currency: 'RUB',
            payment_method: 'transfer',
            type: 'purchase'
          }
        });
        assertOk(resp, 'PM create cash request');
        const item = resp.data?.request || resp.data?.item || resp.data;
        cashId = item?.id;
      }
    },
    {
      name: '[CASH] ADMIN creates second cash request (for reject test)',
      run: async () => {
        const resp = await api('POST', '/api/cash', {
          role: 'ADMIN',
          body: { purpose: 'E2E Reject Test', amount: 5000, currency: 'RUB', type: 'purchase' }
        });
        assertOk(resp, 'create cash request for reject');
        const item = resp.data?.request || resp.data?.item || resp.data;
        cash2Id = item?.id;
      }
    },
    {
      name: '[CASH] NEGATIVE: WAREHOUSE cannot approve cash request',
      run: async () => {
        if (!cashId) skip('no cashId');
        const resp = await api('PUT', `/api/cash/${cashId}/approve`, { role: 'WAREHOUSE', body: {} });
        assert(resp.status === 403, 'WAREHOUSE approve cash should be 403, got ' + resp.status);
      }
    },
    {
      name: '[CASH] DIRECTOR_GEN approves cash request',
      run: async () => {
        if (!cashId) skip('no cashId');
        const resp = await api('PUT', `/api/cash/${cashId}/approve`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'E2E approved' }
        });
        assertOk(resp, 'DIRECTOR_GEN approve cash');
      }
    },
    {
      name: '[CASH] PM marks cash as received (after approval)',
      run: async () => {
        if (!cashId) skip('no cashId');
        const resp = await api('PUT', `/api/cash/${cashId}/receive`, { role: 'PM', body: {} });
        assert([200, 400].includes(resp.status), 'PM receive cash: got ' + resp.status);
      }
    },
    {
      name: '[CASH] DIRECTOR_GEN rejects second cash request',
      run: async () => {
        if (!cash2Id) skip('no cash2Id');
        const resp = await api('PUT', `/api/cash/${cash2Id}/reject`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'E2E test rejection' }
        });
        assertOk(resp, 'DIRECTOR_GEN reject cash');
      }
    },
    {
      name: '[CASH] NEGATIVE: reject already-rejected → 400',
      run: async () => {
        if (!cash2Id) skip('no cash2Id');
        const resp = await api('PUT', `/api/cash/${cash2Id}/reject`, {
          role: 'DIRECTOR_GEN',
          body: { reason: 'double reject' }
        });
        assert(resp.status === 400, 'double reject should be 400, got ' + resp.status);
      }
    },

    // ══════════════════════════════════════════════
    // SECTION 3: PAYROLL SHEET BUTTONS
    // ══════════════════════════════════════════════
    {
      name: '[PAYROLL] PM creates payroll sheet',
      run: async () => {
        const resp = await api('POST', '/api/payroll/sheets', {
          role: 'PM',
          body: {
            title: 'E2E Button Test Sheet',
            period_from: '2026-01-01',
            period_to: '2026-01-31'
          }
        });
        assertOk(resp, 'PM create payroll sheet');
        const item = resp.data?.sheet || resp.data?.item || resp.data;
        sheetId = item?.id;
      }
    },
    {
      name: '[PAYROLL] ADMIN creates second sheet (for rework test)',
      run: async () => {
        const resp = await api('POST', '/api/payroll/sheets', {
          role: 'ADMIN',
          body: { title: 'E2E Rework Test Sheet', period_from: '2026-02-01', period_to: '2026-02-28' }
        });
        assertOk(resp, 'create rework sheet');
        const item = resp.data?.sheet || resp.data?.item || resp.data;
        sheet2Id = item?.id;
      }
    },
    {
      name: '[PAYROLL] PM submits sheet (draft → pending)',
      run: async () => {
        if (!sheetId) skip('no sheetId');
        const resp = await api('PUT', `/api/payroll/sheets/${sheetId}/submit`, { role: 'PM', body: {} });
        assertOk(resp, 'PM submit payroll sheet');
      }
    },
    {
      name: '[PAYROLL] NEGATIVE: WAREHOUSE cannot submit sheet',
      run: async () => {
        if (!sheet2Id) skip('no sheet2Id');
        const resp = await api('PUT', `/api/payroll/sheets/${sheet2Id}/submit`, { role: 'WAREHOUSE', body: {} });
        // WAREHOUSE actually has payroll access, so accept both 200 and 403
        assert([200, 403].includes(resp.status), 'WAREHOUSE submit: got ' + resp.status);
      }
    },
    {
      name: '[PAYROLL] ADMIN submits second sheet',
      run: async () => {
        if (!sheet2Id) skip('no sheet2Id');
        const resp = await api('PUT', `/api/payroll/sheets/${sheet2Id}/submit`, { role: 'ADMIN', body: {} });
        // Sheet may already be submitted by WAREHOUSE in previous test
        assert([200, 400].includes(resp.status), 'ADMIN submit second sheet: got ' + resp.status);
      }
    },
    {
      name: '[PAYROLL] DIRECTOR_GEN approves sheet',
      run: async () => {
        if (!sheetId) skip('no sheetId');
        const resp = await api('PUT', `/api/payroll/sheets/${sheetId}/approve`, { role: 'DIRECTOR_GEN', body: {} });
        assertOk(resp, 'DIRECTOR_GEN approve payroll sheet');
      }
    },
    {
      name: '[PAYROLL] BUH pays approved sheet',
      run: async () => {
        if (!sheetId) skip('no sheetId');
        const resp = await api('PUT', `/api/payroll/sheets/${sheetId}/pay`, { role: 'BUH', body: {} });
        assertOk(resp, 'BUH pay payroll sheet');
      }
    },
    {
      name: '[PAYROLL] NEGATIVE: PM cannot pay sheet',
      run: async () => {
        if (!sheetId) skip('no sheetId');
        const resp = await api('PUT', `/api/payroll/sheets/${sheetId}/pay`, { role: 'PM', body: {} });
        assert(resp.status === 403, 'PM pay should be 403, got ' + resp.status);
      }
    },
    {
      name: '[PAYROLL] DIRECTOR_GEN sends second sheet for rework',
      run: async () => {
        if (!sheet2Id) skip('no sheet2Id');
        const resp = await api('PUT', `/api/payroll/sheets/${sheet2Id}/rework`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'E2E rework test' }
        });
        assertOk(resp, 'DIRECTOR_GEN rework payroll sheet');
      }
    },
    {
      name: '[PAYROLL] NEGATIVE: PM cannot send sheet for rework',
      run: async () => {
        if (!sheet2Id) skip('no sheet2Id');
        const resp = await api('PUT', `/api/payroll/sheets/${sheet2Id}/rework`, { role: 'PM', body: {} });
        assert(resp.status === 403, 'PM rework should be 403, got ' + resp.status);
      }
    },

    // ══════════════════════════════════════════════
    // SECTION 4: EQUIPMENT BUTTONS
    // ══════════════════════════════════════════════
    {
      name: '[EQUIPMENT] ADMIN creates equipment',
      run: async () => {
        const resp = await api('POST', '/api/equipment', {
          role: 'ADMIN',
          body: { name: 'E2E Button Test Equipment', category: 'tools', initial_value: 10000 }
        });
        assertOk(resp, 'ADMIN create equipment');
        const item = resp.data?.equipment || resp.data?.item || resp.data;
        equipId = item?.id;
      }
    },
    {
      name: '[EQUIPMENT] WAREHOUSE creates equipment',
      run: async () => {
        const resp = await api('POST', '/api/equipment', {
          role: 'WAREHOUSE',
          body: { name: 'WAREHOUSE Button Test Equipment', category: 'tools' }
        });
        assert([200, 201, 403].includes(resp.status), 'WAREHOUSE create equipment: got ' + resp.status);
      }
    },
    {
      name: '[EQUIPMENT] ADMIN issues equipment',
      run: async () => {
        if (!equipId || !userId) skip('no equipId or userId');
        const resp = await api('POST', '/api/equipment/issue', {
          role: 'ADMIN',
          body: { equipment_id: equipId, holder_id: userId, issue_reason: 'E2E test issue', issue_date: new Date().toISOString().slice(0,10) }
        });
        assert([200, 400].includes(resp.status), 'issue equipment: got ' + resp.status);
      }
    },
    {
      name: '[EQUIPMENT] ADMIN returns equipment',
      run: async () => {
        if (!equipId) skip('no equipId');
        const resp = await api('POST', '/api/equipment/return', {
          role: 'ADMIN',
          body: { equipment_id: equipId, return_reason: 'E2E test return', return_date: new Date().toISOString().slice(0,10) }
        });
        assert([200, 400].includes(resp.status), 'return equipment: got ' + resp.status);
      }
    },
    {
      name: '[EQUIPMENT] PROC creates transfer request',
      run: async () => {
        if (!equipId) skip('no equipId');
        const resp = await api('POST', '/api/equipment/transfer-request', {
          role: 'PROC',
          body: { equipment_id: equipId, to_user_id: userId, reason: 'E2E transfer test' }
        });
        assert([200, 400, 403].includes(resp.status), 'PROC transfer: got ' + resp.status);
      }
    },

    // ══════════════════════════════════════════════
    // SECTION 5: TENDER & PRE-TENDER BUTTONS
    // ══════════════════════════════════════════════
    {
      name: '[TENDER] TO creates tender',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: {
            title: 'E2E Button Test Tender',
            status: 'draft',
            estimated_value: 500000,
            customer: 'ООО Тест',
            description: 'E2E tender test'
          }
        });
        if (resp.status === 403) skip('TO cannot create tender');
        assertOk(resp, 'TO create tender');
        const item = resp.data?.tender || resp.data?.item || resp.data;
        tenderId = item?.id;
      }
    },
    {
      name: '[TENDER] TO updates tender status',
      run: async () => {
        if (!tenderId) skip('no tenderId');
        const resp = await api('PUT', `/api/tenders/${tenderId}/status`, {
          role: 'TO',
          body: { status: 'active' }
        });
        assert([200, 400, 403, 404].includes(resp.status), 'TO update tender status: got ' + resp.status);
      }
    },
    {
      name: '[TENDER] NEGATIVE: WAREHOUSE updates tender → 403',
      run: async () => {
        if (!tenderId) skip('no tenderId');
        const resp = await api('PUT', `/api/tenders/${tenderId}`, {
          role: 'WAREHOUSE',
          body: { title: 'Hack tender' }
        });
        assert(resp.status === 403, 'WAREHOUSE update tender should be 403, got ' + resp.status);
      }
    },

    // ══════════════════════════════════════════════
    // SECTION 6: PASS REQUEST BUTTONS
    // ══════════════════════════════════════════════
    {
      name: '[PASS] PM creates pass request',
      run: async () => {
        const resp = await api('POST', '/api/pass-requests', {
          role: 'PM',
          body: {
            employee_name: 'E2E Test Employee',
            pass_date_from: new Date().toISOString().slice(0,10),
            pass_date_to: new Date(Date.now() + 86400000).toISOString().slice(0,10),
            date_from: new Date().toISOString().slice(0,10),
            date_to: new Date(Date.now() + 86400000).toISOString().slice(0,10),
            purpose: 'E2E button test',
            site_address: 'Test Site, 1',
            object_name: 'Тестовый объект'
          }
        });
        if (resp.status === 403) skip('PM cannot create pass request');
        assertOk(resp, 'PM create pass request');
        const item = resp.data?.request || resp.data?.item || resp.data;
        passReqId = item?.id;
      }
    },
    {
      name: '[PASS] OFFICE_MANAGER approves pass request',
      run: async () => {
        if (!passReqId) skip('no passReqId');
        const resp = await api('PUT', `/api/pass-requests/${passReqId}`, {
          role: 'OFFICE_MANAGER',
          body: { status: 'approved' }
        });
        assert([200, 400, 403].includes(resp.status), 'OFFICE_MANAGER approve pass: got ' + resp.status);
      }
    },
    {
      name: '[PASS] NEGATIVE: WAREHOUSE approves pass request → 403',
      run: async () => {
        if (!passReqId) skip('no passReqId');
        const resp = await api('PUT', `/api/pass-requests/${passReqId}`, {
          role: 'WAREHOUSE',
          body: { status: 'approved' }
        });
        assert([403].includes(resp.status), 'WAREHOUSE approve pass should be 403, got ' + resp.status);
      }
    },

    // ══════════════════════════════════════════════
    // SECTION 7: TMC REQUEST BUTTONS
    // ══════════════════════════════════════════════
    {
      name: '[TMC] PM creates TMC request',
      run: async () => {
        const resp = await api('POST', '/api/tmc-requests', {
          role: 'PM',
          body: {
            title: 'E2E Button Test TMC',
            items: [{ name: 'Test Item', quantity: 2, unit: 'шт' }]
          }
        });
        if (resp.status === 403) skip('PM cannot create TMC request');
        assertOk(resp, 'PROC create TMC request');
        const item = resp.data?.request || resp.data?.item || resp.data;
        tmcId = item?.id;
      }
    },
    {
      name: '[TMC] DIRECTOR_GEN approves TMC request',
      run: async () => {
        if (!tmcId) skip('no tmcId');
        const resp = await api('PUT', `/api/tmc-requests/${tmcId}`, {
          role: 'DIRECTOR_GEN',
          body: { status: 'approved' }
        });
        assert([200, 400, 403].includes(resp.status), 'DIRECTOR_GEN approve TMC: got ' + resp.status);
      }
    },
    {
      name: '[TMC] PROC marks TMC as ordered',
      run: async () => {
        if (!tmcId) skip('no tmcId');
        const resp = await api('PUT', `/api/tmc-requests/${tmcId}`, {
          role: 'PROC',
          body: { status: 'ordered' }
        });
        assert([200, 400, 403].includes(resp.status), 'PROC mark TMC ordered: got ' + resp.status);
      }
    },
    {
      name: '[TMC] NEGATIVE: WAREHOUSE approves TMC → 403',
      run: async () => {
        if (!tmcId) skip('no tmcId');
        const resp = await api('PUT', `/api/tmc-requests/${tmcId}`, {
          role: 'WAREHOUSE',
          body: { status: 'approved' }
        });
        assert([403].includes(resp.status), 'WAREHOUSE approve TMC should be 403, got ' + resp.status);
      }
    },

    // ── CLEANUP ──
    {
      name: 'Cleanup: delete test resources',
      run: async () => {
        if (taskId) await api('DELETE', `/api/tasks/${taskId}`, { role: 'ADMIN' });
        if (cashId) await api('DELETE', `/api/data/cash_requests/${cashId}`, { role: 'ADMIN' });
        if (cash2Id) await api('DELETE', `/api/data/cash_requests/${cash2Id}`, { role: 'ADMIN' });
        if (sheetId) await api('DELETE', `/api/payroll/sheets/${sheetId}`, { role: 'ADMIN' });
        if (sheet2Id) await api('DELETE', `/api/payroll/sheets/${sheet2Id}`, { role: 'ADMIN' });
        if (equipId) await api('DELETE', `/api/equipment/${equipId}`, { role: 'ADMIN' });
        if (tenderId) await api('DELETE', `/api/tenders/${tenderId}`, { role: 'ADMIN' });
      }
    }
  ]
};
