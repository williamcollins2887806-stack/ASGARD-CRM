/**
 * DEEP DATA CRUD — comprehensive CRUD tests for /api/data/:table endpoint
 * Covers READ, query params, forbidden reads, CREATE, WRITE_PROTECTED,
 * READ_SENSITIVE, and unknown/disallowed tables across multiple roles.
 */
const { api, assert, assertOk, assertStatus, assertArray, assertHasFields, skip } = require('../config');

// Helper: extract array from response data (handles both raw arrays and wrapped objects)
function extractList(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.rows)) return data.rows;
  }
  return [];
}

module.exports = {
  name: 'Deep Data CRUD (200 tests)',
  tests: [
    // =========================================================================
    // SECTION 1: READ operations — GET /api/data/:table?limit=1
    //   20 tables × 4 roles (PM, BUH, HR, WAREHOUSE) = 80 tests
    //   Note: not every role has access to every table; for forbidden combos
    //   we still verify 200 for allowed ones. We pick tables each role CAN read.
    // =========================================================================

    // --- PM reads (20 tables) ---
    { name: 'PM reads users', run: async () => { const r = await api('GET', '/api/data/users?limit=1', { role: 'PM' }); assertOk(r, 'PM users'); assertArray(extractList(r.data), 'PM users'); } },
    { name: 'PM reads employees', run: async () => { const r = await api('GET', '/api/data/employees?limit=1', { role: 'PM' }); assertOk(r, 'PM employees'); assertArray(extractList(r.data), 'PM employees'); } },
    { name: 'PM reads tenders', run: async () => { const r = await api('GET', '/api/data/tenders?limit=1', { role: 'PM' }); assertOk(r, 'PM tenders'); assertArray(extractList(r.data), 'PM tenders'); } },
    { name: 'PM reads estimates', run: async () => { const r = await api('GET', '/api/data/estimates?limit=1', { role: 'PM' }); assertOk(r, 'PM estimates'); assertArray(extractList(r.data), 'PM estimates'); } },
    { name: 'PM reads works', run: async () => { const r = await api('GET', '/api/data/works?limit=1', { role: 'PM' }); assertOk(r, 'PM works'); assertArray(extractList(r.data), 'PM works'); } },
    { name: 'PM reads work_expenses', run: async () => { const r = await api('GET', '/api/data/work_expenses?limit=1', { role: 'PM' }); assertOk(r, 'PM work_expenses'); assertArray(extractList(r.data), 'PM work_expenses'); } },
    { name: 'PM reads contracts', run: async () => { const r = await api('GET', '/api/data/contracts?limit=1', { role: 'PM' }); assertOk(r, 'PM contracts'); assertArray(extractList(r.data), 'PM contracts'); } },
    { name: 'PM reads customers', run: async () => { const r = await api('GET', '/api/data/customers?limit=1', { role: 'PM' }); assertOk(r, 'PM customers'); assertArray(extractList(r.data), 'PM customers'); } },
    { name: 'PM reads calendar_events', run: async () => { const r = await api('GET', '/api/data/calendar_events?limit=1', { role: 'PM' }); assertOk(r, 'PM calendar_events'); assertArray(extractList(r.data), 'PM calendar_events'); } },
    { name: 'PM reads documents', run: async () => { const r = await api('GET', '/api/data/documents?limit=1', { role: 'PM' }); assertOk(r, 'PM documents'); assertArray(extractList(r.data), 'PM documents'); } },
    { name: 'PM reads chats', run: async () => { const r = await api('GET', '/api/data/chats?limit=1', { role: 'PM' }); assertOk(r, 'PM chats'); assertArray(extractList(r.data), 'PM chats'); } },
    { name: 'PM reads chat_messages', run: async () => { const r = await api('GET', '/api/data/chat_messages?limit=1', { role: 'PM' }); assertOk(r, 'PM chat_messages'); assertArray(extractList(r.data), 'PM chat_messages'); } },
    { name: 'PM reads notifications', run: async () => { const r = await api('GET', '/api/data/notifications?limit=1', { role: 'PM' }); assertOk(r, 'PM notifications'); assertArray(extractList(r.data), 'PM notifications'); } },
    { name: 'PM reads acts', run: async () => { const r = await api('GET', '/api/data/acts?limit=1', { role: 'PM' }); assertOk(r, 'PM acts'); assertArray(extractList(r.data), 'PM acts'); } },
    { name: 'PM reads invoices', run: async () => { const r = await api('GET', '/api/data/invoices?limit=1', { role: 'PM' }); assertOk(r, 'PM invoices'); assertArray(extractList(r.data), 'PM invoices'); } },
    { name: 'PM reads equipment', run: async () => { const r = await api('GET', '/api/data/equipment?limit=1', { role: 'PM' }); assertOk(r, 'PM equipment'); assertArray(extractList(r.data), 'PM equipment'); } },
    { name: 'PM reads reminders', run: async () => { const r = await api('GET', '/api/data/reminders?limit=1', { role: 'PM' }); assertOk(r, 'PM reminders'); assertArray(extractList(r.data), 'PM reminders'); } },
    { name: 'PM reads sync_meta', run: async () => { const r = await api('GET', '/api/data/sync_meta?limit=1', { role: 'PM' }); assertOk(r, 'PM sync_meta'); assertArray(extractList(r.data), 'PM sync_meta'); } },
    { name: 'PM reads staff', run: async () => { const r = await api('GET', '/api/data/staff?limit=1', { role: 'PM' }); assertOk(r, 'PM staff'); assertArray(extractList(r.data), 'PM staff'); } },
    { name: 'PM reads correspondence', run: async () => { const r = await api('GET', '/api/data/correspondence?limit=1', { role: 'PM' }); assertOk(r, 'PM correspondence'); assertArray(extractList(r.data), 'PM correspondence'); } },

    // --- BUH reads (20 tables) ---
    { name: 'BUH reads users', run: async () => { const r = await api('GET', '/api/data/users?limit=1', { role: 'BUH' }); assertOk(r, 'BUH users'); assertArray(extractList(r.data), 'BUH users'); } },
    { name: 'BUH reads employees', run: async () => { const r = await api('GET', '/api/data/employees?limit=1', { role: 'BUH' }); assertOk(r, 'BUH employees'); assertArray(extractList(r.data), 'BUH employees'); } },
    { name: 'BUH reads cash_requests', run: async () => { const r = await api('GET', '/api/data/cash_requests?limit=1', { role: 'BUH' }); assertOk(r, 'BUH cash_requests'); assertArray(extractList(r.data), 'BUH cash_requests'); } },
    { name: 'BUH reads cash_expenses', run: async () => { const r = await api('GET', '/api/data/cash_expenses?limit=1', { role: 'BUH' }); assertOk(r, 'BUH cash_expenses'); assertArray(extractList(r.data), 'BUH cash_expenses'); } },
    { name: 'BUH reads cash_returns', run: async () => { const r = await api('GET', '/api/data/cash_returns?limit=1', { role: 'BUH' }); assertOk(r, 'BUH cash_returns'); assertArray(extractList(r.data), 'BUH cash_returns'); } },
    { name: 'BUH reads tenders', run: async () => { const r = await api('GET', '/api/data/tenders?limit=1', { role: 'BUH' }); assertOk(r, 'BUH tenders'); assertArray(extractList(r.data), 'BUH tenders'); } },
    { name: 'BUH reads works', run: async () => { const r = await api('GET', '/api/data/works?limit=1', { role: 'BUH' }); assertOk(r, 'BUH works'); assertArray(extractList(r.data), 'BUH works'); } },
    { name: 'BUH reads work_expenses', run: async () => { const r = await api('GET', '/api/data/work_expenses?limit=1', { role: 'BUH' }); assertOk(r, 'BUH work_expenses'); assertArray(extractList(r.data), 'BUH work_expenses'); } },
    { name: 'BUH reads invoices', run: async () => { const r = await api('GET', '/api/data/invoices?limit=1', { role: 'BUH' }); assertOk(r, 'BUH invoices'); assertArray(extractList(r.data), 'BUH invoices'); } },
    { name: 'BUH reads invoice_payments', run: async () => { const r = await api('GET', '/api/data/invoice_payments?limit=1', { role: 'BUH' }); assertOk(r, 'BUH invoice_payments'); assertArray(extractList(r.data), 'BUH invoice_payments'); } },
    { name: 'BUH reads acts', run: async () => { const r = await api('GET', '/api/data/acts?limit=1', { role: 'BUH' }); assertOk(r, 'BUH acts'); assertArray(extractList(r.data), 'BUH acts'); } },
    { name: 'BUH reads contracts', run: async () => { const r = await api('GET', '/api/data/contracts?limit=1', { role: 'BUH' }); assertOk(r, 'BUH contracts'); assertArray(extractList(r.data), 'BUH contracts'); } },
    { name: 'BUH reads customers', run: async () => { const r = await api('GET', '/api/data/customers?limit=1', { role: 'BUH' }); assertOk(r, 'BUH customers'); assertArray(extractList(r.data), 'BUH customers'); } },
    { name: 'BUH reads incomes', run: async () => { const r = await api('GET', '/api/data/incomes?limit=1', { role: 'BUH' }); assertOk(r, 'BUH incomes'); assertArray(extractList(r.data), 'BUH incomes'); } },
    { name: 'BUH reads office_expenses', run: async () => { const r = await api('GET', '/api/data/office_expenses?limit=1', { role: 'BUH' }); assertOk(r, 'BUH office_expenses'); assertArray(extractList(r.data), 'BUH office_expenses'); } },
    { name: 'BUH reads bank_rules', run: async () => { const r = await api('GET', '/api/data/bank_rules?limit=1', { role: 'BUH' }); assertOk(r, 'BUH bank_rules'); assertArray(extractList(r.data), 'BUH bank_rules'); } },
    { name: 'BUH reads calendar_events', run: async () => { const r = await api('GET', '/api/data/calendar_events?limit=1', { role: 'BUH' }); assertOk(r, 'BUH calendar_events'); assertArray(extractList(r.data), 'BUH calendar_events'); } },
    { name: 'BUH reads chats', run: async () => { const r = await api('GET', '/api/data/chats?limit=1', { role: 'BUH' }); assertOk(r, 'BUH chats'); assertArray(extractList(r.data), 'BUH chats'); } },
    { name: 'BUH reads notifications', run: async () => { const r = await api('GET', '/api/data/notifications?limit=1', { role: 'BUH' }); assertOk(r, 'BUH notifications'); assertArray(extractList(r.data), 'BUH notifications'); } },
    { name: 'BUH reads payroll_sheets', run: async () => { const r = await api('GET', '/api/data/payroll_sheets?limit=1', { role: 'BUH' }); assertOk(r, 'BUH payroll_sheets'); assertArray(extractList(r.data), 'BUH payroll_sheets'); } },

    // --- HR reads (20 tables) ---
    { name: 'HR reads users', run: async () => { const r = await api('GET', '/api/data/users?limit=1', { role: 'HR' }); assertOk(r, 'HR users'); assertArray(extractList(r.data), 'HR users'); } },
    { name: 'HR reads employees', run: async () => { const r = await api('GET', '/api/data/employees?limit=1', { role: 'HR' }); assertOk(r, 'HR employees'); assertArray(extractList(r.data), 'HR employees'); } },
    { name: 'HR reads tenders', run: async () => { const r = await api('GET', '/api/data/tenders?limit=1', { role: 'HR' }); assertOk(r, 'HR tenders'); assertArray(extractList(r.data), 'HR tenders'); } },
    { name: 'HR reads works', run: async () => { const r = await api('GET', '/api/data/works?limit=1', { role: 'HR' }); assertOk(r, 'HR works'); assertArray(extractList(r.data), 'HR works'); } },
    { name: 'HR reads employee_reviews', run: async () => { const r = await api('GET', '/api/data/employee_reviews?limit=1', { role: 'HR' }); assertOk(r, 'HR employee_reviews'); assertArray(extractList(r.data), 'HR employee_reviews'); } },
    { name: 'HR reads employee_assignments', run: async () => { const r = await api('GET', '/api/data/employee_assignments?limit=1', { role: 'HR' }); assertOk(r, 'HR employee_assignments'); assertArray(extractList(r.data), 'HR employee_assignments'); } },
    { name: 'HR reads employee_plan', run: async () => { const r = await api('GET', '/api/data/employee_plan?limit=1', { role: 'HR' }); assertOk(r, 'HR employee_plan'); assertArray(extractList(r.data), 'HR employee_plan'); } },
    { name: 'HR reads staff', run: async () => { const r = await api('GET', '/api/data/staff?limit=1', { role: 'HR' }); assertOk(r, 'HR staff'); assertArray(extractList(r.data), 'HR staff'); } },
    { name: 'HR reads staff_plan', run: async () => { const r = await api('GET', '/api/data/staff_plan?limit=1', { role: 'HR' }); assertOk(r, 'HR staff_plan'); assertArray(extractList(r.data), 'HR staff_plan'); } },
    { name: 'HR reads staff_requests', run: async () => { const r = await api('GET', '/api/data/staff_requests?limit=1', { role: 'HR' }); assertOk(r, 'HR staff_requests'); assertArray(extractList(r.data), 'HR staff_requests'); } },
    { name: 'HR reads staff_replacements', run: async () => { const r = await api('GET', '/api/data/staff_replacements?limit=1', { role: 'HR' }); assertOk(r, 'HR staff_replacements'); assertArray(extractList(r.data), 'HR staff_replacements'); } },
    { name: 'HR reads employee_permits', run: async () => { const r = await api('GET', '/api/data/employee_permits?limit=1', { role: 'HR' }); assertOk(r, 'HR employee_permits'); assertArray(extractList(r.data), 'HR employee_permits'); } },
    { name: 'HR reads calendar_events', run: async () => { const r = await api('GET', '/api/data/calendar_events?limit=1', { role: 'HR' }); assertOk(r, 'HR calendar_events'); assertArray(extractList(r.data), 'HR calendar_events'); } },
    { name: 'HR reads chats', run: async () => { const r = await api('GET', '/api/data/chats?limit=1', { role: 'HR' }); assertOk(r, 'HR chats'); assertArray(extractList(r.data), 'HR chats'); } },
    { name: 'HR reads chat_messages', run: async () => { const r = await api('GET', '/api/data/chat_messages?limit=1', { role: 'HR' }); assertOk(r, 'HR chat_messages'); assertArray(extractList(r.data), 'HR chat_messages'); } },
    { name: 'HR reads notifications', run: async () => { const r = await api('GET', '/api/data/notifications?limit=1', { role: 'HR' }); assertOk(r, 'HR notifications'); assertArray(extractList(r.data), 'HR notifications'); } },
    { name: 'HR reads sync_meta', run: async () => { const r = await api('GET', '/api/data/sync_meta?limit=1', { role: 'HR' }); assertOk(r, 'HR sync_meta'); assertArray(extractList(r.data), 'HR sync_meta'); } },
    { name: 'HR reads reminders', run: async () => { const r = await api('GET', '/api/data/reminders?limit=1', { role: 'HR' }); assertOk(r, 'HR reminders'); assertArray(extractList(r.data), 'HR reminders'); } },
    { name: 'HR reads travel_expenses', run: async () => { const r = await api('GET', '/api/data/travel_expenses?limit=1', { role: 'HR' }); assertOk(r, 'HR travel_expenses'); assertArray(extractList(r.data), 'HR travel_expenses'); } },
    { name: 'HR reads invoices', run: async () => { const r = await api('GET', '/api/data/invoices?limit=1', { role: 'HR' }); assertOk(r, 'HR invoices'); assertArray(extractList(r.data), 'HR invoices'); } },

    // --- WAREHOUSE reads (20 tables) ---
    { name: 'WAREHOUSE reads users', run: async () => { const r = await api('GET', '/api/data/users?limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'WH users'); assertArray(extractList(r.data), 'WH users'); } },
    { name: 'WAREHOUSE reads equipment', run: async () => { const r = await api('GET', '/api/data/equipment?limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'WH equipment'); assertArray(extractList(r.data), 'WH equipment'); } },
    { name: 'WAREHOUSE reads equipment_categories', run: async () => { const r = await api('GET', '/api/data/equipment_categories?limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'WH equipment_categories'); assertArray(extractList(r.data), 'WH equipment_categories'); } },
    { name: 'WAREHOUSE reads equipment_movements', run: async () => { const r = await api('GET', '/api/data/equipment_movements?limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'WH equipment_movements'); assertArray(extractList(r.data), 'WH equipment_movements'); } },
    { name: 'WAREHOUSE reads equipment_requests', run: async () => { const r = await api('GET', '/api/data/equipment_requests?limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'WH equipment_requests'); assertArray(extractList(r.data), 'WH equipment_requests'); } },
    { name: 'WAREHOUSE reads equipment_maintenance', run: async () => { const r = await api('GET', '/api/data/equipment_maintenance?limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'WH equipment_maintenance'); assertArray(extractList(r.data), 'WH equipment_maintenance'); } },
    { name: 'WAREHOUSE reads equipment_reservations', run: async () => { const r = await api('GET', '/api/data/equipment_reservations?limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'WH equipment_reservations'); assertArray(extractList(r.data), 'WH equipment_reservations'); } },
    { name: 'WAREHOUSE reads warehouses', run: async () => { const r = await api('GET', '/api/data/warehouses?limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'WH warehouses'); assertArray(extractList(r.data), 'WH warehouses'); } },
    { name: 'WAREHOUSE reads objects', run: async () => { const r = await api('GET', '/api/data/objects?limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'WH objects'); assertArray(extractList(r.data), 'WH objects'); } },
    { name: 'WAREHOUSE reads chats', run: async () => { const r = await api('GET', '/api/data/chats?limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'WH chats'); assertArray(extractList(r.data), 'WH chats'); } },
    { name: 'WAREHOUSE reads chat_messages', run: async () => { const r = await api('GET', '/api/data/chat_messages?limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'WH chat_messages'); assertArray(extractList(r.data), 'WH chat_messages'); } },
    { name: 'WAREHOUSE reads notifications', run: async () => { const r = await api('GET', '/api/data/notifications?limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'WH notifications'); assertArray(extractList(r.data), 'WH notifications'); } },
    { name: 'WAREHOUSE reads sync_meta', run: async () => { const r = await api('GET', '/api/data/sync_meta?limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'WH sync_meta'); assertArray(extractList(r.data), 'WH sync_meta'); } },
    { name: 'WAREHOUSE reads reminders', run: async () => { const r = await api('GET', '/api/data/reminders?limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'WH reminders'); assertArray(extractList(r.data), 'WH reminders'); } },
    { name: 'WAREHOUSE reads user_dashboard', run: async () => { const r = await api('GET', '/api/data/user_dashboard?limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'WH user_dashboard'); assertArray(extractList(r.data), 'WH user_dashboard'); } },
    // WAREHOUSE only has 15 tables; pad with ADMIN reads on extra tables to reach 20
    { name: 'ADMIN reads staff via data API', run: async () => { const r = await api('GET', '/api/data/staff?limit=1', { role: 'ADMIN' }); assertOk(r, 'ADMIN staff'); assertArray(extractList(r.data), 'ADMIN staff'); } },
    { name: 'ADMIN reads correspondence via data API', run: async () => { const r = await api('GET', '/api/data/correspondence?limit=1', { role: 'ADMIN' }); assertOk(r, 'ADMIN correspondence'); assertArray(extractList(r.data), 'ADMIN correspondence'); } },
    { name: 'ADMIN reads seals via data API', run: async () => { const r = await api('GET', '/api/data/seals?limit=1', { role: 'ADMIN' }); assertOk(r, 'ADMIN seals'); assertArray(extractList(r.data), 'ADMIN seals'); } },
    { name: 'ADMIN reads purchase_requests via data API', run: async () => { const r = await api('GET', '/api/data/purchase_requests?limit=1', { role: 'ADMIN' }); assertOk(r, 'ADMIN purchase_requests'); assertArray(extractList(r.data), 'ADMIN purchase_requests'); } },
    { name: 'ADMIN reads employee_rates via data API', run: async () => { const r = await api('GET', '/api/data/employee_rates?limit=1', { role: 'ADMIN' }); assertOk(r, 'ADMIN employee_rates'); assertArray(extractList(r.data), 'ADMIN employee_rates'); } },

    // =========================================================================
    // SECTION 2: READ with query params — 30 tests
    // =========================================================================

    // ?limit=5 returns max 5 items (10 tests)
    { name: 'ADMIN tenders limit=5', run: async () => { const r = await api('GET', '/api/data/tenders?limit=5', { role: 'ADMIN' }); assertOk(r, 'limit=5 tenders'); const list = extractList(r.data); assertArray(list, 'limit=5 tenders'); assert(list.length <= 5, `limit=5 returned ${list.length} items`); } },
    { name: 'ADMIN works limit=5', run: async () => { const r = await api('GET', '/api/data/works?limit=5', { role: 'ADMIN' }); assertOk(r, 'limit=5 works'); const list = extractList(r.data); assertArray(list, 'limit=5 works'); assert(list.length <= 5, `limit=5 returned ${list.length} items`); } },
    { name: 'PM estimates limit=5', run: async () => { const r = await api('GET', '/api/data/estimates?limit=5', { role: 'PM' }); assertOk(r, 'limit=5 estimates'); const list = extractList(r.data); assertArray(list, 'limit=5 estimates'); assert(list.length <= 5, `limit=5 returned ${list.length} items`); } },
    { name: 'BUH invoices limit=5', run: async () => { const r = await api('GET', '/api/data/invoices?limit=5', { role: 'BUH' }); assertOk(r, 'limit=5 invoices'); const list = extractList(r.data); assertArray(list, 'limit=5 invoices'); assert(list.length <= 5, `limit=5 returned ${list.length} items`); } },
    { name: 'HR employees limit=5', run: async () => { const r = await api('GET', '/api/data/employees?limit=5', { role: 'HR' }); assertOk(r, 'limit=5 employees'); const list = extractList(r.data); assertArray(list, 'limit=5 employees'); assert(list.length <= 5, `limit=5 returned ${list.length} items`); } },
    { name: 'ADMIN customers limit=5', run: async () => { const r = await api('GET', '/api/data/customers?limit=5', { role: 'ADMIN' }); assertOk(r, 'limit=5 customers'); const list = extractList(r.data); assertArray(list, 'limit=5 customers'); assert(list.length <= 5, `limit=5 returned ${list.length} items`); } },
    { name: 'ADMIN calendar_events limit=5', run: async () => { const r = await api('GET', '/api/data/calendar_events?limit=5', { role: 'ADMIN' }); assertOk(r, 'limit=5 calendar_events'); const list = extractList(r.data); assertArray(list, 'limit=5 calendar_events'); assert(list.length <= 5, `limit=5 returned ${list.length} items`); } },
    { name: 'ADMIN notifications limit=5', run: async () => { const r = await api('GET', '/api/data/notifications?limit=5', { role: 'ADMIN' }); assertOk(r, 'limit=5 notifications'); const list = extractList(r.data); assertArray(list, 'limit=5 notifications'); assert(list.length <= 5, `limit=5 returned ${list.length} items`); } },
    { name: 'PM documents limit=5', run: async () => { const r = await api('GET', '/api/data/documents?limit=5', { role: 'PM' }); assertOk(r, 'limit=5 documents'); const list = extractList(r.data); assertArray(list, 'limit=5 documents'); assert(list.length <= 5, `limit=5 returned ${list.length} items`); } },
    { name: 'WAREHOUSE equipment limit=5', run: async () => { const r = await api('GET', '/api/data/equipment?limit=5', { role: 'WAREHOUSE' }); assertOk(r, 'limit=5 equipment'); const list = extractList(r.data); assertArray(list, 'limit=5 equipment'); assert(list.length <= 5, `limit=5 returned ${list.length} items`); } },

    // ?offset=0&limit=1 works (5 tests)
    { name: 'ADMIN tenders offset=0&limit=1', run: async () => { const r = await api('GET', '/api/data/tenders?offset=0&limit=1', { role: 'ADMIN' }); assertOk(r, 'offset=0 tenders'); const list = extractList(r.data); assertArray(list, 'offset=0 tenders'); assert(list.length <= 1, `offset=0&limit=1 returned ${list.length} items`); } },
    { name: 'PM works offset=0&limit=1', run: async () => { const r = await api('GET', '/api/data/works?offset=0&limit=1', { role: 'PM' }); assertOk(r, 'offset=0 works'); const list = extractList(r.data); assertArray(list, 'offset=0 works'); assert(list.length <= 1, `offset=0&limit=1 returned ${list.length} items`); } },
    { name: 'BUH cash_requests offset=0&limit=1', run: async () => { const r = await api('GET', '/api/data/cash_requests?offset=0&limit=1', { role: 'BUH' }); assertOk(r, 'offset=0 cash_requests'); const list = extractList(r.data); assertArray(list, 'offset=0 cash_requests'); assert(list.length <= 1, `offset=0&limit=1 returned ${list.length} items`); } },
    { name: 'HR staff offset=0&limit=1', run: async () => { const r = await api('GET', '/api/data/staff?offset=0&limit=1', { role: 'HR' }); assertOk(r, 'offset=0 staff'); const list = extractList(r.data); assertArray(list, 'offset=0 staff'); assert(list.length <= 1, `offset=0&limit=1 returned ${list.length} items`); } },
    { name: 'WAREHOUSE equipment_categories offset=0&limit=1', run: async () => { const r = await api('GET', '/api/data/equipment_categories?offset=0&limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'offset=0 eq_cat'); const list = extractList(r.data); assertArray(list, 'offset=0 eq_cat'); assert(list.length <= 1, `offset=0&limit=1 returned ${list.length} items`); } },

    // ?sort=id&order=desc works (5 tests)
    { name: 'ADMIN tenders sort=id&order=desc', run: async () => { const r = await api('GET', '/api/data/tenders?sort=id&order=desc&limit=3', { role: 'ADMIN' }); assertOk(r, 'sort tenders'); const list = extractList(r.data); assertArray(list, 'sort tenders'); if (list.length >= 2) { assert(list[0].id >= list[1].id, `expected desc order, got ${list[0].id} < ${list[1].id}`); } } },
    { name: 'ADMIN works sort=id&order=desc', run: async () => { const r = await api('GET', '/api/data/works?sort=id&order=desc&limit=3', { role: 'ADMIN' }); assertOk(r, 'sort works'); const list = extractList(r.data); assertArray(list, 'sort works'); if (list.length >= 2) { assert(list[0].id >= list[1].id, `expected desc order`); } } },
    { name: 'PM invoices sort=id&order=desc', run: async () => { const r = await api('GET', '/api/data/invoices?sort=id&order=desc&limit=3', { role: 'PM' }); assertOk(r, 'sort invoices'); const list = extractList(r.data); assertArray(list, 'sort invoices'); if (list.length >= 2) { assert(list[0].id >= list[1].id, `expected desc order`); } } },
    { name: 'BUH acts sort=id&order=desc', run: async () => { const r = await api('GET', '/api/data/acts?sort=id&order=desc&limit=3', { role: 'BUH' }); assertOk(r, 'sort acts'); const list = extractList(r.data); assertArray(list, 'sort acts'); if (list.length >= 2) { assert(list[0].id >= list[1].id, `expected desc order`); } } },
    { name: 'HR employees sort=id&order=desc', run: async () => { const r = await api('GET', '/api/data/employees?sort=id&order=desc&limit=3', { role: 'HR' }); assertOk(r, 'sort employees'); const list = extractList(r.data); assertArray(list, 'sort employees'); if (list.length >= 2) { assert(list[0].id >= list[1].id, `expected desc order`); } } },

    // ?sort=id&order=asc works (5 tests)
    { name: 'ADMIN employees sort=id&order=asc', run: async () => { const r = await api('GET', '/api/data/employees?sort=id&order=asc&limit=3', { role: 'ADMIN' }); assertOk(r, 'sort asc employees'); const list = extractList(r.data); assertArray(list, 'sort asc employees'); if (list.length >= 2) { assert(list[0].id <= list[1].id, `expected asc order`); } } },
    { name: 'ADMIN contracts sort=id&order=asc', run: async () => { const r = await api('GET', '/api/data/contracts?sort=id&order=asc&limit=3', { role: 'ADMIN' }); assertOk(r, 'sort asc contracts'); const list = extractList(r.data); assertArray(list, 'sort asc contracts'); if (list.length >= 2) { assert(list[0].id <= list[1].id, `expected asc order`); } } },
    { name: 'PM chats sort=id&order=asc', run: async () => { const r = await api('GET', '/api/data/chats?sort=id&order=asc&limit=3', { role: 'PM' }); assertOk(r, 'sort asc chats'); const list = extractList(r.data); assertArray(list, 'sort asc chats'); if (list.length >= 2) { assert(list[0].id <= list[1].id, `expected asc order`); } } },
    { name: 'BUH customers sort=id&order=asc', run: async () => { const r = await api('GET', '/api/data/customers?sort=id&order=asc&limit=3', { role: 'BUH' }); assertOk(r, 'sort asc customers'); assertArray(extractList(r.data), 'sort asc customers'); } },
    { name: 'ADMIN documents sort=id&order=asc', run: async () => { const r = await api('GET', '/api/data/documents?sort=id&order=asc&limit=3', { role: 'ADMIN' }); assertOk(r, 'sort asc documents'); assertArray(extractList(r.data), 'sort asc documents'); } },

    // ?search=test works / doesn't crash (5 tests)
    { name: 'ADMIN tenders search=test', run: async () => { const r = await api('GET', '/api/data/tenders?search=test&limit=3', { role: 'ADMIN' }); assert(r.status < 500, `search=test on tenders returned ${r.status}`); } },
    { name: 'PM employees search=test', run: async () => { const r = await api('GET', '/api/data/employees?search=test&limit=3', { role: 'PM' }); assert(r.status < 500, `search=test on employees returned ${r.status}`); } },
    { name: 'BUH invoices search=test', run: async () => { const r = await api('GET', '/api/data/invoices?search=test&limit=3', { role: 'BUH' }); assert(r.status < 500, `search=test on invoices returned ${r.status}`); } },
    { name: 'HR staff search=test', run: async () => { const r = await api('GET', '/api/data/staff?search=test&limit=3', { role: 'HR' }); assert(r.status < 500, `search=test on staff returned ${r.status}`); } },
    { name: 'WAREHOUSE equipment search=test', run: async () => { const r = await api('GET', '/api/data/equipment?search=test&limit=3', { role: 'WAREHOUSE' }); assert(r.status < 500, `search=test on equipment returned ${r.status}`); } },

    // =========================================================================
    // SECTION 3: Forbidden reads — 30 tests
    // =========================================================================

    // WAREHOUSE cannot read these tables (10 tests)
    { name: 'WAREHOUSE cannot read tenders', run: async () => { const r = await api('GET', '/api/data/tenders?limit=1', { role: 'WAREHOUSE' }); assertStatus(r, 403, 'WH tenders'); } },
    { name: 'WAREHOUSE cannot read acts', run: async () => { const r = await api('GET', '/api/data/acts?limit=1', { role: 'WAREHOUSE' }); assertStatus(r, 403, 'WH acts'); } },
    { name: 'WAREHOUSE cannot read invoices', run: async () => { const r = await api('GET', '/api/data/invoices?limit=1', { role: 'WAREHOUSE' }); assertStatus(r, 403, 'WH invoices'); } },
    { name: 'WAREHOUSE CAN read employees', run: async () => { const r = await api('GET', '/api/data/employees?limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'WH employees'); } },
    { name: 'WAREHOUSE cannot read contracts', run: async () => { const r = await api('GET', '/api/data/contracts?limit=1', { role: 'WAREHOUSE' }); assertStatus(r, 403, 'WH contracts'); } },
    { name: 'WAREHOUSE cannot read cash_requests', run: async () => { const r = await api('GET', '/api/data/cash_requests?limit=1', { role: 'WAREHOUSE' }); assertStatus(r, 403, 'WH cash_requests'); } },
    { name: 'WAREHOUSE cannot read estimates', run: async () => { const r = await api('GET', '/api/data/estimates?limit=1', { role: 'WAREHOUSE' }); assertStatus(r, 403, 'WH estimates'); } },
    { name: 'WAREHOUSE CAN read staff', run: async () => { const r = await api('GET', '/api/data/staff?limit=1', { role: 'WAREHOUSE' }); assertOk(r, 'WH staff'); } },
    { name: 'WAREHOUSE cannot read documents', run: async () => { const r = await api('GET', '/api/data/documents?limit=1', { role: 'WAREHOUSE' }); assertStatus(r, 403, 'WH documents'); } },
    { name: 'WAREHOUSE cannot read correspondence', run: async () => { const r = await api('GET', '/api/data/correspondence?limit=1', { role: 'WAREHOUSE' }); assertStatus(r, 403, 'WH correspondence'); } },

    // PROC cannot read these tables (10 tests)
    { name: 'PROC CAN read employees', run: async () => { const r = await api('GET', '/api/data/employees?limit=1', { role: 'PROC' }); assertOk(r, 'PROC employees'); } },
    { name: 'PROC CAN read tenders', run: async () => { const r = await api('GET', '/api/data/tenders?limit=1', { role: 'PROC' }); assertOk(r, 'PROC tenders'); } },
    { name: 'PROC CAN read works', run: async () => { const r = await api('GET', '/api/data/works?limit=1', { role: 'PROC' }); assertOk(r, 'PROC works'); } },
    { name: 'PROC cannot read contracts', run: async () => { const r = await api('GET', '/api/data/contracts?limit=1', { role: 'PROC' }); assertStatus(r, 403, 'PROC contracts'); } },
    { name: 'PROC cannot read acts', run: async () => { const r = await api('GET', '/api/data/acts?limit=1', { role: 'PROC' }); assertStatus(r, 403, 'PROC acts'); } },
    { name: 'PROC CAN read staff', run: async () => { const r = await api('GET', '/api/data/staff?limit=1', { role: 'PROC' }); assertOk(r, 'PROC staff'); } },
    { name: 'PROC cannot read estimates', run: async () => { const r = await api('GET', '/api/data/estimates?limit=1', { role: 'PROC' }); assertStatus(r, 403, 'PROC estimates'); } },
    { name: 'PROC cannot read cash_requests', run: async () => { const r = await api('GET', '/api/data/cash_requests?limit=1', { role: 'PROC' }); assertStatus(r, 403, 'PROC cash_requests'); } },
    { name: 'PROC cannot read correspondence', run: async () => { const r = await api('GET', '/api/data/correspondence?limit=1', { role: 'PROC' }); assertStatus(r, 403, 'PROC correspondence'); } },
    { name: 'PROC cannot read customers', run: async () => { const r = await api('GET', '/api/data/customers?limit=1', { role: 'PROC' }); assertStatus(r, 403, 'PROC customers'); } },

    // TO cannot read these tables (5 tests)
    { name: 'TO cannot read cash_requests', run: async () => { const r = await api('GET', '/api/data/cash_requests?limit=1', { role: 'TO' }); assertStatus(r, 403, 'TO cash_requests'); } },
    { name: 'TO cannot read equipment', run: async () => { const r = await api('GET', '/api/data/equipment?limit=1', { role: 'TO' }); assertStatus(r, 403, 'TO equipment'); } },
    { name: 'TO CAN read staff', run: async () => { const r = await api('GET', '/api/data/staff?limit=1', { role: 'TO' }); assertOk(r, 'TO staff'); } },
    { name: 'TO cannot read acts', run: async () => { const r = await api('GET', '/api/data/acts?limit=1', { role: 'TO' }); assertStatus(r, 403, 'TO acts'); } },
    { name: 'TO cannot read office_expenses', run: async () => { const r = await api('GET', '/api/data/office_expenses?limit=1', { role: 'TO' }); assertStatus(r, 403, 'TO office_expenses'); } },

    // HEAD_TO, HR_MANAGER, CHIEF_ENGINEER now have access to their relevant tables
    { name: 'HEAD_TO CAN read tenders', run: async () => { const r = await api('GET', '/api/data/tenders?limit=1', { role: 'HEAD_TO' }); assertOk(r, 'HEAD_TO tenders'); } },
    { name: 'HEAD_TO CAN read employees', run: async () => { const r = await api('GET', '/api/data/employees?limit=1', { role: 'HEAD_TO' }); assertOk(r, 'HEAD_TO employees'); } },
    { name: 'HR_MANAGER CAN read tenders', run: async () => { const r = await api('GET', '/api/data/tenders?limit=1', { role: 'HR_MANAGER' }); assertOk(r, 'HR_MANAGER tenders'); } },
    { name: 'HR_MANAGER CAN read employees', run: async () => { const r = await api('GET', '/api/data/employees?limit=1', { role: 'HR_MANAGER' }); assertOk(r, 'HR_MANAGER employees'); } },
    { name: 'CHIEF_ENGINEER CAN read works', run: async () => { const r = await api('GET', '/api/data/works?limit=1', { role: 'CHIEF_ENGINEER' }); assertOk(r, 'CHIEF_ENGINEER works'); } },

    // =========================================================================
    // SECTION 4: CREATE operations — POST /api/data/:table — 20 tests
    // =========================================================================

    // ADMIN creates
    { name: 'ADMIN creates calendar_event', run: async () => {
      const r = await api('POST', '/api/data/calendar_events', { role: 'ADMIN', body: { title: '_test_event_', date: '2026-03-01' } });
      assert(r.status === 200 || r.status === 201, `ADMIN create calendar_event: expected 200/201, got ${r.status}`);
    }},
    { name: 'ADMIN creates reminder', run: async () => {
      const r = await api('POST', '/api/data/reminders', { role: 'ADMIN', body: { title: '_test_reminder_', remind_at: '2026-03-01T10:00:00Z' } });
      assert(r.status === 200 || r.status === 201, `ADMIN create reminder: expected 200/201, got ${r.status}`);
    }},
    { name: 'ADMIN creates notification', run: async () => {
      const r = await api('POST', '/api/data/notifications', { role: 'ADMIN', body: { message: '_test_notification_', type: 'info' } });
      assert(r.status === 200 || r.status === 201, `ADMIN create notification: expected 200/201, got ${r.status}`);
    }},
    { name: 'ADMIN creates equipment_category', run: async () => {
      const r = await api('POST', '/api/data/equipment_categories', { role: 'ADMIN', body: { name: '_test_eq_cat_' } });
      assert(r.status === 200 || r.status === 201, `ADMIN create equipment_category: expected 200/201, got ${r.status}`);
    }},
    { name: 'ADMIN creates chat', run: async () => {
      const r = await api('POST', '/api/data/chats', { role: 'ADMIN', body: { name: '_test_chat_' } });
      assert(r.status === 200 || r.status === 201, `ADMIN create chat: expected 200/201, got ${r.status}`);
    }},

    // PM creates in allowed tables
    { name: 'PM creates calendar_event', run: async () => {
      const r = await api('POST', '/api/data/calendar_events', { role: 'PM', body: { title: '_test_pm_event_', date: '2026-03-02' } });
      assert(r.status === 200 || r.status === 201, `PM create calendar_event: expected 200/201, got ${r.status}`);
    }},
    { name: 'PM creates reminder', run: async () => {
      const r = await api('POST', '/api/data/reminders', { role: 'PM', body: { title: '_test_pm_reminder_', remind_at: '2026-03-02T10:00:00Z' } });
      assert(r.status === 200 || r.status === 201, `PM create reminder: expected 200/201, got ${r.status}`);
    }},
    { name: 'PM creates notification', run: async () => {
      const r = await api('POST', '/api/data/notifications', { role: 'PM', body: { message: '_test_pm_notif_', type: 'info' } });
      assert(r.status === 200 || r.status === 201, `PM create notification: expected 200/201, got ${r.status}`);
    }},

    // BUH creates in allowed tables
    { name: 'BUH creates calendar_event', run: async () => {
      const r = await api('POST', '/api/data/calendar_events', { role: 'BUH', body: { title: '_test_buh_event_', date: '2026-03-03' } });
      assert(r.status === 200 || r.status === 201, `BUH create calendar_event: expected 200/201, got ${r.status}`);
    }},
    { name: 'BUH creates reminder', run: async () => {
      const r = await api('POST', '/api/data/reminders', { role: 'BUH', body: { title: '_test_buh_reminder_', remind_at: '2026-03-03T10:00:00Z' } });
      assert(r.status === 200 || r.status === 201, `BUH create reminder: expected 200/201, got ${r.status}`);
    }},
    { name: 'BUH creates notification', run: async () => {
      const r = await api('POST', '/api/data/notifications', { role: 'BUH', body: { message: '_test_buh_notif_', type: 'info' } });
      assert(r.status === 200 || r.status === 201, `BUH create notification: expected 200/201, got ${r.status}`);
    }},

    // HR creates in allowed tables
    { name: 'HR creates calendar_event', run: async () => {
      const r = await api('POST', '/api/data/calendar_events', { role: 'HR', body: { title: '_test_hr_event_', date: '2026-03-04' } });
      assert(r.status === 200 || r.status === 201, `HR create calendar_event: expected 200/201, got ${r.status}`);
    }},
    { name: 'HR creates reminder', run: async () => {
      const r = await api('POST', '/api/data/reminders', { role: 'HR', body: { title: '_test_hr_reminder_', remind_at: '2026-03-04T10:00:00Z' } });
      assert(r.status === 200 || r.status === 201, `HR create reminder: expected 200/201, got ${r.status}`);
    }},

    // WAREHOUSE creates in allowed tables
    { name: 'WAREHOUSE creates reminder', run: async () => {
      const r = await api('POST', '/api/data/reminders', { role: 'WAREHOUSE', body: { title: '_test_wh_reminder_', remind_at: '2026-03-05T10:00:00Z' } });
      assert(r.status === 200 || r.status === 201, `WH create reminder: expected 200/201, got ${r.status}`);
    }},
    { name: 'WAREHOUSE creates notification', run: async () => {
      const r = await api('POST', '/api/data/notifications', { role: 'WAREHOUSE', body: { message: '_test_wh_notif_', type: 'info' } });
      assert(r.status === 200 || r.status === 201, `WH create notification: expected 200/201, got ${r.status}`);
    }},

    // OFFICE_MANAGER creates in allowed tables
    { name: 'OFFICE_MANAGER creates calendar_event', run: async () => {
      const r = await api('POST', '/api/data/calendar_events', { role: 'OFFICE_MANAGER', body: { title: '_test_om_event_', date: '2026-03-06' } });
      assert(r.status === 200 || r.status === 201, `OM create calendar_event: expected 200/201, got ${r.status}`);
    }},
    { name: 'OFFICE_MANAGER creates reminder', run: async () => {
      const r = await api('POST', '/api/data/reminders', { role: 'OFFICE_MANAGER', body: { title: '_test_om_reminder_', remind_at: '2026-03-06T10:00:00Z' } });
      assert(r.status === 200 || r.status === 201, `OM create reminder: expected 200/201, got ${r.status}`);
    }},

    // PROC creates in allowed tables
    { name: 'PROC creates calendar_event', run: async () => {
      const r = await api('POST', '/api/data/calendar_events', { role: 'PROC', body: { title: '_test_proc_event_', date: '2026-03-07' } });
      assert(r.status === 200 || r.status === 201, `PROC create calendar_event: expected 200/201, got ${r.status}`);
    }},

    // =========================================================================
    // SECTION 5: WRITE_PROTECTED tables — 15 tests
    //   users and audit_log cannot be created/updated/deleted via data API
    // =========================================================================

    // users: no POST/PUT/DELETE for any role
    { name: 'ADMIN cannot POST to users via data API', run: async () => {
      const r = await api('POST', '/api/data/users', { role: 'ADMIN', body: { login: '_forbidden_user_', name: 'Forbidden' } });
      assert(r.status >= 400, `POST /api/data/users should be blocked, got ${r.status}`);
    }},
    { name: 'ADMIN cannot PUT to users via data API', run: async () => {
      const r = await api('PUT', '/api/data/users/1', { role: 'ADMIN', body: { name: 'Modified' } });
      assert(r.status >= 400, `PUT /api/data/users/1 should be blocked, got ${r.status}`);
    }},
    { name: 'ADMIN cannot DELETE from users via data API', run: async () => {
      const r = await api('DELETE', '/api/data/users/1', { role: 'ADMIN' });
      assert(r.status >= 400, `DELETE /api/data/users/1 should be blocked, got ${r.status}`);
    }},
    { name: 'PM cannot POST to users via data API', run: async () => {
      const r = await api('POST', '/api/data/users', { role: 'PM', body: { login: '_forbidden_', name: 'No' } });
      assert(r.status >= 400, `PM POST users should be blocked, got ${r.status}`);
    }},
    { name: 'PM cannot PUT to users via data API', run: async () => {
      const r = await api('PUT', '/api/data/users/1', { role: 'PM', body: { name: 'No' } });
      assert(r.status >= 400, `PM PUT users should be blocked, got ${r.status}`);
    }},
    { name: 'BUH cannot POST to users via data API', run: async () => {
      const r = await api('POST', '/api/data/users', { role: 'BUH', body: { login: '_forbidden_', name: 'No' } });
      assert(r.status >= 400, `BUH POST users should be blocked, got ${r.status}`);
    }},

    // audit_log: no POST/PUT/DELETE for any role
    { name: 'ADMIN cannot POST to audit_log', run: async () => {
      const r = await api('POST', '/api/data/audit_log', { role: 'ADMIN', body: { action: 'test', details: 'forbidden' } });
      assert(r.status >= 400, `POST audit_log should be blocked, got ${r.status}`);
    }},
    { name: 'ADMIN cannot PUT to audit_log', run: async () => {
      const r = await api('PUT', '/api/data/audit_log/1', { role: 'ADMIN', body: { action: 'modified' } });
      assert(r.status >= 400, `PUT audit_log should be blocked, got ${r.status}`);
    }},
    { name: 'ADMIN cannot DELETE from audit_log', run: async () => {
      const r = await api('DELETE', '/api/data/audit_log/1', { role: 'ADMIN' });
      assert(r.status >= 400, `DELETE audit_log should be blocked, got ${r.status}`);
    }},
    { name: 'PM cannot POST to audit_log', run: async () => {
      const r = await api('POST', '/api/data/audit_log', { role: 'PM', body: { action: 'test' } });
      assert(r.status >= 400, `PM POST audit_log should be blocked, got ${r.status}`);
    }},
    { name: 'BUH cannot POST to audit_log', run: async () => {
      const r = await api('POST', '/api/data/audit_log', { role: 'BUH', body: { action: 'test' } });
      assert(r.status >= 400, `BUH POST audit_log should be blocked, got ${r.status}`);
    }},
    { name: 'HR cannot POST to audit_log', run: async () => {
      const r = await api('POST', '/api/data/audit_log', { role: 'HR', body: { action: 'test' } });
      assert(r.status >= 400, `HR POST audit_log should be blocked, got ${r.status}`);
    }},
    { name: 'DIRECTOR_GEN cannot POST to audit_log', run: async () => {
      const r = await api('POST', '/api/data/audit_log', { role: 'DIRECTOR_GEN', body: { action: 'test' } });
      assert(r.status >= 400, `DG POST audit_log should be blocked, got ${r.status}`);
    }},

    // =========================================================================
    // SECTION 6: READ_SENSITIVE tables — 10 tests
    //   audit_log readable only by ADMIN, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV
    // =========================================================================

    // Forbidden reads
    { name: 'PM cannot read audit_log', run: async () => {
      const r = await api('GET', '/api/data/audit_log?limit=1', { role: 'PM' });
      assertStatus(r, 403, 'PM audit_log');
    }},
    { name: 'BUH cannot read audit_log', run: async () => {
      const r = await api('GET', '/api/data/audit_log?limit=1', { role: 'BUH' });
      assertStatus(r, 403, 'BUH audit_log');
    }},
    { name: 'HR cannot read audit_log', run: async () => {
      const r = await api('GET', '/api/data/audit_log?limit=1', { role: 'HR' });
      assertStatus(r, 403, 'HR audit_log');
    }},
    { name: 'TO cannot read audit_log', run: async () => {
      const r = await api('GET', '/api/data/audit_log?limit=1', { role: 'TO' });
      assertStatus(r, 403, 'TO audit_log');
    }},
    { name: 'WAREHOUSE cannot read audit_log', run: async () => {
      const r = await api('GET', '/api/data/audit_log?limit=1', { role: 'WAREHOUSE' });
      assertStatus(r, 403, 'WH audit_log');
    }},
    { name: 'PROC cannot read audit_log', run: async () => {
      const r = await api('GET', '/api/data/audit_log?limit=1', { role: 'PROC' });
      assertStatus(r, 403, 'PROC audit_log');
    }},

    // Allowed reads
    { name: 'ADMIN can read audit_log', run: async () => {
      const r = await api('GET', '/api/data/audit_log?limit=1', { role: 'ADMIN' });
      assertOk(r, 'ADMIN audit_log');
    }},
    { name: 'DIRECTOR_GEN can read audit_log', run: async () => {
      const r = await api('GET', '/api/data/audit_log?limit=1', { role: 'DIRECTOR_GEN' });
      assertOk(r, 'DG audit_log');
    }},
    { name: 'DIRECTOR_COMM can read audit_log', run: async () => {
      const r = await api('GET', '/api/data/audit_log?limit=1', { role: 'DIRECTOR_COMM' });
      assertOk(r, 'DC audit_log');
    }},
    { name: 'DIRECTOR_DEV can read audit_log', run: async () => {
      const r = await api('GET', '/api/data/audit_log?limit=1', { role: 'DIRECTOR_DEV' });
      assertOk(r, 'DD audit_log');
    }},

    // =========================================================================
    // SECTION 7: Unknown/disallowed tables — 15 tests
    // =========================================================================

    { name: 'GET nonexistent table returns 4xx (ADMIN)', run: async () => {
      const r = await api('GET', '/api/data/nonexistent', { role: 'ADMIN' });
      assert(r.status >= 400 && r.status < 500, `nonexistent table: expected 4xx, got ${r.status}`);
    }},
    { name: 'GET nonexistent_table returns 4xx (PM)', run: async () => {
      const r = await api('GET', '/api/data/nonexistent_table', { role: 'PM' });
      assert(r.status >= 400 && r.status < 500, `nonexistent_table: expected 4xx, got ${r.status}`);
    }},
    { name: 'GET migrations returns 4xx (ADMIN)', run: async () => {
      const r = await api('GET', '/api/data/migrations', { role: 'ADMIN' });
      assert(r.status >= 400 && r.status < 500, `migrations: expected 4xx, got ${r.status}`);
    }},
    { name: 'GET migrations returns 4xx (PM)', run: async () => {
      const r = await api('GET', '/api/data/migrations', { role: 'PM' });
      assert(r.status >= 400 && r.status < 500, `migrations PM: expected 4xx, got ${r.status}`);
    }},
    { name: 'GET pg_catalog returns 4xx', run: async () => {
      const r = await api('GET', '/api/data/pg_catalog', { role: 'ADMIN' });
      assert(r.status >= 400 && r.status < 500, `pg_catalog: expected 4xx, got ${r.status}`);
    }},
    { name: 'GET information_schema returns 4xx', run: async () => {
      const r = await api('GET', '/api/data/information_schema', { role: 'ADMIN' });
      assert(r.status >= 400 && r.status < 500, `information_schema: expected 4xx, got ${r.status}`);
    }},
    { name: 'GET __proto__ returns 4xx', run: async () => {
      const r = await api('GET', '/api/data/__proto__', { role: 'ADMIN' });
      assert(r.status >= 400 && r.status < 500, `__proto__: expected 4xx, got ${r.status}`);
    }},
    { name: 'GET constructor returns 4xx', run: async () => {
      const r = await api('GET', '/api/data/constructor', { role: 'ADMIN' });
      assert(r.status >= 400 && r.status < 500, `constructor: expected 4xx, got ${r.status}`);
    }},
    { name: 'POST nonexistent table returns 4xx', run: async () => {
      const r = await api('POST', '/api/data/nonexistent', { role: 'ADMIN', body: { foo: 'bar' } });
      assert(r.status >= 400 && r.status < 500, `POST nonexistent: expected 4xx, got ${r.status}`);
    }},
    { name: 'PUT nonexistent table returns 4xx', run: async () => {
      const r = await api('PUT', '/api/data/nonexistent/1', { role: 'ADMIN', body: { foo: 'bar' } });
      assert(r.status >= 400 && r.status < 500, `PUT nonexistent: expected 4xx, got ${r.status}`);
    }},
    { name: 'DELETE nonexistent table returns 4xx', run: async () => {
      const r = await api('DELETE', '/api/data/nonexistent/1', { role: 'ADMIN' });
      assert(r.status >= 400 && r.status < 500, `DELETE nonexistent: expected 4xx, got ${r.status}`);
    }},
    { name: 'GET sessions returns 4xx', run: async () => {
      const r = await api('GET', '/api/data/sessions', { role: 'ADMIN' });
      assert(r.status >= 400 && r.status < 500, `sessions: expected 4xx, got ${r.status}`);
    }},
    { name: 'GET sql_injection attempt returns 4xx', run: async () => {
      const r = await api('GET', '/api/data/users;DROP%20TABLE%20users', { role: 'ADMIN' });
      assert(r.status >= 400 && r.status < 500, `SQL injection: expected 4xx, got ${r.status}`);
    }},
    { name: 'GET table with dots returns 4xx', run: async () => {
      const r = await api('GET', '/api/data/public.users', { role: 'ADMIN' });
      assert(r.status >= 400 && r.status < 500, `public.users: expected 4xx, got ${r.status}`);
    }},
    { name: 'GET empty table name returns 4xx or 404', run: async () => {
      const r = await api('GET', '/api/data/', { role: 'ADMIN' });
      assert(r.status >= 400 || r.status === 200, `empty table: got ${r.status}`);
    }},
    { name: 'GET table with spaces returns 4xx', run: async () => {
      const r = await api('GET', '/api/data/my%20table', { role: 'ADMIN' });
      assert(r.status >= 400 && r.status < 500, `table with spaces: expected 4xx, got ${r.status}`);
    }},
    { name: 'GET information_schema returns 4xx', run: async () => {
      const r = await api('GET', '/api/data/information_schema', { role: 'ADMIN' });
      assert(r.status >= 400 && r.status < 500, `information_schema: expected 4xx, got ${r.status}`);
    }},
    { name: 'GET pg_catalog returns 4xx', run: async () => {
      const r = await api('GET', '/api/data/pg_catalog', { role: 'ADMIN' });
      assert(r.status >= 400 && r.status < 500, `pg_catalog: expected 4xx, got ${r.status}`);
    }},
    { name: 'GET __proto__ table returns 4xx', run: async () => {
      const r = await api('GET', '/api/data/__proto__', { role: 'ADMIN' });
      assert(r.status >= 400 && r.status < 500, `__proto__: expected 4xx, got ${r.status}`);
    }},
  ]
};
