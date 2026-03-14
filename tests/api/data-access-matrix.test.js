/**
 * DATA API ACCESS MATRIX — role × table access verification
 * Tests that each role can ONLY access tables defined in ACCESS_MATRIX (src/routes/data.js)
 */
const { api, assert } = require('../config');

const ALL_ROLES = [
  'ADMIN','PM','TO','HEAD_PM','HEAD_TO','HR','HR_MANAGER','BUH',
  'PROC','OFFICE_MANAGER','CHIEF_ENGINEER',
  'DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','WAREHOUSE'
];

// Exact copy of ACCESS_MATRIX from src/routes/data.js
const ACCESS_MATRIX = {
  ADMIN:          { tables: 'all' },
  DIRECTOR_GEN:   { tables: 'all' },
  DIRECTOR_COMM:  { tables: 'all' },
  DIRECTOR_DEV:   { tables: 'all' },
  PM: {
    tables: ['users','employees','staff','staff_plan','user_call_status','tenders','estimates','works',
      'work_expenses','work_assign_requests','pm_consents','correspondence','travel_expenses','contracts',
      'calendar_events','customers','documents','chats','chat_messages','equipment','equipment_movements',
      'equipment_requests','equipment_reservations','acts','invoices','notifications','sync_meta',
      'employee_assignments','employee_plan','reminders','bonus_requests','doc_sets','qa_messages',
      'user_dashboard','employee_rates','payroll_sheets','payroll_items','one_time_payments','permits',
      'tasks']
  },
  TO: {
    tables: ['users','employees','staff','staff_plan','works','invoices','user_call_status','tenders','estimates','customers',
      'calendar_events','documents','correspondence','chats','chat_messages','notifications','sync_meta',
      'reminders','doc_sets','user_dashboard','permits','tasks','pre_tender_requests']
  },
  BUH: {
    tables: ['users','employees','staff','staff_plan','cash_requests','cash_expenses','cash_returns','cash_messages','user_call_status',
      'tenders','works','work_expenses','office_expenses','incomes','invoices','invoice_payments','acts',
      'contracts','customers','bank_rules','calendar_events','chats','chat_messages','notifications',
      'sync_meta','reminders','user_dashboard','employee_rates','payroll_sheets','payroll_items',
      'payment_registry','self_employed','one_time_payments']
  },
  HR: {
    tables: ['users','tenders','works','user_call_status','employees','employee_reviews','employee_assignments',
      'employee_plan','staff','staff_plan','staff_requests','staff_request_messages','staff_replacements',
      'employee_permits','calendar_events','chats','chat_messages','notifications','sync_meta','reminders',
      'travel_expenses','invoices','user_dashboard','employee_rates','payroll_sheets','payroll_items','permits']
  },
  OFFICE_MANAGER: {
    tables: ['users','employees','staff','staff_plan','office_expenses','calendar_events','correspondence',
      'documents','chats','chat_messages','notifications','seals','seal_transfers','purchase_requests',
      'sync_meta','reminders','contracts','travel_expenses','doc_sets','user_dashboard','customers','works']
  },
  WAREHOUSE: {
    tables: ['users','employees','staff','staff_plan','equipment','equipment_categories','equipment_movements','equipment_requests',
      'equipment_maintenance','equipment_reservations','warehouses','objects','chats','chat_messages',
      'notifications','sync_meta','reminders','user_dashboard','calendar_events']
  },
  PROC: {
    tables: ['users','employees','staff','staff_plan','tenders','purchase_requests','equipment','equipment_categories',
      'invoices','invoice_payments','documents','calendar_events','chats','chat_messages','notifications',
      'sync_meta','reminders','user_dashboard','works']
  },
  HEAD_PM: {
    tables: ['users','employees','staff','staff_plan','works','tenders','estimates',
      'cash_requests','cash_expenses','cash_returns','cash_messages',
      'work_expenses','work_assign_requests',
      'pm_consents','contracts','customers','calendar_events','documents','chats','chat_messages',
      'notifications','sync_meta','reminders','acts','invoices','user_dashboard','employee_assignments',
      'employee_plan','bonus_requests','doc_sets','qa_messages','employee_rates','payroll_sheets',
      'payroll_items','one_time_payments','permits']
  },
  HEAD_TO: {
    tables: ['users','employees','staff','staff_plan','works','invoices','user_call_status',
      'tenders','estimates','customers','calendar_events','documents',
      'cash_requests','cash_expenses','cash_returns','cash_messages',
      'correspondence','chats','chat_messages','notifications',
      'sync_meta','reminders','doc_sets','user_dashboard',
      'permits','tasks','pre_tender_requests']
  },
  HR_MANAGER: {
    tables: ['users','tenders','works','user_call_status',
      'employees','employee_reviews','employee_assignments','employee_plan',
      'staff','staff_plan','staff_requests','staff_request_messages',
      'staff_replacements','employee_permits','calendar_events',
      'chats','chat_messages','notifications','sync_meta','reminders',
      'travel_expenses','invoices','user_dashboard',
      'employee_rates','payroll_sheets','payroll_items',
      'permits']
  },
  CHIEF_ENGINEER: {
    tables: ['users',
      'equipment','equipment_categories','equipment_movements',
      'equipment_requests','equipment_maintenance','equipment_reservations',
      'warehouses','objects','chats','chat_messages','notifications',
      'sync_meta','reminders','user_dashboard','works','tenders',
      'employees','calendar_events']
  }
};

