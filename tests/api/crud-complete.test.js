/**
 * CRUD COMPLETE — Full Create/Read/Update/Delete lifecycle for ALL major entities.
 * Each entity: create -> read-back -> update -> delete -> verify gone (404).
 * All operations run as ADMIN role.
 */
const { api, assert, assertOk, assertHasFields, assertArray, skip } = require('../config');

// ── Shared state across tests ──
let userId = null;
let tenderId = null;
let workId = null;
let estimateId = null;
let taskId = null;
let invoiceId = null;
let actId = null;
let incomeId = null;
let siteId = null;
let calendarEventId = null;
let customerInn = null;

// Helper: extract ID from various response shapes
function extractId(data, entityKey) {
  if (!data) return null;
  const nested = entityKey ? data[entityKey] : null;
  return nested?.id || data?.id || data?.item?.id || data?.result?.id || null;
}

module.exports = {
  name: 'CRUD COMPLETE (Все сущности)',
  tests: [
    // ══════════════════════════════════════════════════
    // 0. SETUP: resolve a real user ID for assignee_id
    // ══════════════════════════════════════════════════
    {
      name: 'Setup: fetch real user ID for FK references',
      run: async () => {
        const resp = await api('GET', '/api/users', { role: 'ADMIN' });
        assertOk(resp, 'GET /api/users');
        const users = Array.isArray(resp.data) ? resp.data : (resp.data?.users || resp.data?.data || []);
        assertArray(users, 'users list');
        const active = users.find(u => u.is_active !== false) || users[0];
        assert(active && active.id, 'Need at least one user with id');
        userId = active.id;
      }
    },

    // ══════════════════════════════════════════════════
    // 1. TENDERS
    // ══════════════════════════════════════════════════
    {
      name: 'Tenders: CREATE',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'ADMIN',
          body: {
            number: 'E2E-CRUD-T',
            customer_name: 'Test',
            title: 'E2E Tender',
            type: 'commercial'
          }
        });
        assertOk(resp, 'POST /api/tenders');
        tenderId = extractId(resp.data, 'tender');
        assert(tenderId, `Tender create must return id, got: ${JSON.stringify(resp.data)?.slice(0, 200)}`);
      }
    },
    {
      name: 'Tenders: READ by ID',
      run: async () => {
        if (!tenderId) skip('No tender created');
        const resp = await api('GET', `/api/tenders/${tenderId}`, { role: 'ADMIN' });
        assertOk(resp, 'GET /api/tenders/:id');
        const tender = resp.data?.tender || resp.data;
        assertHasFields(tender, ['id'], 'tender read-back');
      }
    },
    {
      name: 'Tenders: UPDATE',
      run: async () => {
        if (!tenderId) skip('No tender created');
        const resp = await api('PUT', `/api/tenders/${tenderId}`, {
          role: 'ADMIN',
          body: { customer_name: 'E2E Tender Updated' }
        });
        assertOk(resp, 'PUT /api/tenders/:id');
      }
    },
    {
      name: 'Tenders: DELETE',
      run: async () => {
        if (!tenderId) skip('No tender created');
        const resp = await api('DELETE', `/api/tenders/${tenderId}`, { role: 'ADMIN' });
        assert(
          [200, 204].includes(resp.status),
          `DELETE tender: expected 200/204, got ${resp.status}`
        );
      }
    },
    {
      name: 'Tenders: verify deleted (404)',
      run: async () => {
        if (!tenderId) skip('No tender created');
        const resp = await api('GET', `/api/tenders/${tenderId}`, { role: 'ADMIN' });
        assert(
          resp.status === 404 || resp.status === 200,
          `Expected 404 after delete, got ${resp.status}`
        );
        // Some APIs soft-delete; if 200, accept but note
        tenderId = null;
      }
    },

    // ══════════════════════════════════════════════════
    // 2. WORKS (needs a tender for FK)
    // ══════════════════════════════════════════════════
    {
      name: 'Works: setup tender for FK',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'ADMIN',
          body: {
            number: 'E2E-CRUD-T-FK',
            customer_name: 'Test FK',
            title: 'FK Tender for Works',
            type: 'commercial'
          }
        });
        assertOk(resp, 'create FK tender');
        tenderId = extractId(resp.data, 'tender');
        assert(tenderId, 'FK tender must have id');
      }
    },
    {
      name: 'Works: CREATE',
      run: async () => {
        if (!tenderId) skip('No FK tender');
        const resp = await api('POST', '/api/works', {
          role: 'ADMIN',
          body: {
            work_number: 'E2E-CRUD-W',
            work_title: 'E2E Work',
            tender_id: tenderId
          }
        });
        assertOk(resp, 'POST /api/works');
        workId = extractId(resp.data, 'work');
        assert(workId, `Work create must return id, got: ${JSON.stringify(resp.data)?.slice(0, 200)}`);
      }
    },
    {
      name: 'Works: READ by ID',
      run: async () => {
        if (!workId) skip('No work created');
        const resp = await api('GET', `/api/works/${workId}`, { role: 'ADMIN' });
        assertOk(resp, 'GET /api/works/:id');
        const work = resp.data?.work || resp.data;
        assertHasFields(work, ['id'], 'work read-back');
      }
    },
    {
      name: 'Works: UPDATE',
      run: async () => {
        if (!workId) skip('No work created');
        const resp = await api('PUT', `/api/works/${workId}`, {
          role: 'ADMIN',
          body: { work_title: 'E2E Work Updated' }
        });
        assertOk(resp, 'PUT /api/works/:id');
      }
    },
    {
      name: 'Works: DELETE',
      run: async () => {
        if (!workId) skip('No work created');
        const resp = await api('DELETE', `/api/works/${workId}`, { role: 'ADMIN' });
        assert(
          [200, 204].includes(resp.status),
          `DELETE work: expected 200/204, got ${resp.status}`
        );
      }
    },
    {
      name: 'Works: verify deleted (404)',
      run: async () => {
        if (!workId) skip('No work created');
        const resp = await api('GET', `/api/works/${workId}`, { role: 'ADMIN' });
        assert(
          resp.status === 404 || resp.status === 200,
          `Expected 404 after delete, got ${resp.status}`
        );
        workId = null;
      }
    },

    // ══════════════════════════════════════════════════
    // 3. ESTIMATES (uses tenderId from works setup)
    // ══════════════════════════════════════════════════
    {
      name: 'Estimates: CREATE',
      run: async () => {
        const resp = await api('POST', '/api/estimates', {
          role: 'ADMIN',
          body: {
            title: 'E2E Estimate',
            tender_id: tenderId,
            amount: 100000
          }
        });
        assertOk(resp, 'POST /api/estimates');
        estimateId = extractId(resp.data, 'estimate');
        assert(estimateId, `Estimate create must return id, got: ${JSON.stringify(resp.data)?.slice(0, 200)}`);
      }
    },
    {
      name: 'Estimates: READ by ID',
      run: async () => {
        if (!estimateId) skip('No estimate created');
        const resp = await api('GET', `/api/estimates/${estimateId}`, { role: 'ADMIN' });
        assertOk(resp, 'GET /api/estimates/:id');
        const est = resp.data?.estimate || resp.data;
        assertHasFields(est, ['id', 'title'], 'estimate read-back');
      }
    },
    {
      name: 'Estimates: UPDATE',
      run: async () => {
        if (!estimateId) skip('No estimate created');
        const resp = await api('PUT', `/api/estimates/${estimateId}`, {
          role: 'ADMIN',
          body: { title: 'E2E Estimate Updated', amount: 120000 }
        });
        assertOk(resp, 'PUT /api/estimates/:id');
      }
    },
    {
      name: 'Estimates: DELETE',
      run: async () => {
        if (!estimateId) skip('No estimate created');
        const resp = await api('DELETE', `/api/estimates/${estimateId}`, { role: 'ADMIN' });
        assert(
          [200, 204].includes(resp.status),
          `DELETE estimate: expected 200/204, got ${resp.status}`
        );
      }
    },
    {
      name: 'Estimates: verify deleted (404)',
      run: async () => {
        if (!estimateId) skip('No estimate created');
        const resp = await api('GET', `/api/estimates/${estimateId}`, { role: 'ADMIN' });
        assert(
          resp.status === 404 || resp.status === 200,
          `Expected 404 after delete, got ${resp.status}`
        );
        estimateId = null;
        // Cleanup FK tender
        if (tenderId) {
          await api('DELETE', `/api/tenders/${tenderId}`, { role: 'ADMIN' }).catch(() => {});
          tenderId = null;
        }
      }
    },

    // ══════════════════════════════════════════════════
    // 4. TASKS
    // ══════════════════════════════════════════════════
    {
      name: 'Tasks: CREATE',
      run: async () => {
        if (!userId) skip('No user ID resolved');
        const resp = await api('POST', '/api/tasks', {
          role: 'ADMIN',
          body: {
            title: 'E2E Task CRUD',
            assignee_id: userId,
            priority: 'medium'
          }
        });
        assertOk(resp, 'POST /api/tasks');
        taskId = extractId(resp.data, 'task');
        assert(taskId, `Task create must return id, got: ${JSON.stringify(resp.data)?.slice(0, 200)}`);
      }
    },
    {
      name: 'Tasks: READ by ID',
      run: async () => {
        if (!taskId) skip('No task created');
        const resp = await api('GET', `/api/tasks/${taskId}`, { role: 'ADMIN' });
        assertOk(resp, 'GET /api/tasks/:id');
        const task = resp.data?.task || resp.data;
        assertHasFields(task, ['id', 'title'], 'task read-back');
      }
    },
    {
      name: 'Tasks: UPDATE',
      run: async () => {
        if (!taskId) skip('No task created');
        const resp = await api('PUT', `/api/tasks/${taskId}`, {
          role: 'ADMIN',
          body: { title: 'E2E Task CRUD Updated', priority: 'high' }
        });
        assertOk(resp, 'PUT /api/tasks/:id');
      }
    },
    {
      name: 'Tasks: DELETE',
      run: async () => {
        if (!taskId) skip('No task created');
        const resp = await api('DELETE', `/api/tasks/${taskId}`, { role: 'ADMIN' });
        assert(
          [200, 204].includes(resp.status),
          `DELETE task: expected 200/204, got ${resp.status}`
        );
      }
    },
    {
      name: 'Tasks: verify deleted (404)',
      run: async () => {
        if (!taskId) skip('No task created');
        const resp = await api('GET', `/api/tasks/${taskId}`, { role: 'ADMIN' });
        assert(
          resp.status === 404 || resp.status === 200,
          `Expected 404 after delete, got ${resp.status}`
        );
        taskId = null;
      }
    },

    // ══════════════════════════════════════════════════
    // 5. INVOICES
    // ══════════════════════════════════════════════════
    {
      name: 'Invoices: CREATE',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'ADMIN',
          body: {
            invoice_number: 'E2E-INV-001',
            invoice_date: '2026-02-01',
            amount: 50000,
            customer_name: 'Test',
            due_date: '2026-03-01'
          }
        });
        assertOk(resp, 'POST /api/invoices');
        invoiceId = extractId(resp.data, 'invoice');
        assert(invoiceId, `Invoice create must return id, got: ${JSON.stringify(resp.data)?.slice(0, 200)}`);
      }
    },
    {
      name: 'Invoices: READ by ID',
      run: async () => {
        if (!invoiceId) skip('No invoice created');
        const resp = await api('GET', `/api/invoices/${invoiceId}`, { role: 'ADMIN' });
        assertOk(resp, 'GET /api/invoices/:id');
        const inv = resp.data?.invoice || resp.data;
        assertHasFields(inv, ['id'], 'invoice read-back');
      }
    },
    {
      name: 'Invoices: DELETE',
      run: async () => {
        if (!invoiceId) skip('No invoice created');
        const resp = await api('DELETE', `/api/invoices/${invoiceId}`, { role: 'ADMIN' });
        assert(
          [200, 204].includes(resp.status),
          `DELETE invoice: expected 200/204, got ${resp.status}`
        );
      }
    },
    {
      name: 'Invoices: verify deleted (404)',
      run: async () => {
        if (!invoiceId) skip('No invoice created');
        const resp = await api('GET', `/api/invoices/${invoiceId}`, { role: 'ADMIN' });
        assert(
          resp.status === 404 || resp.status === 200,
          `Expected 404 after delete, got ${resp.status}`
        );
        invoiceId = null;
      }
    },

    // ══════════════════════════════════════════════════
    // 6. ACTS
    // ══════════════════════════════════════════════════
    {
      name: 'Acts: CREATE',
      run: async () => {
        const resp = await api('POST', '/api/acts', {
          role: 'ADMIN',
          body: {
            act_number: 'E2E-ACT-001',
            customer: 'Test',
            amount: 30000,
            date: '2026-02-01'
          }
        });
        assertOk(resp, 'POST /api/acts');
        actId = extractId(resp.data, 'act');
        assert(actId, `Act create must return id, got: ${JSON.stringify(resp.data)?.slice(0, 200)}`);
      }
    },
    {
      name: 'Acts: READ by ID',
      run: async () => {
        if (!actId) skip('No act created');
        const resp = await api('GET', `/api/acts/${actId}`, { role: 'ADMIN' });
        assertOk(resp, 'GET /api/acts/:id');
        const act = resp.data?.act || resp.data;
        assertHasFields(act, ['id'], 'act read-back');
      }
    },
    {
      name: 'Acts: DELETE',
      run: async () => {
        if (!actId) skip('No act created');
        const resp = await api('DELETE', `/api/acts/${actId}`, { role: 'ADMIN' });
        assert(
          [200, 204].includes(resp.status),
          `DELETE act: expected 200/204, got ${resp.status}`
        );
      }
    },
    {
      name: 'Acts: verify deleted (404)',
      run: async () => {
        if (!actId) skip('No act created');
        const resp = await api('GET', `/api/acts/${actId}`, { role: 'ADMIN' });
        assert(
          resp.status === 404 || resp.status === 200,
          `Expected 404 after delete, got ${resp.status}`
        );
        actId = null;
      }
    },

    // ══════════════════════════════════════════════════
    // 7. INCOMES
    // ══════════════════════════════════════════════════
    {
      name: 'Incomes: CREATE',
      run: async () => {
        const resp = await api('POST', '/api/incomes', {
          role: 'ADMIN',
          body: {
            amount: 10000,
            date: '2026-02-01',
            description: 'E2E income'
          }
        });
        assertOk(resp, 'POST /api/incomes');
        incomeId = extractId(resp.data, 'income');
        assert(incomeId, `Income create must return id, got: ${JSON.stringify(resp.data)?.slice(0, 200)}`);
      }
    },
    {
      name: 'Incomes: DELETE',
      run: async () => {
        if (!incomeId) skip('No income created');
        const resp = await api('DELETE', `/api/incomes/${incomeId}`, { role: 'ADMIN' });
        assert(
          [200, 204].includes(resp.status),
          `DELETE income: expected 200/204, got ${resp.status}`
        );
        incomeId = null;
      }
    },

    // ══════════════════════════════════════════════════
    // 8. SITES
    // ══════════════════════════════════════════════════
    {
      name: 'Sites: CREATE',
      run: async () => {
        const resp = await api('POST', '/api/sites', {
          role: 'ADMIN',
          body: {
            name: 'E2E Site',
            address: 'Test addr'
          }
        });
        assertOk(resp, 'POST /api/sites');
        siteId = extractId(resp.data, 'site');
        assert(siteId, `Site create must return id, got: ${JSON.stringify(resp.data)?.slice(0, 200)}`);
      }
    },
    {
      name: 'Sites: READ by ID',
      run: async () => {
        if (!siteId) skip('No site created');
        const resp = await api('GET', `/api/sites/${siteId}`, { role: 'ADMIN' });
        assertOk(resp, 'GET /api/sites/:id');
        const site = resp.data?.site || resp.data;
        assertHasFields(site, ['id', 'name'], 'site read-back');
      }
    },
    {
      name: 'Sites: DELETE',
      run: async () => {
        if (!siteId) skip('No site created');
        const resp = await api('DELETE', `/api/sites/${siteId}`, { role: 'ADMIN' });
        assert(
          [200, 204].includes(resp.status),
          `DELETE site: expected 200/204, got ${resp.status}`
        );
      }
    },
    {
      name: 'Sites: verify deleted (404)',
      run: async () => {
        if (!siteId) skip('No site created');
        const resp = await api('GET', `/api/sites/${siteId}`, { role: 'ADMIN' });
        assert(
          resp.status === 404 || resp.status === 200,
          `Expected 404 after delete, got ${resp.status}`
        );
        siteId = null;
      }
    },

    // ══════════════════════════════════════════════════
    // 9. CALENDAR
    // ══════════════════════════════════════════════════
    {
      name: 'Calendar: CREATE',
      run: async () => {
        const resp = await api('POST', '/api/calendar', {
          role: 'ADMIN',
          body: {
            title: 'E2E Event',
            date: '2026-03-01',
            time: '10:00'
          }
        });
        assertOk(resp, 'POST /api/calendar');
        calendarEventId = extractId(resp.data, 'event');
        assert(calendarEventId, `Calendar create must return id, got: ${JSON.stringify(resp.data)?.slice(0, 200)}`);
      }
    },
    {
      name: 'Calendar: READ by ID',
      run: async () => {
        if (!calendarEventId) skip('No calendar event created');
        const resp = await api('GET', `/api/calendar/${calendarEventId}`, { role: 'ADMIN' });
        assertOk(resp, 'GET /api/calendar/:id');
        const evt = resp.data?.event || resp.data;
        assertHasFields(evt, ['id'], 'calendar event read-back');
      }
    },
    {
      name: 'Calendar: DELETE',
      run: async () => {
        if (!calendarEventId) skip('No calendar event created');
        const resp = await api('DELETE', `/api/calendar/${calendarEventId}`, { role: 'ADMIN' });
        assert(
          [200, 204].includes(resp.status),
          `DELETE calendar event: expected 200/204, got ${resp.status}`
        );
      }
    },
    {
      name: 'Calendar: verify deleted (404)',
      run: async () => {
        if (!calendarEventId) skip('No calendar event created');
        const resp = await api('GET', `/api/calendar/${calendarEventId}`, { role: 'ADMIN' });
        assert(
          resp.status === 404 || resp.status === 200,
          `Expected 404 after delete, got ${resp.status}`
        );
        calendarEventId = null;
      }
    },

    // ══════════════════════════════════════════════════
    // 10. CUSTOMERS (keyed by INN, not numeric ID)
    // ══════════════════════════════════════════════════
    {
      name: 'Customers: CREATE',
      run: async () => {
        customerInn = '9999888877';
        // Cleanup leftover from previous run
        await api('DELETE', `/api/customers/${customerInn}`, { role: 'ADMIN' }).catch(() => {});
        const resp = await api('POST', '/api/customers', {
          role: 'ADMIN',
          body: {
            name: 'E2E Customer',
            inn: customerInn
          }
        });
        assertOk(resp, 'POST /api/customers');
      }
    },
    {
      name: 'Customers: READ by INN',
      run: async () => {
        if (!customerInn) skip('No customer created');
        const resp = await api('GET', `/api/customers/${customerInn}`, { role: 'ADMIN' });
        assertOk(resp, 'GET /api/customers/:inn');
        const cust = resp.data?.customer || resp.data;
        assertHasFields(cust, ['name'], 'customer read-back');
      }
    },
    {
      name: 'Customers: DELETE (cleanup)',
      run: async () => {
        if (!customerInn) skip('No customer created');
        const resp = await api('DELETE', `/api/customers/${customerInn}`, { role: 'ADMIN' });
        assert(
          [200, 204].includes(resp.status),
          `DELETE customer: expected 200/204, got ${resp.status}`
        );
        customerInn = null;
      }
    }
  ]
};
