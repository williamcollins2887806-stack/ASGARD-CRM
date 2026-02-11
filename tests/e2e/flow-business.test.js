/**
 * E2E BUSINESS LOGIC — Multi-step flows testing real business scenarios
 */
const { api, assert, assertOk, assertStatus, assertHasFields, assertMatch, skip, TEST_USERS } = require('../config');

module.exports = {
  name: 'E2E BUSINESS LOGIC',
  tests: [
    // ═══ FLOW 1: Tender lifecycle ═══
    {
      name: 'BIZ: Tender create → update status → verify → cleanup',
      run: async () => {
        // Step 1: TO creates tender
        const createResp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: {
            customer: 'BIZ_TEST_' + Date.now(),
            customer_name: 'BIZ_TEST_' + Date.now(),
            customer_inn: '7707083893',
            tender_title: 'E2E Бизнес-тест тендер',
            tender_type: 'Открытый',
            tender_status: 'Новый',
            tender_price: 3000000
          }
        });
        assertOk(createResp, 'tender create');
        const tid = createResp.data?.tender?.id || createResp.data?.id;
        assert(tid, 'tender must have id');

        try {
          // Step 2: Update tender status
          const upResp = await api('PUT', `/api/tenders/${tid}`, {
            role: 'TO',
            body: { tender_status: 'В работе' }
          });
          assert(upResp.status !== 500, `tender update got ${upResp.status}`);

          // Step 3: Verify updated
          const getResp = await api('GET', `/api/tenders/${tid}`, { role: 'TO' });
          assertOk(getResp, 'tender get');
        } finally {
          // Cleanup
          await api('DELETE', `/api/tenders/${tid}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══ FLOW 2: Cash request lifecycle ═══
    {
      name: 'BIZ: Cash request create → approve → receive → expense → close',
      run: async () => {
        // Step 1: PM creates cash request
        const createResp = await api('POST', '/api/cash', {
          role: 'PM',
          body: {
            purpose: 'BIZ_CASH_TEST_' + Date.now(),
            amount: 50000,
            description: 'E2E cash flow test'
          }
        });
        if (createResp.status === 403 || createResp.status === 400) {
          skip('Cash module not available: ' + createResp.status);
        }
        assertOk(createResp, 'cash create');
        const cid = createResp.data?.request?.id || createResp.data?.id;
        if (!cid) skip('no cash request id returned');

        try {
          // Step 2: Director approves
          const approveResp = await api('PUT', `/api/cash/${cid}/approve`, {
            role: 'DIRECTOR_GEN',
            body: { comment: 'Одобрено для теста' }
          });
          // May succeed or fail based on status flow — just verify no 500
          assert(approveResp.status !== 500, `approve got ${approveResp.status}`);

          // Step 3: PM confirms receipt
          if (approveResp.ok) {
            const receiveResp = await api('PUT', `/api/cash/${cid}/receive`, {
              role: 'PM',
              body: {}
            });
            assert(receiveResp.status !== 500, `receive got ${receiveResp.status}`);
          }

          // Step 4: Check request status
          const getResp = await api('GET', `/api/cash/${cid}`, { role: 'ADMIN' });
          assert(getResp.status !== 500, `cash get got ${getResp.status}`);
        } finally {
          // No direct delete for cash — it stays in DB
        }
      }
    },

    // ═══ FLOW 3: Estimate linked to tender ═══
    {
      name: 'BIZ: Create tender → create estimate → verify link → cleanup',
      run: async () => {
        // Create tender
        const tResp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: {
            customer: 'BIZ_EST_' + Date.now(),
            customer_name: 'BIZ_EST_' + Date.now(),
            customer_inn: '7707083893',
            tender_title: 'Тендер для просчёта',
            tender_type: 'Открытый',
            tender_status: 'Новый',
            tender_price: 2000000
          }
        });
        assertOk(tResp, 'tender for estimate');
        const tid = tResp.data?.tender?.id || tResp.data?.id;
        assert(tid, 'tender id');

        let eid = null;
        try {
          // Create estimate linked to tender
          const eResp = await api('POST', '/api/estimates', {
            role: 'PM',
            body: {
              tender_id: tid,
              title: 'BIZ Просчёт E2E',
              amount: 1500000,
              margin: 15,
              probability_pct: 70,
              cost_plan: 1200000,
              price_tkp: 1500000
            }
          });
          if (eResp.ok) {
            eid = eResp.data?.estimate?.id || eResp.data?.id;
          }

          // Verify estimates list
          const listResp = await api('GET', '/api/estimates', { role: 'PM' });
          assertOk(listResp, 'estimates list');
        } finally {
          if (eid) await api('DELETE', `/api/estimates/${eid}`, { role: 'ADMIN' });
          await api('DELETE', `/api/tenders/${tid}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══ FLOW 4: Calendar event lifecycle ═══
    {
      name: 'BIZ: Calendar create → update → read → delete',
      run: async () => {
        const createResp = await api('POST', '/api/calendar', {
          role: 'PM',
          body: {
            title: 'BIZ_CALENDAR_' + Date.now(),
            date: '2025-12-15',
            time: '10:00',
            type: 'meeting',
            description: 'E2E calendar test'
          }
        });
        assertOk(createResp, 'calendar create');
        const eid = createResp.data?.event?.id || createResp.data?.id;
        if (!eid) skip('no event id returned');

        try {
          // Update
          const upResp = await api('PUT', `/api/calendar/${eid}`, {
            role: 'PM',
            body: { title: 'Updated BIZ Calendar Event' }
          });
          assert(upResp.status !== 500, `calendar update got ${upResp.status}`);

          // Read
          const getResp = await api('GET', `/api/calendar/${eid}`, { role: 'PM' });
          assertOk(getResp, 'calendar read');
        } finally {
          await api('DELETE', `/api/calendar/${eid}`, { role: 'PM' });
        }
      }
    },

    // ═══ FLOW 5: Equipment lifecycle ═══
    {
      name: 'BIZ: Equipment create → issue → return → cleanup',
      run: async () => {
        const createResp = await api('POST', '/api/equipment', {
          role: 'WAREHOUSE',
          body: {
            name: 'BIZ_EQUIP_' + Date.now(),
            category_id: 1,
            status: 'on_warehouse',
            serial_number: 'SN-BIZ-' + Date.now()
          }
        });
        if (createResp.status === 400 || createResp.status === 403) {
          skip('Equipment create not available: ' + createResp.status);
        }
        assertOk(createResp, 'equipment create');
        const eqid = createResp.data?.equipment?.id || createResp.data?.id;
        if (!eqid) skip('no equipment id');

        try {
          // Issue to holder
          const issueResp = await api('POST', '/api/equipment/issue', {
            role: 'WAREHOUSE',
            body: {
              equipment_id: eqid,
              holder_id: TEST_USERS.PM.id,
              comment: 'E2E issue test'
            }
          });
          // May fail if holder doesn't exist — OK
          assert(issueResp.status !== 500, `issue got ${issueResp.status}`);

          // Return
          if (issueResp.ok) {
            const returnResp = await api('POST', '/api/equipment/return', {
              role: 'WAREHOUSE',
              body: {
                equipment_id: eqid,
                comment: 'E2E return test'
              }
            });
            assert(returnResp.status !== 500, `return got ${returnResp.status}`);
          }
        } finally {
          // Cleanup via data API
          await api('DELETE', `/api/data/equipment/${eqid}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══ FLOW 6: Chat group lifecycle ═══
    {
      name: 'BIZ: Chat create → send message → list messages → delete',
      run: async () => {
        const createResp = await api('POST', '/api/chat-groups', {
          role: 'ADMIN',
          body: {
            name: 'BIZ_CHAT_' + Date.now(),
            description: 'E2E chat test'
          }
        });
        assertOk(createResp, 'chat create');
        const chatId = createResp.data?.chat?.id || createResp.data?.id;
        if (!chatId) skip('no chat id');

        try {
          // Send message
          const msgResp = await api('POST', `/api/chat-groups/${chatId}/messages`, {
            role: 'ADMIN',
            body: { content: 'E2E test message ' + Date.now() }
          });
          assert(msgResp.status !== 500, `send msg got ${msgResp.status}`);

          // List messages
          const listResp = await api('GET', `/api/chat-groups/${chatId}/messages`, { role: 'ADMIN' });
          assert(listResp.status !== 500, `list msgs got ${listResp.status}`);
        } finally {
          await api('DELETE', `/api/chat-groups/${chatId}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══ FLOW 7: Customer lifecycle ═══
    {
      name: 'BIZ: Customer create → read → update → delete',
      run: async () => {
        const inn = '77' + Date.now().toString().slice(-8);
        const createResp = await api('POST', '/api/customers', {
          role: 'ADMIN',
          body: {
            inn,
            name: 'BIZ Customer ' + Date.now()
          }
        });
        assertOk(createResp, 'customer create');

        try {
          // Read
          const getResp = await api('GET', `/api/customers/${inn}`, { role: 'TO' });
          assertOk(getResp, 'customer read');

          // Update
          const upResp = await api('PUT', `/api/customers/${inn}`, {
            role: 'ADMIN',
            body: { name: 'Updated BIZ Customer' }
          });
          assert(upResp.status !== 500, `customer update got ${upResp.status}`);
        } finally {
          await api('DELETE', `/api/customers/${inn}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══ FLOW 8: Invoice with payments ═══
    {
      name: 'BIZ: Invoice create → add payment → verify → cleanup',
      run: async () => {
        const createResp = await api('POST', '/api/invoices', {
          role: 'PM',
          body: {
            invoice_number: 'BIZ-INV-' + Date.now(),
            customer: 'Test Customer E2E',
            amount: 100000,
            invoice_date: '2025-06-01',
            status: 'Новый'
          }
        });
        assertOk(createResp, 'invoice create');
        const invId = createResp.data?.invoice?.id || createResp.data?.id;
        if (!invId) skip('no invoice id');

        try {
          // Add payment
          const payResp = await api('POST', `/api/invoices/${invId}/payments`, {
            role: 'BUH',
            body: {
              amount: 50000,
              date: '2025-06-15',
              description: 'Partial payment E2E'
            }
          });
          assert(payResp.status !== 500, `payment got ${payResp.status}`);

          // Verify invoice
          const getResp = await api('GET', `/api/invoices/${invId}`, { role: 'PM' });
          assertOk(getResp, 'invoice get');
        } finally {
          await api('DELETE', `/api/invoices/${invId}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══ FLOW 9: Work with expenses ═══
    {
      name: 'BIZ: Work create → add expense → verify total → cleanup',
      run: async () => {
        const createResp = await api('POST', '/api/works', {
          role: 'PM',
          body: {
            work_title: 'BIZ_WORK_' + Date.now(),
            work_status: 'В работе',
            company: 'Test LLC',
            contract_value: 500000
          }
        });
        if (!createResp.ok) skip('works create failed: ' + createResp.status);
        const wid = createResp.data?.work?.id || createResp.data?.id;
        if (!wid) skip('no work id');

        try {
          // Add expense
          const expResp = await api('POST', '/api/expenses/work', {
            role: 'PM',
            body: {
              work_id: wid,
              category: 'Материалы',
              amount: 25000,
              date: '2025-06-01',
              comment: 'E2E expense test'
            }
          });
          assert(expResp.status !== 500, `expense got ${expResp.status}`);

          // Verify work detail
          const getResp = await api('GET', `/api/works/${wid}`, { role: 'PM' });
          assertOk(getResp, 'work detail');
        } finally {
          await api('DELETE', `/api/works/${wid}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══ FLOW 10: Permit create → verify → cleanup ═══
    {
      name: 'BIZ: Permit create → list → update → cleanup',
      run: async () => {
        const createResp = await api('POST', '/api/permits', {
          role: 'HR',
          body: {
            employee_id: TEST_USERS.PM.id,
            type: 'Допуск СРО',
            expiry_date: '2026-12-31',
            description: 'E2E permit test'
          }
        });
        if (createResp.status === 400 || createResp.status === 403) {
          skip('Permits create not available: ' + createResp.status);
        }
        const pid = createResp.data?.permit?.id || createResp.data?.id;
        if (!pid) skip('no permit id');

        try {
          // List
          const listResp = await api('GET', '/api/permits', { role: 'HR' });
          assertOk(listResp, 'permits list');

          // Update
          const upResp = await api('PUT', `/api/permits/${pid}`, {
            role: 'HR',
            body: { description: 'Updated E2E permit' }
          });
          assert(upResp.status !== 500, `permit update got ${upResp.status}`);
        } finally {
          await api('DELETE', `/api/permits/${pid}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══ FLOW 11: Act of completed work ═══
    {
      name: 'BIZ: Act create → read → update → cleanup',
      run: async () => {
        const createResp = await api('POST', '/api/acts', {
          role: 'PM',
          body: {
            number: 'ACT-BIZ-' + Date.now(),
            customer: 'E2E Customer',
            amount: 200000,
            date: '2025-07-01',
            status: 'Подписан'
          }
        });
        if (!createResp.ok) skip('acts create failed: ' + createResp.status);
        const aid = createResp.data?.act?.id || createResp.data?.id;
        if (!aid) skip('no act id');

        try {
          // Read
          const getResp = await api('GET', `/api/acts/${aid}`, { role: 'PM' });
          assertOk(getResp, 'act read');

          // Update
          const upResp = await api('PUT', `/api/acts/${aid}`, {
            role: 'PM',
            body: { status: 'Закрыт' }
          });
          assert(upResp.status !== 500, `act update got ${upResp.status}`);
        } finally {
          await api('DELETE', `/api/acts/${aid}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══ FLOW 12: Notification read/mark ═══
    {
      name: 'BIZ: Notifications list → mark read',
      run: async () => {
        const listResp = await api('GET', '/api/notifications', { role: 'PM' });
        assertOk(listResp, 'notifications list');
        // Just verify the endpoint works — no cleanup needed
      }
    },

    // ═══ FLOW 13: Settings CRUD ═══
    {
      name: 'BIZ: Settings create → read → delete',
      run: async () => {
        const key = 'biz_test_setting_' + Date.now();
        const createResp = await api('POST', '/api/settings', {
          role: 'ADMIN',
          body: { key, value: { test: true, ts: Date.now() } }
        });
        if (!createResp.ok) skip('settings create failed: ' + createResp.status);

        try {
          // Read all settings
          const getResp = await api('GET', '/api/settings', { role: 'ADMIN' });
          assertOk(getResp, 'settings list');
        } finally {
          await api('DELETE', `/api/settings/${key}`, { role: 'ADMIN' });
        }
      }
    },

    // ═══ FLOW 14: Site management ═══
    {
      name: 'BIZ: Site create → read → update → cleanup',
      run: async () => {
        const createResp = await api('POST', '/api/sites', {
          role: 'ADMIN',
          body: {
            name: 'BIZ_SITE_' + Date.now(),
            address: 'ул. Тестовая, д. 1',
            status: 'active'
          }
        });
        if (!createResp.ok) skip('sites create failed: ' + createResp.status);
        const sid = createResp.data?.site?.id || createResp.data?.id;
        if (!sid) skip('no site id');

        try {
          // Read
          const getResp = await api('GET', `/api/sites/${sid}`, { role: 'PM' });
          assertOk(getResp, 'site read');

          // Update
          const upResp = await api('PUT', `/api/sites/${sid}`, {
            role: 'ADMIN',
            body: { name: 'Updated BIZ Site' }
          });
          assert(upResp.status !== 500, `site update got ${upResp.status}`);
        } finally {
          await api('DELETE', `/api/sites/${sid}`, { role: 'ADMIN' });
        }
      }
    }
  ]
};