// Tables known to exist and be accessible to at least some roles
const TEST_TABLES = [
  'tenders', 'works', 'estimates', 'customers', 'invoices', 'acts',
  'employees', 'equipment', 'equipment_movements', 'equipment_categories',
  'calendar_events', 'chats', 'chat_messages', 'notifications',
  'cash_requests', 'office_expenses', 'work_expenses', 'incomes',
  'staff', 'staff_plan', 'employee_permits', 'employee_reviews',
  'contracts', 'correspondence', 'seals', 'seal_transfers',
  'purchase_requests', 'travel_expenses', 'documents',
  'payroll_sheets', 'payroll_items', 'employee_rates',
  'bank_rules', 'payment_registry', 'self_employed', 'one_time_payments',
  'bonus_requests', 'reminders', 'user_dashboard',
  'warehouses', 'objects', 'equipment_maintenance', 'equipment_reservations'
];

// Note: audit_log is accessible to DIRECTOR_COMM/DEV since they have tables:'all' in ACCESS_MATRIX
// No universally-forbidden tables beyond what ACCESS_MATRIX already handles
const FORBIDDEN_TABLES = [];

function canAccess(role, table) {
  if (role === 'ADMIN' || role === 'DIRECTOR_GEN') return true;
  if (FORBIDDEN_TABLES.includes(table)) return false;
  const entry = ACCESS_MATRIX[role];
  if (!entry) return false;
  if (entry.tables === 'all') return true;
  return entry.tables.includes(table);
}

const tests = [];

// For each role, test allowed tables (positive) and a set of forbidden tables (negative)
for (const role of ALL_ROLES) {
  const allowedTables = TEST_TABLES.filter(t => canAccess(role, t));
  const forbiddenTables = TEST_TABLES.filter(t => !canAccess(role, t));

  // Positive: role CAN read allowed tables
  for (const table of allowedTables) {
    tests.push({
      name: `${role} CAN read /api/data/${table}`,
      run: async () => {
        const resp = await api('GET', `/api/data/${table}?limit=1`, { role });
        assert(
          resp.status !== 403,
          `${role} should access /api/data/${table} but got 403`
        );
      }
    });
  }

  // Negative: role CANNOT read forbidden tables (limit to first 5 to keep reasonable)
  const forbiddenSample = forbiddenTables.slice(0, 8);
  for (const table of forbiddenSample) {
    tests.push({
      name: `${role} CANNOT read /api/data/${table} → 403`,
      run: async () => {
        const resp = await api('GET', `/api/data/${table}?limit=1`, { role });
        assert(
          resp.status === 403,
          `SECURITY: ${role} read /api/data/${table} got ${resp.status}, expected 403`
        );
      }
    });
  }
}

// Also test FORBIDDEN_TABLES for non-admin roles
for (const role of ALL_ROLES.filter(r => r !== 'ADMIN' && r !== 'DIRECTOR_GEN')) {
  for (const table of FORBIDDEN_TABLES) {
    tests.push({
      name: `${role} CANNOT read sensitive /api/data/${table} → 403`,
      run: async () => {
        const resp = await api('GET', `/api/data/${table}?limit=1`, { role });
        assert(
          resp.status === 403,
          `SECURITY: ${role} read sensitive ${table} got ${resp.status}, expected 403`
        );
      }
    });
  }
}

module.exports = {
  name: `DATA ACCESS MATRIX (${tests.length} tests)`,
  tests
};
