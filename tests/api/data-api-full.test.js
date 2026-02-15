/**
 * DATA API FULL — Universal CRUD /api/data/:table
 * ~40 tests covering read, count, role-based access, negatives, and CRUD cycles
 */
const { api, assert, assertOk, assertForbidden, assertHasFields, assertArray, skip, ROLES } = require('../config');

// ── Shared state for CRUD cycle tests ──
let createdReminderId = null;
let createdCalendarEventId = null;
let createdChatMessageId = null;

// ── Helper: extract list from data API response ──
function extractList(resp, table) {
  if (Array.isArray(resp.data)) return resp.data;
  if (resp.data && typeof resp.data === 'object') {
    return resp.data[table] || resp.data.data || resp.data.items || [];
  }
  return [];
}

// ── Helper: extract count from count endpoint response ──
function extractCount(resp) {
  if (resp.data && resp.data.count !== undefined) return resp.data.count;
  if (typeof resp.data === 'number') return resp.data;
  return null;
}

module.exports = {
  name: 'DATA API FULL (Universal CRUD)',
  tests: [
    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 1: ADMIN reads 20 key tables + count verification
    // ═══════════════════════════════════════════════════════════════════════

    {
      name: 'ADMIN reads tenders via /api/data/tenders',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/tenders');
        const list = extractList(resp, 'tenders');
        assertArray(list, 'data/tenders list');
        const countResp = await api('GET', '/api/data/tenders/count', { role: 'ADMIN' });
        assertOk(countResp, 'tenders count');
        const count = extractCount(countResp);
        assert(count !== null && (typeof count === 'number' || typeof count === 'string'), 'tenders count should be numeric');
      }
    },

    {
      name: 'ADMIN reads works via /api/data/works',
      run: async () => {
        const resp = await api('GET', '/api/data/works?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/works');
        const list = extractList(resp, 'works');
        assertArray(list, 'data/works list');
        const countResp = await api('GET', '/api/data/works/count', { role: 'ADMIN' });
        assertOk(countResp, 'works count');
      }
    },

    {
      name: 'ADMIN reads estimates via /api/data/estimates',
      run: async () => {
        const resp = await api('GET', '/api/data/estimates?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/estimates');
        const list = extractList(resp, 'estimates');
        assertArray(list, 'data/estimates list');
        const countResp = await api('GET', '/api/data/estimates/count', { role: 'ADMIN' });
        assertOk(countResp, 'estimates count');
      }
    },

    {
      name: 'ADMIN reads work_expenses via /api/data/work_expenses',
      run: async () => {
        const resp = await api('GET', '/api/data/work_expenses?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/work_expenses');
        const list = extractList(resp, 'work_expenses');
        assertArray(list, 'data/work_expenses list');
        const countResp = await api('GET', '/api/data/work_expenses/count', { role: 'ADMIN' });
        assertOk(countResp, 'work_expenses count');
      }
    },

    {
      name: 'ADMIN reads office_expenses via /api/data/office_expenses',
      run: async () => {
        const resp = await api('GET', '/api/data/office_expenses?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/office_expenses');
        const list = extractList(resp, 'office_expenses');
        assertArray(list, 'data/office_expenses list');
        const countResp = await api('GET', '/api/data/office_expenses/count', { role: 'ADMIN' });
        assertOk(countResp, 'office_expenses count');
      }
    },

    {
      name: 'ADMIN reads invoices via /api/data/invoices',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/invoices');
        const list = extractList(resp, 'invoices');
        assertArray(list, 'data/invoices list');
        const countResp = await api('GET', '/api/data/invoices/count', { role: 'ADMIN' });
        assertOk(countResp, 'invoices count');
      }
    },

    {
      name: 'ADMIN reads invoice_payments via /api/data/invoice_payments',
      run: async () => {
        const resp = await api('GET', '/api/data/invoice_payments?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/invoice_payments');
        const list = extractList(resp, 'invoice_payments');
        assertArray(list, 'data/invoice_payments list');
        const countResp = await api('GET', '/api/data/invoice_payments/count', { role: 'ADMIN' });
        assertOk(countResp, 'invoice_payments count');
      }
    },

    {
      name: 'ADMIN reads acts via /api/data/acts',
      run: async () => {
        const resp = await api('GET', '/api/data/acts?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/acts');
        const list = extractList(resp, 'acts');
        assertArray(list, 'data/acts list');
        const countResp = await api('GET', '/api/data/acts/count', { role: 'ADMIN' });
        assertOk(countResp, 'acts count');
      }
    },

    {
      name: 'ADMIN reads customers via /api/data/customers',
      run: async () => {
        const resp = await api('GET', '/api/data/customers?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/customers');
        const list = extractList(resp, 'customers');
        assertArray(list, 'data/customers list');
        const countResp = await api('GET', '/api/data/customers/count', { role: 'ADMIN' });
        assertOk(countResp, 'customers count');
      }
    },

    {
      name: 'ADMIN reads employees via /api/data/employees',
      run: async () => {
        const resp = await api('GET', '/api/data/employees?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/employees');
        const list = extractList(resp, 'employees');
        assertArray(list, 'data/employees list');
        const countResp = await api('GET', '/api/data/employees/count', { role: 'ADMIN' });
        assertOk(countResp, 'employees count');
      }
    },

    {
      name: 'ADMIN reads equipment via /api/data/equipment',
      run: async () => {
        const resp = await api('GET', '/api/data/equipment?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/equipment');
        const list = extractList(resp, 'equipment');
        assertArray(list, 'data/equipment list');
        const countResp = await api('GET', '/api/data/equipment/count', { role: 'ADMIN' });
        assertOk(countResp, 'equipment count');
      }
    },

    {
      name: 'ADMIN reads warehouses via /api/data/warehouses',
      run: async () => {
        const resp = await api('GET', '/api/data/warehouses?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/warehouses');
        const list = extractList(resp, 'warehouses');
        assertArray(list, 'data/warehouses list');
        const countResp = await api('GET', '/api/data/warehouses/count', { role: 'ADMIN' });
        assertOk(countResp, 'warehouses count');
      }
    },

    {
      name: 'ADMIN reads users via /api/data/users',
      run: async () => {
        const resp = await api('GET', '/api/data/users?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/users');
        const list = extractList(resp, 'users');
        assertArray(list, 'data/users list');
        const countResp = await api('GET', '/api/data/users/count', { role: 'ADMIN' });
        assertOk(countResp, 'users count');
      }
    },

    {
      name: 'ADMIN reads notifications via /api/data/notifications',
      run: async () => {
        const resp = await api('GET', '/api/data/notifications?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/notifications');
        const list = extractList(resp, 'notifications');
        assertArray(list, 'data/notifications list');
        const countResp = await api('GET', '/api/data/notifications/count', { role: 'ADMIN' });
        assertOk(countResp, 'notifications count');
      }
    },

    {
      name: 'ADMIN reads audit_log via /api/data/audit_log',
      run: async () => {
        const resp = await api('GET', '/api/data/audit_log?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/audit_log');
        const list = extractList(resp, 'audit_log');
        assertArray(list, 'data/audit_log list');
        const countResp = await api('GET', '/api/data/audit_log/count', { role: 'ADMIN' });
        assertOk(countResp, 'audit_log count');
      }
    },

    {
      name: 'ADMIN reads calendar_events via /api/data/calendar_events',
      run: async () => {
        const resp = await api('GET', '/api/data/calendar_events?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/calendar_events');
        const list = extractList(resp, 'calendar_events');
        assertArray(list, 'data/calendar_events list');
        const countResp = await api('GET', '/api/data/calendar_events/count', { role: 'ADMIN' });
        assertOk(countResp, 'calendar_events count');
      }
    },

    {
      name: 'ADMIN reads reminders via /api/data/reminders',
      run: async () => {
        const resp = await api('GET', '/api/data/reminders?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/reminders');
        const list = extractList(resp, 'reminders');
        assertArray(list, 'data/reminders list');
        const countResp = await api('GET', '/api/data/reminders/count', { role: 'ADMIN' });
        assertOk(countResp, 'reminders count');
      }
    },

    {
      name: 'ADMIN reads chats via /api/data/chats',
      run: async () => {
        const resp = await api('GET', '/api/data/chats?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/chats');
        const list = extractList(resp, 'chats');
        assertArray(list, 'data/chats list');
        const countResp = await api('GET', '/api/data/chats/count', { role: 'ADMIN' });
        assertOk(countResp, 'chats count');
      }
    },

    {
      name: 'ADMIN reads cash_requests via /api/data/cash_requests',
      run: async () => {
        const resp = await api('GET', '/api/data/cash_requests?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/cash_requests');
        const list = extractList(resp, 'cash_requests');
        assertArray(list, 'data/cash_requests list');
        const countResp = await api('GET', '/api/data/cash_requests/count', { role: 'ADMIN' });
        assertOk(countResp, 'cash_requests count');
      }
    },

    {
      name: 'ADMIN reads payroll_sheets via /api/data/payroll_sheets',
      run: async () => {
        const resp = await api('GET', '/api/data/payroll_sheets?limit=3', { role: 'ADMIN' });
        assertOk(resp, 'data/payroll_sheets');
        const list = extractList(resp, 'payroll_sheets');
        assertArray(list, 'data/payroll_sheets list');
        const countResp = await api('GET', '/api/data/payroll_sheets/count', { role: 'ADMIN' });
        assertOk(countResp, 'payroll_sheets count');
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 2: Role-based access (5 tests)
    // ═══════════════════════════════════════════════════════════════════════

    {
      name: 'PM reads tenders via /api/data/tenders (role-based)',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=3', { role: 'PM' });
        assertOk(resp, 'PM data/tenders');
        const list = extractList(resp, 'tenders');
        assertArray(list, 'PM tenders list');
        // Verify response envelope has expected shape
        if (resp.data && typeof resp.data === 'object' && !Array.isArray(resp.data)) {
          assert(resp.data.total !== undefined || resp.data.tenders !== undefined,
            'PM tenders response should have total or tenders key');
        }
      }
    },

    {
      name: 'TO reads estimates via /api/data/estimates (role-based)',
      run: async () => {
        const resp = await api('GET', '/api/data/estimates?limit=3', { role: 'TO' });
        assertOk(resp, 'TO data/estimates');
        const list = extractList(resp, 'estimates');
        assertArray(list, 'TO estimates list');
      }
    },

    {
      name: 'BUH reads invoices via /api/data/invoices (role-based)',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices?limit=3', { role: 'BUH' });
        assertOk(resp, 'BUH data/invoices');
        const list = extractList(resp, 'invoices');
        assertArray(list, 'BUH invoices list');
      }
    },

    {
      name: 'HR reads employees via /api/data/employees (role-based)',
      run: async () => {
        const resp = await api('GET', '/api/data/employees?limit=3', { role: 'HR' });
        assertOk(resp, 'HR data/employees');
        const list = extractList(resp, 'employees');
        assertArray(list, 'HR employees list');
      }
    },

    {
      name: 'WAREHOUSE reads equipment via /api/data/equipment (role-based)',
      run: async () => {
        const resp = await api('GET', '/api/data/equipment?limit=3', { role: 'WAREHOUSE' });
        assertOk(resp, 'WAREHOUSE data/equipment');
        const list = extractList(resp, 'equipment');
        assertArray(list, 'WAREHOUSE equipment list');
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 3: Negative tests (5 tests)
    // ═══════════════════════════════════════════════════════════════════════

    {
      name: 'NEGATIVE: Non-whitelisted table returns 400/403',
      run: async () => {
        const resp = await api('GET', '/api/data/nonexistent_fake_table', { role: 'ADMIN' });
        assert(
          resp.status === 400 || resp.status === 403,
          `Non-whitelisted table: expected 400 or 403, got ${resp.status}`
        );
      }
    },

    {
      name: 'NEGATIVE: WAREHOUSE cannot delete via data API',
      run: async () => {
        // WAREHOUSE ops are [read, create, update] — no delete
        const resp = await api('DELETE', '/api/data/equipment/999999', { role: 'WAREHOUSE' });
        assertForbidden(resp, 'WAREHOUSE delete equipment');
      }
    },

    {
      name: 'NEGATIVE: PM cannot delete via data API',
      run: async () => {
        // PM ops are [read, create, update] — no delete
        const resp = await api('DELETE', '/api/data/tenders/999999', { role: 'PM' });
        assertForbidden(resp, 'PM delete tenders');
      }
    },

    {
      name: 'NEGATIVE: Empty table name returns 404',
      run: async () => {
        // /api/data/ with no table segment should not match any route
        const resp = await api('GET', '/api/data/', { role: 'ADMIN' });
        assert(
          resp.status === 404 || resp.status === 400,
          `Empty table name: expected 404 or 400, got ${resp.status}`
        );
      }
    },

    {
      name: 'NEGATIVE: SQL injection in table name returns 400/404 (or 200 if safely handled)',
      run: async () => {
        const resp = await api('GET', '/api/data/users;DROP%20TABLE%20users', { role: 'ADMIN' });
        // The /api/data/:table endpoint may allowlist tables or use parameterized queries,
        // so 200 is acceptable if the injection is neutralized
        assert(
          [200, 400, 404].includes(resp.status),
          `SQL injection table: expected 200/400/404, got ${resp.status}`
        );
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 4: CRUD cycle tests (3 tables)
    // ═══════════════════════════════════════════════════════════════════════

    // ── 4a. Reminders CRUD cycle ──

    {
      name: 'CRUD cycle: create reminder via POST /api/data/reminders',
      run: async () => {
        const ts = Date.now();
        const body = {
          title: 'E2E Test Reminder ' + ts,
          description: 'Auto-created by data-api-full test',
          remind_at: new Date(Date.now() + 86400000).toISOString()
        };
        const resp = await api('POST', '/api/data/reminders', { role: 'ADMIN', body });
        assertOk(resp, 'create reminder');
        const item = resp.data?.item || resp.data;
        assert(item && item.id, 'created reminder should have id');
        createdReminderId = item.id;
      }
    },

    {
      name: 'CRUD cycle: read back reminder by ID',
      run: async () => {
        if (!createdReminderId) skip('No reminder created');
        const resp = await api('GET', `/api/data/reminders/${createdReminderId}`, { role: 'ADMIN' });
        assertOk(resp, 'read reminder by ID');
        const item = resp.data?.item || resp.data;
        assertHasFields(item, ['id', 'title'], 'reminder read-back');
        assert(item.id === createdReminderId, `reminder id mismatch: expected ${createdReminderId}, got ${item.id}`);
      }
    },

    {
      name: 'CRUD cycle: update reminder via PUT',
      run: async () => {
        if (!createdReminderId) skip('No reminder created');
        const resp = await api('PUT', `/api/data/reminders/${createdReminderId}`, {
          role: 'ADMIN',
          body: { title: 'E2E Reminder UPDATED ' + Date.now() }
        });
        assertOk(resp, 'update reminder');
        const item = resp.data?.item || resp.data;
        assert(item && (item.id || item.success), 'update should return item or success');
      }
    },

    {
      name: 'CRUD cycle: delete reminder via DELETE',
      run: async () => {
        if (!createdReminderId) skip('No reminder created');
        const resp = await api('DELETE', `/api/data/reminders/${createdReminderId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete reminder');
        assert(resp.data?.success || resp.data?.deleted, 'delete should return success/deleted');
        // Confirm deletion — read-back should 404
        const readBack = await api('GET', `/api/data/reminders/${createdReminderId}`, { role: 'ADMIN' });
        assert(readBack.status === 404, `deleted reminder should 404, got ${readBack.status}`);
        createdReminderId = null;
      }
    },

    // ── 4b. Calendar Events CRUD cycle ──

    {
      name: 'CRUD cycle: create calendar_event via POST',
      run: async () => {
        const ts = Date.now();
        const startDate = new Date(Date.now() + 86400000).toISOString();
        const endDate = new Date(Date.now() + 90000000).toISOString();
        const body = {
          title: 'E2E Calendar Event ' + ts,
          description: 'Auto-created by data-api-full test',
          start_date: startDate,
          end_date: endDate,
          event_type: 'meeting'
        };
        const resp = await api('POST', '/api/data/calendar_events', { role: 'ADMIN', body });
        assertOk(resp, 'create calendar_event');
        const item = resp.data?.item || resp.data;
        assert(item && item.id, 'created calendar_event should have id');
        createdCalendarEventId = item.id;
      }
    },

    {
      name: 'CRUD cycle: read back calendar_event by ID',
      run: async () => {
        if (!createdCalendarEventId) skip('No calendar_event created');
        const resp = await api('GET', `/api/data/calendar_events/${createdCalendarEventId}`, { role: 'ADMIN' });
        assertOk(resp, 'read calendar_event by ID');
        const item = resp.data?.item || resp.data;
        assertHasFields(item, ['id', 'title'], 'calendar_event read-back');
        assert(item.id === createdCalendarEventId, `calendar_event id mismatch`);
      }
    },

    {
      name: 'CRUD cycle: update calendar_event via PUT',
      run: async () => {
        if (!createdCalendarEventId) skip('No calendar_event created');
        const resp = await api('PUT', `/api/data/calendar_events/${createdCalendarEventId}`, {
          role: 'ADMIN',
          body: { title: 'E2E Calendar UPDATED ' + Date.now() }
        });
        assertOk(resp, 'update calendar_event');
        const item = resp.data?.item || resp.data;
        assert(item && (item.id || item.success), 'update should return item or success');
      }
    },

    {
      name: 'CRUD cycle: delete calendar_event via DELETE',
      run: async () => {
        if (!createdCalendarEventId) skip('No calendar_event created');
        const resp = await api('DELETE', `/api/data/calendar_events/${createdCalendarEventId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete calendar_event');
        assert(resp.data?.success || resp.data?.deleted, 'delete should return success/deleted');
        const readBack = await api('GET', `/api/data/calendar_events/${createdCalendarEventId}`, { role: 'ADMIN' });
        assert(readBack.status === 404, `deleted calendar_event should 404, got ${readBack.status}`);
        createdCalendarEventId = null;
      }
    },

    // ── 4c. Chat Messages CRUD cycle ──

    {
      name: 'CRUD cycle: create chat_message via POST',
      run: async () => {
        // First, find or create a chat to attach the message to
        const chatsResp = await api('GET', '/api/data/chats?limit=1', { role: 'ADMIN' });
        assertOk(chatsResp, 'get chats for FK');
        const chats = extractList(chatsResp, 'chats');
        let chatId = chats.length > 0 ? chats[0].id : null;

        if (!chatId) {
          // Create a chat first
          const chatBody = { name: 'E2E Test Chat ' + Date.now(), type: 'group' };
          const chatCreateResp = await api('POST', '/api/data/chats', { role: 'ADMIN', body: chatBody });
          if (chatCreateResp.ok) {
            const createdChat = chatCreateResp.data?.item || chatCreateResp.data;
            chatId = createdChat?.id;
          }
        }

        if (!chatId) skip('No chat available for FK reference');

        const ts = Date.now();
        const body = {
          chat_id: chatId,
          message: 'E2E test message ' + ts,
          message_type: 'text'
        };
        const resp = await api('POST', '/api/data/chat_messages', { role: 'ADMIN', body });
        assertOk(resp, 'create chat_message');
        const item = resp.data?.item || resp.data;
        assert(item && item.id, 'created chat_message should have id');
        createdChatMessageId = item.id;
      }
    },

    {
      name: 'CRUD cycle: read back chat_message by ID',
      run: async () => {
        if (!createdChatMessageId) skip('No chat_message created');
        const resp = await api('GET', `/api/data/chat_messages/${createdChatMessageId}`, { role: 'ADMIN' });
        assertOk(resp, 'read chat_message by ID');
        const item = resp.data?.item || resp.data;
        assertHasFields(item, ['id'], 'chat_message read-back');
        assert(item.id === createdChatMessageId, `chat_message id mismatch`);
      }
    },

    {
      name: 'CRUD cycle: update chat_message via PUT',
      run: async () => {
        if (!createdChatMessageId) skip('No chat_message created');
        const resp = await api('PUT', `/api/data/chat_messages/${createdChatMessageId}`, {
          role: 'ADMIN',
          body: { message: 'E2E message UPDATED ' + Date.now() }
        });
        assertOk(resp, 'update chat_message');
        const item = resp.data?.item || resp.data;
        assert(item && (item.id || item.success), 'update should return item or success');
      }
    },

    {
      name: 'CRUD cycle: delete chat_message via DELETE',
      run: async () => {
        if (!createdChatMessageId) skip('No chat_message created');
        const resp = await api('DELETE', `/api/data/chat_messages/${createdChatMessageId}`, { role: 'ADMIN' });
        assertOk(resp, 'delete chat_message');
        assert(resp.data?.success || resp.data?.deleted, 'delete should return success/deleted');
        const readBack = await api('GET', `/api/data/chat_messages/${createdChatMessageId}`, { role: 'ADMIN' });
        assert(readBack.status === 404, `deleted chat_message should 404, got ${readBack.status}`);
        createdChatMessageId = null;
      }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 5: Standalone count tests (5 tables)
    // ═══════════════════════════════════════════════════════════════════════

    {
      name: 'Count: employees returns numeric count',
      run: async () => {
        const resp = await api('GET', '/api/data/employees/count', { role: 'ADMIN' });
        assertOk(resp, 'employees count');
        const count = extractCount(resp);
        assert(count !== null, 'employees count should not be null');
        assert(typeof count === 'number' || !isNaN(parseInt(count)), 'employees count should be numeric');
        assert(parseInt(count) >= 0, 'employees count should be >= 0');
      }
    },

    {
      name: 'Count: equipment returns numeric count',
      run: async () => {
        const resp = await api('GET', '/api/data/equipment/count', { role: 'ADMIN' });
        assertOk(resp, 'equipment count');
        const count = extractCount(resp);
        assert(count !== null, 'equipment count should not be null');
        assert(parseInt(count) >= 0, 'equipment count should be >= 0');
      }
    },

    {
      name: 'Count: invoices returns numeric count',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices/count', { role: 'ADMIN' });
        assertOk(resp, 'invoices count');
        const count = extractCount(resp);
        assert(count !== null, 'invoices count should not be null');
        assert(parseInt(count) >= 0, 'invoices count should be >= 0');
      }
    },

    {
      name: 'Count: notifications returns numeric count',
      run: async () => {
        const resp = await api('GET', '/api/data/notifications/count', { role: 'ADMIN' });
        assertOk(resp, 'notifications count');
        const count = extractCount(resp);
        assert(count !== null, 'notifications count should not be null');
        assert(parseInt(count) >= 0, 'notifications count should be >= 0');
      }
    },

    {
      name: 'Count: chat_messages returns numeric count',
      run: async () => {
        const resp = await api('GET', '/api/data/chat_messages/count', { role: 'ADMIN' });
        assertOk(resp, 'chat_messages count');
        const count = extractCount(resp);
        assert(count !== null, 'chat_messages count should not be null');
        assert(parseInt(count) >= 0, 'chat_messages count should be >= 0');
      }
    }
  ]
};
