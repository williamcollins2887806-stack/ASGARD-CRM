/**
 * BLOCK 8: ROLE ACTIONS — What each role CAN and CANNOT do
 * PM, TO, BUH, HR, DIRECTOR_GEN, ADMIN, OFFICE_MANAGER, WAREHOUSE
 */
'use strict';

const { api, assert, assertOk, assertStatus, assertForbidden,
        assertArray, assertHasFields,
        skip, TEST_USERS } = require('../config');

module.exports = {
  name: 'BLOCK 8 — ROLE ACTIONS',
  tests: [
    // ═══════════════════════════════════════════════
    // 8.1 PM Role
    // ═══════════════════════════════════════════════
    {
      name: '8.1.1 PM can create tenders',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'PM',
          body: { customer: 'PM-Tender-Test', tender_status: 'Новый' }
        });
        assertOk(resp, 'PM creates tender');
      }
    },
    {
      name: '8.1.2 PM can create works',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'PM-Work-Test', work_status: 'В работе' }
        });
        assertOk(resp, 'PM creates work');
      }
    },
    {
      name: '8.1.3 PM can create estimates',
      run: async () => {
        const resp = await api('POST', '/api/estimates', {
          role: 'PM',
          body: { title: 'PM-Estimate-Test', amount: 100000 }
        });
        assertOk(resp, 'PM creates estimate');
      }
    },
    {
      name: '8.1.4 PM can create invoices',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'PM',
          body: {
            invoice_number: `PM-INV-${Date.now()}`,
            invoice_date: '2026-02-10',
            amount: 50000
          }
        });
        assertOk(resp, 'PM creates invoice');
      }
    },
    {
      name: '8.1.5 PM can create work expenses',
      run: async () => {
        const w = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'Expense source', work_status: 'В работе' }
        });
        const wid = (w.data?.work || w.data)?.id;
        const resp = await api('POST', '/api/expenses/work', {
          role: 'PM',
          body: { work_id: wid, category: 'Материалы', amount: 5000 }
        });
        assertOk(resp, 'PM creates expense');
      }
    },
    {
      name: '8.1.6 PM can create incomes',
      run: async () => {
        const resp = await api('POST', '/api/incomes', {
          role: 'PM',
          body: { amount: 50000, type: 'payment', description: 'PM income test' }
        });
        assertOk(resp, 'PM creates income');
      }
    },
    {
      name: '8.1.7 PM can create cash requests',
      run: async () => {
        const w = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'Cash source', work_status: 'В работе' }
        });
        const wid = (w.data?.work || w.data)?.id;
        const resp = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: wid, amount: 10000, purpose: 'PM cash test', type: 'advance' }
        });
        assertOk(resp, 'PM creates cash request');
      }
    },
    {
      name: '8.1.8 PM cannot manage users',
      run: async () => {
        const resp = await api('POST', '/api/users', {
          role: 'PM',
          body: { login: 'pm_hack', password: 'Test123!', role: 'PM', name: 'Hack' }
        });
        assertForbidden(resp, 'PM denied user management');
      }
    },
    {
      name: '8.1.9 PM cannot approve cash requests',
      run: async () => {
        const w = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'Approval test', work_status: 'В работе' }
        });
        const wid = (w.data?.work || w.data)?.id;
        const c = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: wid, amount: 1000, purpose: 'Approval test', type: 'advance' }
        });
        assertOk(c, 'create');
        const resp = await api('PUT', `/api/cash/${c.data.id}/approve`, { role: 'PM', body: {} });
        assertForbidden(resp, 'PM cannot approve');
      }
    },
    {
      name: '8.1.10 PM cannot access mailbox',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails', { role: 'PM' });
        assertForbidden(resp, 'PM denied mailbox');
      }
    },

    // ═══════════════════════════════════════════════
    // 8.2 TO Role
    // ═══════════════════════════════════════════════
    {
      name: '8.2.1 TO can create tenders',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'TO-Tender-Test', tender_status: 'Новый' }
        });
        assertOk(resp, 'TO creates tender');
      }
    },
    {
      name: '8.2.2 TO can read tenders list',
      run: async () => {
        const resp = await api('GET', '/api/tenders', { role: 'TO' });
        assertOk(resp, 'TO reads tenders');
      }
    },
    {
      name: '8.2.3 TO cannot create work expenses → 403',
      run: async () => {
        const resp = await api('POST', '/api/expenses/work', {
          role: 'TO',
          body: { category: 'Материалы', amount: 1000 }
        });
        assertForbidden(resp, 'TO denied expense');
      }
    },
    {
      name: '8.2.4 TO cannot create invoices → 403',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'TO',
          body: { invoice_number: 'X', invoice_date: '2026-01-01', amount: 1000 }
        });
        assertForbidden(resp, 'TO denied invoices');
      }
    },
    {
      name: '8.2.5 TO cannot approve cash → 403',
      run: async () => {
        // Create a cash request as PM first
        const w = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'TO approve test', work_status: 'В работе' }
        });
        const wid = (w.data?.work || w.data)?.id;
        const c = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: wid, amount: 1000, purpose: 'TO test', type: 'advance' }
        });
        const resp = await api('PUT', `/api/cash/${c.data.id}/approve`, { role: 'TO', body: {} });
        assertForbidden(resp, 'TO denied approve');
      }
    },

    // ═══════════════════════════════════════════════
    // 8.3 BUH Role
    // ═══════════════════════════════════════════════
    {
      name: '8.3.1 BUH can read invoices',
      run: async () => {
        const resp = await api('GET', '/api/invoices', { role: 'BUH' });
        assertOk(resp, 'BUH reads invoices');
      }
    },
    {
      name: '8.3.2 BUH can create invoices',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'BUH',
          body: {
            invoice_number: `BUH-INV-${Date.now()}`,
            invoice_date: '2026-02-10',
            amount: 75000
          }
        });
        assertOk(resp, 'BUH creates invoice');
      }
    },
    {
      name: '8.3.3 BUH can read all work expenses',
      run: async () => {
        const resp = await api('GET', '/api/expenses/work', { role: 'BUH' });
        assertOk(resp, 'BUH reads expenses');
      }
    },
    {
      name: '8.3.4 BUH cannot create tenders → 403',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'BUH',
          body: { customer: 'BUH attempt', tender_status: 'Новый' }
        });
        assertForbidden(resp, 'BUH denied tender create');
      }
    },
    {
      name: '8.3.5 BUH cannot create works → 403',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'BUH',
          body: { work_title: 'BUH attempt' }
        });
        assertForbidden(resp, 'BUH denied work create');
      }
    },
    {
      name: '8.3.6 BUH cannot create estimates → 403',
      run: async () => {
        const resp = await api('POST', '/api/estimates', {
          role: 'BUH',
          body: { title: 'BUH estimate attempt' }
        });
        assertForbidden(resp, 'BUH denied estimate');
      }
    },

    // ═══════════════════════════════════════════════
    // 8.4 HR Role
    // ═══════════════════════════════════════════════
    {
      name: '8.4.1 HR can create employees',
      run: async () => {
        const resp = await api('POST', '/api/staff/employees', {
          role: 'HR',
          body: { fio: 'HR Test Employee', position: 'Тестер' }
        });
        assertOk(resp, 'HR creates employee');
      }
    },
    {
      name: '8.4.2 HR can read employees',
      run: async () => {
        const resp = await api('GET', '/api/staff/employees', { role: 'HR' });
        assertOk(resp, 'HR reads employees');
        assertArray(resp.data?.employees || resp.data, 'employees');
      }
    },
    {
      name: '8.4.3 HR cannot create tenders → 403',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'HR',
          body: { customer: 'HR attempt', tender_status: 'Новый' }
        });
        assertForbidden(resp, 'HR denied tenders');
      }
    },
    {
      name: '8.4.4 HR cannot create invoices → 403',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'HR',
          body: { invoice_number: 'X', invoice_date: '2026-01-01', amount: 1000 }
        });
        assertForbidden(resp, 'HR denied invoices');
      }
    },
    {
      name: '8.4.5 HR cannot create expenses → 403',
      run: async () => {
        const resp = await api('POST', '/api/expenses/work', {
          role: 'HR',
          body: { category: 'Материалы', amount: 1000 }
        });
        assertForbidden(resp, 'HR denied expenses');
      }
    },

    // ═══════════════════════════════════════════════
    // 8.5 DIRECTOR_GEN Role
    // ═══════════════════════════════════════════════
    {
      name: '8.5.1 DIRECTOR_GEN can approve cash requests',
      run: async () => {
        const w = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'Dir test', work_status: 'В работе' }
        });
        const wid = (w.data?.work || w.data)?.id;
        const c = await api('POST', '/api/cash', {
          role: 'PM',
          body: { work_id: wid, amount: 5000, purpose: 'Director test', type: 'advance' }
        });
        const resp = await api('PUT', `/api/cash/${c.data.id}/approve`, {
          role: 'DIRECTOR_GEN',
          body: { comment: 'OK' }
        });
        assertOk(resp, 'director approves');
      }
    },
    {
      name: '8.5.2 DIRECTOR_GEN can read all tenders',
      run: async () => {
        const resp = await api('GET', '/api/tenders', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'DG reads tenders');
      }
    },
    {
      name: '8.5.3 DIRECTOR_GEN can read all works',
      run: async () => {
        const resp = await api('GET', '/api/works', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'DG reads works');
      }
    },
    {
      name: '8.5.4 DIRECTOR_GEN can view cash summary',
      run: async () => {
        const resp = await api('GET', '/api/cash/summary', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'DG reads cash summary');
      }
    },
    {
      name: '8.5.5 DIRECTOR_GEN can approve/reject estimates',
      run: async () => {
        const c = await api('POST', '/api/estimates', {
          role: 'PM',
          body: { title: 'DG approval test', approval_status: 'pending', amount: 100000 }
        });
        assertOk(c, 'create');
        const id = (c.data?.estimate || c.data).id;
        const resp = await api('PUT', `/api/estimates/${id}`, {
          role: 'DIRECTOR_GEN',
          body: { approval_status: 'approved' }
        });
        assertOk(resp, 'DG approves estimate');
      }
    },
    {
      name: '8.5.6 DIRECTOR_GEN can access mailbox',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/emails?limit=1', { role: 'DIRECTOR_GEN' });
        assertOk(resp, 'DG accesses mailbox');
      }
    },
    {
      name: '8.5.7 DIRECTOR_GEN can read reports',
      run: async () => {
        const resp = await api('GET', '/api/reports/summary', { role: 'DIRECTOR_GEN' });
        // Reports might not exist, but should not be 403
        assert(resp.status !== 403 && resp.status !== 401, `expected non-403, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════
    // 8.6 ADMIN Role
    // ═══════════════════════════════════════════════
    {
      name: '8.6.1 ADMIN can delete tenders',
      run: async () => {
        const c = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'Admin Delete', tender_status: 'Новый' }
        });
        assertOk(c, 'create');
        const id = (c.data?.tender || c.data).id;
        const resp = await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' });
        assertOk(resp, 'admin deletes tender');
      }
    },
    {
      name: '8.6.2 ADMIN can delete works',
      run: async () => {
        const c = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'Admin Delete Work' }
        });
        assertOk(c, 'create');
        const id = (c.data?.work || c.data).id;
        const resp = await api('DELETE', `/api/works/${id}`, { role: 'ADMIN' });
        assertOk(resp, 'admin deletes work');
      }
    },
    {
      name: '8.6.3 ADMIN can delete estimates',
      run: async () => {
        const c = await api('POST', '/api/estimates', {
          role: 'PM',
          body: { title: 'Admin Delete Est' }
        });
        assertOk(c, 'create');
        const id = (c.data?.estimate || c.data).id;
        const resp = await api('DELETE', `/api/estimates/${id}`, { role: 'ADMIN' });
        assertOk(resp, 'admin deletes estimate');
      }
    },
    {
      name: '8.6.4 ADMIN can manage email settings',
      run: async () => {
        const resp = await api('GET', '/api/mailbox/accounts', { role: 'ADMIN' });
        assertOk(resp, 'admin reads accounts');
      }
    },
    {
      name: '8.6.5 ADMIN can manage users',
      run: async () => {
        const resp = await api('GET', '/api/users', { role: 'ADMIN' });
        assertOk(resp, 'admin reads users');
      }
    },

    // ═══════════════════════════════════════════════
    // 8.7 WAREHOUSE Role
    // ═══════════════════════════════════════════════
    {
      name: '8.7.1 WAREHOUSE can read equipment',
      run: async () => {
        const resp = await api('GET', '/api/equipment', { role: 'WAREHOUSE' });
        assertOk(resp, 'WH reads equipment');
      }
    },
    {
      name: '8.7.2 WAREHOUSE can create equipment',
      run: async () => {
        const cats = await api('GET', '/api/equipment/categories', { role: 'WAREHOUSE' });
        const categories = cats.data?.categories || cats.data;
        if (!categories || !categories.length) skip('No categories');

        const resp = await api('POST', '/api/equipment', {
          role: 'WAREHOUSE',
          body: { name: 'WH-Tool', category_id: categories[0].id, purchase_price: 1000 }
        });
        assertOk(resp, 'WH creates equipment');
      }
    },
    {
      name: '8.7.3 WAREHOUSE cannot create tenders → 403',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'WAREHOUSE',
          body: { customer: 'WH attempt', tender_status: 'Новый' }
        });
        assertForbidden(resp, 'WH denied tenders');
      }
    },

    // ═══════════════════════════════════════════════
    // 8.8 OFFICE_MANAGER Role
    // ═══════════════════════════════════════════════
    {
      name: '8.8.1 OFFICE_MANAGER cannot create tenders → 403',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'OFFICE_MANAGER',
          body: { customer: 'OM attempt', tender_status: 'Новый' }
        });
        assertForbidden(resp, 'OM denied tenders');
      }
    },
    {
      name: '8.8.2 OFFICE_MANAGER cannot create works → 403',
      run: async () => {
        const resp = await api('POST', '/api/works', {
          role: 'OFFICE_MANAGER',
          body: { work_title: 'OM attempt' }
        });
        assertForbidden(resp, 'OM denied works');
      }
    },

    // ═══════════════════════════════════════════════
    // 8.9 Cross-role data visibility
    // ═══════════════════════════════════════════════
    {
      name: '8.9.1 All roles can read tenders (GET)',
      run: async () => {
        const readRoles = ['PM', 'TO', 'ADMIN', 'DIRECTOR_GEN', 'HEAD_PM', 'HEAD_TO'];
        for (const role of readRoles) {
          const resp = await api('GET', '/api/tenders?limit=1', { role });
          assertOk(resp, `${role} reads tenders`);
        }
      }
    },
    {
      name: '8.9.2 All authenticated can read employees',
      run: async () => {
        const roles = ['PM', 'TO', 'HR', 'BUH', 'ADMIN', 'DIRECTOR_GEN'];
        for (const role of roles) {
          const resp = await api('GET', '/api/staff/employees?limit=1', { role });
          assertOk(resp, `${role} reads employees`);
        }
      }
    },
    {
      name: '8.9.3 Only ADMIN can delete tenders (others 403)',
      run: async () => {
        // Create a tender
        const c = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'Delete-Role-Test', tender_status: 'Новый' }
        });
        assertOk(c, 'create');
        const id = (c.data?.tender || c.data).id;

        // PM cannot delete
        const pmDel = await api('DELETE', `/api/tenders/${id}`, { role: 'PM' });
        assertForbidden(pmDel, 'PM denied tender delete');

        // TO cannot delete
        const toDel = await api('DELETE', `/api/tenders/${id}`, { role: 'TO' });
        assertForbidden(toDel, 'TO denied tender delete');

        // Cleanup
        await api('DELETE', `/api/tenders/${id}`, { role: 'ADMIN' });
      }
    },
    {
      name: '8.9.4 Only ADMIN can delete works',
      run: async () => {
        const c = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'Delete-Work-Role-Test' }
        });
        assertOk(c, 'create');
        const id = (c.data?.work || c.data).id;

        const pmDel = await api('DELETE', `/api/works/${id}`, { role: 'PM' });
        assertForbidden(pmDel, 'PM denied work delete');

        await api('DELETE', `/api/works/${id}`, { role: 'ADMIN' });
      }
    },
    {
      name: '8.9.5 Only HR-like roles can create employees',
      run: async () => {
        const denyRoles = ['PM', 'TO', 'BUH', 'WAREHOUSE'];
        for (const role of denyRoles) {
          const resp = await api('POST', '/api/staff/employees', {
            role,
            body: { fio: `${role} attempt` }
          });
          assertForbidden(resp, `${role} denied employee create`);
        }
      }
    },

    // ═══════════════════════════════════════════════
    // 8.10 Unauthenticated access
    // ═══════════════════════════════════════════════
    {
      name: '8.10.1 No token → 401 on protected endpoints',
      run: async () => {
        const { rawFetch } = require('../config');
        const endpoints = ['/api/tenders', '/api/works', '/api/staff/employees', '/api/invoices'];
        for (const ep of endpoints) {
          const resp = await rawFetch('GET', ep);
          assert(resp.status === 401, `expected 401 for ${ep}, got ${resp.status}`);
        }
      }
    },
    {
      name: '8.10.2 Invalid token → 401',
      run: async () => {
        const { rawFetch } = require('../config');
        const resp = await rawFetch('GET', '/api/tenders', {
          headers: { 'Authorization': 'Bearer invalid.jwt.token' }
        });
        assert(resp.status === 401, `expected 401, got ${resp.status}`);
      }
    }
  ]
};
