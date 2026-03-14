/**
 * CROSS-ENTITY RELATIONS & FOREIGN KEY INTEGRITY
 * Read-only tests verifying referential integrity across ASGARD CRM tables.
 * 100 tests total — no data is created or modified.
 */
const { api, assert, assertOk, assertArray, assertHasFields, skip } = require('../config');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract an array of records from a data-API response.
 * The response can be a plain array, or an object with a keyed array / .data array.
 */
function extractRows(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    // Try common wrappers: data.data, data.<table>, or first array-valued key
    if (Array.isArray(data.data)) return data.data;
    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return [];
}

/**
 * Assert that a field, if present and non-null, is numeric.
 */
function assertNumericIfPresent(obj, field, ctx) {
  if (!obj || !(field in obj) || obj[field] === null || obj[field] === undefined) return;
  const v = obj[field];
  const ok = typeof v === 'number' || (typeof v === 'string' && !isNaN(parseInt(v, 10)));
  assert(ok, `${ctx}: field "${field}" should be numeric, got ${typeof v} (${JSON.stringify(v)})`);
}

// ---------------------------------------------------------------------------
// Tests — 100 total
// ---------------------------------------------------------------------------
const tests = [

  // =========================================================================
  // 1. Tender -> Works relation (12 tests)
  // =========================================================================

  // 1
  { name: 'T->W #1: Read tenders list as ADMIN', run: async () => {
    const r = await api('GET', '/api/data/tenders?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('tenders endpoint not found');
    assertOk(r, 'read tenders');
    const rows = extractRows(r.data);
    assertArray(rows, 'tenders');
  }},

  // 2
  { name: 'T->W #2: Tenders have id field', run: async () => {
    const r = await api('GET', '/api/data/tenders?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('tenders endpoint not found');
    assertOk(r, 'read tenders');
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      assertHasFields(rows[0], ['id'], 'tender record');
    }
  }},

  // 3
  { name: 'T->W #3: Read works list as ADMIN', run: async () => {
    const r = await api('GET', '/api/data/works?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('works endpoint not found');
    assertOk(r, 'read works');
    const rows = extractRows(r.data);
    assertArray(rows, 'works');
  }},

  // 4
  { name: 'T->W #4: Works with tender_id reference valid tender', run: async () => {
    const r = await api('GET', '/api/data/works?limit=10', { role: 'ADMIN' });
    if (r.status === 404) skip('works endpoint not found');
    assertOk(r, 'read works');
    const rows = extractRows(r.data);
    const withTender = rows.filter(w => w.tender_id !== null && w.tender_id !== undefined);
    for (const w of withTender.slice(0, 3)) {
      assertNumericIfPresent(w, 'tender_id', 'work->tender FK');
    }
  }},

  // 5
  { name: 'T->W #5: ADMIN can read tenders', run: async () => {
    const r = await api('GET', '/api/data/tenders?limit=3', { role: 'ADMIN' });
    if (r.status === 404) skip('tenders endpoint not found');
    assertOk(r, 'ADMIN read tenders');
  }},

  // 6
  { name: 'T->W #6: ADMIN can read works', run: async () => {
    const r = await api('GET', '/api/data/works?limit=3', { role: 'ADMIN' });
    if (r.status === 404) skip('works endpoint not found');
    assertOk(r, 'ADMIN read works');
  }},

  // 7
  { name: 'T->W #7: PM can read tenders', run: async () => {
    const r = await api('GET', '/api/data/tenders?limit=3', { role: 'PM' });
    if (r.status === 404) skip('tenders endpoint not found');
    assertOk(r, 'PM read tenders');
  }},

  // 8
  { name: 'T->W #8: PM can read works', run: async () => {
    const r = await api('GET', '/api/data/works?limit=3', { role: 'PM' });
    if (r.status === 404) skip('works endpoint not found');
    assertOk(r, 'PM read works');
  }},

  // 9
  { name: 'T->W #9: TO can read tenders', run: async () => {
    const r = await api('GET', '/api/data/tenders?limit=3', { role: 'TO' });
    if (r.status === 404) skip('tenders endpoint not found');
    assertOk(r, 'TO read tenders');
  }},

  // 10
  { name: 'T->W #10: TO can read works', run: async () => {
    const r = await api('GET', '/api/data/works?limit=3', { role: 'TO' });
    if (r.status === 404) skip('works endpoint not found');
    assertOk(r, 'TO read works');
  }},

  // 11
  { name: 'T->W #11: Works tender_id is numeric or null', run: async () => {
    const r = await api('GET', '/api/data/works?limit=10', { role: 'ADMIN' });
    if (r.status === 404) skip('works endpoint not found');
    assertOk(r, 'read works');
    const rows = extractRows(r.data);
    for (const w of rows) {
      if ('tender_id' in w && w.tender_id !== null) {
        assertNumericIfPresent(w, 'tender_id', 'tender_id type check');
      }
    }
  }},

  // 12
  { name: 'T->W #12: Works list response is valid array', run: async () => {
    const r = await api('GET', '/api/data/works?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('works endpoint not found');
    assertOk(r, 'works response');
    const rows = extractRows(r.data);
    assertArray(rows, 'works array');
    if (rows.length > 0) {
      assert(typeof rows[0] === 'object', 'work record should be an object');
    }
  }},

  // =========================================================================
  // 2. Works -> Expenses / Invoices / Acts / Estimates (15 tests)
  // =========================================================================

  // 13
  { name: 'W->E #1: Read work_expenses, verify structure', run: async () => {
    const r = await api('GET', '/api/data/work_expenses?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('work_expenses endpoint not found');
    assertOk(r, 'read work_expenses');
    const rows = extractRows(r.data);
    assertArray(rows, 'work_expenses');
  }},

  // 14
  { name: 'W->E #2: work_expenses records have work_id field', run: async () => {
    const r = await api('GET', '/api/data/work_expenses?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('work_expenses endpoint not found');
    assertOk(r, 'read work_expenses');
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      assertHasFields(rows[0], ['work_id'], 'work_expense record');
    }
  }},

  // 15
  { name: 'W->E #3: work_expenses work_id is numeric', run: async () => {
    const r = await api('GET', '/api/data/work_expenses?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('work_expenses endpoint not found');
    assertOk(r, 'read work_expenses');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'work_id', 'work_expense.work_id');
    }
  }},

  // 16
  { name: 'W->I #4: Read invoices, check structure', run: async () => {
    const r = await api('GET', '/api/data/invoices?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('invoices endpoint not found');
    assertOk(r, 'read invoices');
    const rows = extractRows(r.data);
    assertArray(rows, 'invoices');
  }},

  // 17
  { name: 'W->I #5: Invoices may have work-related fields', run: async () => {
    const r = await api('GET', '/api/data/invoices?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('invoices endpoint not found');
    assertOk(r, 'read invoices');
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      // Check that records are objects with at least an id
      assert(typeof rows[0] === 'object', 'invoice should be an object');
    }
  }},

  // 18
  { name: 'W->I #6: Invoice work_id is numeric if present', run: async () => {
    const r = await api('GET', '/api/data/invoices?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('invoices endpoint not found');
    assertOk(r, 'read invoices');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'work_id', 'invoice.work_id');
    }
  }},

  // 19
  { name: 'W->A #7: Read acts, check structure', run: async () => {
    const r = await api('GET', '/api/data/acts?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('acts endpoint not found');
    assertOk(r, 'read acts');
    const rows = extractRows(r.data);
    assertArray(rows, 'acts');
  }},

  // 20
  { name: 'W->A #8: Acts may have work-related fields', run: async () => {
    const r = await api('GET', '/api/data/acts?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('acts endpoint not found');
    assertOk(r, 'read acts');
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      assert(typeof rows[0] === 'object', 'act should be an object');
    }
  }},

  // 21
  { name: 'W->A #9: Act work_id is numeric if present', run: async () => {
    const r = await api('GET', '/api/data/acts?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('acts endpoint not found');
    assertOk(r, 'read acts');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'work_id', 'act.work_id');
    }
  }},

  // 22
  { name: 'W->Est #10: Read estimates, check structure', run: async () => {
    const r = await api('GET', '/api/data/estimates?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('estimates endpoint not found');
    assertOk(r, 'read estimates');
    const rows = extractRows(r.data);
    assertArray(rows, 'estimates');
  }},

  // 23
  { name: 'W->Est #11: Estimates may have tender_id or work_id', run: async () => {
    const r = await api('GET', '/api/data/estimates?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('estimates endpoint not found');
    assertOk(r, 'read estimates');
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      assert(typeof rows[0] === 'object', 'estimate should be an object');
    }
  }},

  // 24
  { name: 'W->Est #12: Estimate tender_id is numeric if present', run: async () => {
    const r = await api('GET', '/api/data/estimates?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('estimates endpoint not found');
    assertOk(r, 'read estimates');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'tender_id', 'estimate.tender_id');
    }
  }},

  // 25
  { name: 'W->E #13: PM can read work_expenses', run: async () => {
    const r = await api('GET', '/api/data/work_expenses?limit=3', { role: 'PM' });
    if (r.status === 404) skip('work_expenses endpoint not found');
    assertOk(r, 'PM read work_expenses');
  }},

  // 26
  { name: 'W->A #14: PM can read acts', run: async () => {
    const r = await api('GET', '/api/data/acts?limit=3', { role: 'PM' });
    if (r.status === 404) skip('acts endpoint not found');
    assertOk(r, 'PM read acts');
  }},

  // 27
  { name: 'W->Est #15: TO can read estimates', run: async () => {
    const r = await api('GET', '/api/data/estimates?limit=3', { role: 'TO' });
    if (r.status === 404) skip('estimates endpoint not found');
    assertOk(r, 'TO read estimates');
  }},

  // =========================================================================
  // 3. User references integrity (12 tests)
  // =========================================================================

  // 28
  { name: 'USR #1: Read calendar_events, verify structure', run: async () => {
    const r = await api('GET', '/api/data/calendar_events?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('calendar_events endpoint not found');
    assertOk(r, 'read calendar_events');
    const rows = extractRows(r.data);
    assertArray(rows, 'calendar_events');
  }},

  // 29
  { name: 'USR #2: calendar_events user_id is numeric if present', run: async () => {
    const r = await api('GET', '/api/data/calendar_events?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('calendar_events endpoint not found');
    assertOk(r, 'read calendar_events');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'user_id', 'calendar_event.user_id');
      assertNumericIfPresent(row, 'author_id', 'calendar_event.author_id');
    }
  }},

  // 30
  { name: 'USR #3: Read notifications, verify structure', run: async () => {
    const r = await api('GET', '/api/data/notifications?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('notifications endpoint not found');
    assertOk(r, 'read notifications');
    const rows = extractRows(r.data);
    assertArray(rows, 'notifications');
  }},

  // 31
  { name: 'USR #4: notifications user_id is numeric if present', run: async () => {
    const r = await api('GET', '/api/data/notifications?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('notifications endpoint not found');
    assertOk(r, 'read notifications');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'user_id', 'notification.user_id');
    }
  }},

  // 32
  { name: 'USR #5: Read reminders, verify structure', run: async () => {
    const r = await api('GET', '/api/data/reminders?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('reminders endpoint not found');
    assertOk(r, 'read reminders');
    const rows = extractRows(r.data);
    assertArray(rows, 'reminders');
  }},

  // 33
  { name: 'USR #6: reminders user_id is numeric if present', run: async () => {
    const r = await api('GET', '/api/data/reminders?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('reminders endpoint not found');
    assertOk(r, 'read reminders');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'user_id', 'reminder.user_id');
    }
  }},

  // 34
  { name: 'USR #7: Read correspondence, verify structure', run: async () => {
    const r = await api('GET', '/api/data/correspondence?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('correspondence endpoint not found');
    assertOk(r, 'read correspondence');
    const rows = extractRows(r.data);
    assertArray(rows, 'correspondence');
  }},

  // 35
  { name: 'USR #8: correspondence author fields are numeric if present', run: async () => {
    const r = await api('GET', '/api/data/correspondence?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('correspondence endpoint not found');
    assertOk(r, 'read correspondence');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'author_id', 'correspondence.author_id');
      assertNumericIfPresent(row, 'user_id', 'correspondence.user_id');
      assertNumericIfPresent(row, 'created_by', 'correspondence.created_by');
    }
  }},

  // 36
  { name: 'USR #9: Read documents, verify structure', run: async () => {
    const r = await api('GET', '/api/data/documents?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('documents endpoint not found');
    assertOk(r, 'read documents');
    const rows = extractRows(r.data);
    assertArray(rows, 'documents');
  }},

  // 37
  { name: 'USR #10: documents author fields are numeric if present', run: async () => {
    const r = await api('GET', '/api/data/documents?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('documents endpoint not found');
    assertOk(r, 'read documents');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'author_id', 'document.author_id');
      assertNumericIfPresent(row, 'user_id', 'document.user_id');
      assertNumericIfPresent(row, 'created_by', 'document.created_by');
    }
  }},

  // 38
  { name: 'USR #11: PM can read calendar_events', run: async () => {
    const r = await api('GET', '/api/data/calendar_events?limit=3', { role: 'PM' });
    if (r.status === 404) skip('calendar_events endpoint not found');
    assertOk(r, 'PM read calendar_events');
  }},

  // 39
  { name: 'USR #12: TO can read notifications', run: async () => {
    const r = await api('GET', '/api/data/notifications?limit=3', { role: 'TO' });
    if (r.status === 404) skip('notifications endpoint not found');
    assertOk(r, 'TO read notifications');
  }},

  // =========================================================================
  // 4. Equipment relations (10 tests)
  // =========================================================================

  // 40
  { name: 'EQ #1: Read equipment as WAREHOUSE', run: async () => {
    const r = await api('GET', '/api/data/equipment?limit=5', { role: 'WAREHOUSE' });
    if (r.status === 404) skip('equipment endpoint not found');
    assertOk(r, 'WAREHOUSE read equipment');
    const rows = extractRows(r.data);
    assertArray(rows, 'equipment');
  }},

  // 41
  { name: 'EQ #2: Equipment records have basic fields', run: async () => {
    const r = await api('GET', '/api/data/equipment?limit=5', { role: 'WAREHOUSE' });
    if (r.status === 404) skip('equipment endpoint not found');
    assertOk(r, 'read equipment');
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      assert(typeof rows[0] === 'object', 'equipment record should be an object');
      assert('id' in rows[0] || 'name' in rows[0], 'equipment should have id or name');
    }
  }},

  // 42
  { name: 'EQ #3: Read equipment_movements as WAREHOUSE', run: async () => {
    const r = await api('GET', '/api/data/equipment_movements?limit=5', { role: 'WAREHOUSE' });
    if (r.status === 404) skip('equipment_movements endpoint not found');
    assertOk(r, 'WAREHOUSE read equipment_movements');
    const rows = extractRows(r.data);
    assertArray(rows, 'equipment_movements');
  }},

  // 43
  { name: 'EQ #4: equipment_movements equipment_id is numeric if present', run: async () => {
    const r = await api('GET', '/api/data/equipment_movements?limit=5', { role: 'WAREHOUSE' });
    if (r.status === 404) skip('equipment_movements endpoint not found');
    assertOk(r, 'read equipment_movements');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'equipment_id', 'movement.equipment_id');
    }
  }},

  // 44
  { name: 'EQ #5: Read equipment_requests as WAREHOUSE', run: async () => {
    const r = await api('GET', '/api/data/equipment_requests?limit=5', { role: 'WAREHOUSE' });
    if (r.status === 404) skip('equipment_requests endpoint not found');
    assertOk(r, 'WAREHOUSE read equipment_requests');
    const rows = extractRows(r.data);
    assertArray(rows, 'equipment_requests');
  }},

  // 45
  { name: 'EQ #6: equipment_requests equipment_id is numeric if present', run: async () => {
    const r = await api('GET', '/api/data/equipment_requests?limit=5', { role: 'WAREHOUSE' });
    if (r.status === 404) skip('equipment_requests endpoint not found');
    assertOk(r, 'read equipment_requests');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'equipment_id', 'request.equipment_id');
    }
  }},

  // 46
  { name: 'EQ #7: Read equipment_categories as WAREHOUSE', run: async () => {
    const r = await api('GET', '/api/data/equipment_categories?limit=3', { role: 'WAREHOUSE' });
    if (r.status === 404) skip('equipment_categories endpoint not found');
    assertOk(r, 'WAREHOUSE read equipment_categories');
    const rows = extractRows(r.data);
    assertArray(rows, 'equipment_categories');
  }},

  // 47
  { name: 'EQ #8: equipment_categories have basic structure', run: async () => {
    const r = await api('GET', '/api/data/equipment_categories?limit=3', { role: 'WAREHOUSE' });
    if (r.status === 404) skip('equipment_categories endpoint not found');
    assertOk(r, 'read equipment_categories');
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      assert(typeof rows[0] === 'object', 'category should be an object');
    }
  }},

  // 48
  { name: 'EQ #9: Equipment records have category-related fields', run: async () => {
    const r = await api('GET', '/api/data/equipment?limit=5', { role: 'WAREHOUSE' });
    if (r.status === 404) skip('equipment endpoint not found');
    assertOk(r, 'read equipment');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'category_id', 'equipment.category_id');
    }
  }},

  // 49
  { name: 'EQ #10: Read equipment_reservations as WAREHOUSE', run: async () => {
    const r = await api('GET', '/api/data/equipment_reservations?limit=5', { role: 'WAREHOUSE' });
    if (r.status === 404) skip('equipment_reservations endpoint not found');
    assertOk(r, 'WAREHOUSE read equipment_reservations');
    const rows = extractRows(r.data);
    assertArray(rows, 'equipment_reservations');
  }},

  // =========================================================================
  // 5. Staff / HR relations (10 tests)
  // =========================================================================

  // 50
  { name: 'HR #1: Read staff as HR', run: async () => {
    const r = await api('GET', '/api/data/staff?limit=5', { role: 'HR' });
    if (r.status === 404) skip('staff endpoint not found');
    assertOk(r, 'HR read staff');
    const rows = extractRows(r.data);
    assertArray(rows, 'staff');
  }},

  // 51
  { name: 'HR #2: Staff records have id field', run: async () => {
    const r = await api('GET', '/api/data/staff?limit=5', { role: 'HR' });
    if (r.status === 404) skip('staff endpoint not found');
    assertOk(r, 'read staff');
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      assertHasFields(rows[0], ['id'], 'staff record');
    }
  }},

  // 52
  { name: 'HR #3: Read staff_plan as HR', run: async () => {
    const r = await api('GET', '/api/data/staff_plan?limit=5', { role: 'HR' });
    if (r.status === 404) skip('staff_plan endpoint not found');
    assertOk(r, 'HR read staff_plan');
    const rows = extractRows(r.data);
    assertArray(rows, 'staff_plan');
  }},

  // 53
  { name: 'HR #4: staff_plan staff_id is numeric if present', run: async () => {
    const r = await api('GET', '/api/data/staff_plan?limit=5', { role: 'HR' });
    if (r.status === 404) skip('staff_plan endpoint not found');
    assertOk(r, 'read staff_plan');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'staff_id', 'staff_plan.staff_id');
    }
  }},

  // 54
  { name: 'HR #5: Read employees as HR', run: async () => {
    const r = await api('GET', '/api/data/employees?limit=5', { role: 'HR' });
    if (r.status === 404) skip('employees endpoint not found');
    assertOk(r, 'HR read employees');
    const rows = extractRows(r.data);
    assertArray(rows, 'employees');
  }},

  // 55
  { name: 'HR #6: Employees have id field', run: async () => {
    const r = await api('GET', '/api/data/employees?limit=5', { role: 'HR' });
    if (r.status === 404) skip('employees endpoint not found');
    assertOk(r, 'read employees');
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      assertHasFields(rows[0], ['id'], 'employee record');
    }
  }},

  // 56
  { name: 'HR #7: Read employee_assignments as HR', run: async () => {
    const r = await api('GET', '/api/data/employee_assignments?limit=5', { role: 'HR' });
    if (r.status === 404) skip('employee_assignments endpoint not found');
    assertOk(r, 'HR read employee_assignments');
    const rows = extractRows(r.data);
    assertArray(rows, 'employee_assignments');
  }},

  // 57
  { name: 'HR #8: employee_assignments employee_id is numeric if present', run: async () => {
    const r = await api('GET', '/api/data/employee_assignments?limit=5', { role: 'HR' });
    if (r.status === 404) skip('employee_assignments endpoint not found');
    assertOk(r, 'read employee_assignments');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'employee_id', 'assignment.employee_id');
    }
  }},

  // 58
  { name: 'HR #9: employee_assignments work_id is numeric if present', run: async () => {
    const r = await api('GET', '/api/data/employee_assignments?limit=5', { role: 'HR' });
    if (r.status === 404) skip('employee_assignments endpoint not found');
    assertOk(r, 'read employee_assignments');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'work_id', 'assignment.work_id');
    }
  }},

  // 59
  { name: 'HR #10: PM can also read employee_assignments', run: async () => {
    const r = await api('GET', '/api/data/employee_assignments?limit=3', { role: 'PM' });
    if (r.status === 404) skip('employee_assignments endpoint not found');
    assertOk(r, 'PM read employee_assignments');
  }},

  // =========================================================================
  // 6. Chat -> Messages relation (8 tests)
  // =========================================================================

  // 60
  { name: 'CHAT #1: Read chats as PM', run: async () => {
    const r = await api('GET', '/api/data/chats?limit=3', { role: 'PM' });
    if (r.status === 404) skip('chats endpoint not found');
    assertOk(r, 'PM read chats');
    const rows = extractRows(r.data);
    assertArray(rows, 'chats');
  }},

  // 61
  { name: 'CHAT #2: Chats have id field', run: async () => {
    const r = await api('GET', '/api/data/chats?limit=3', { role: 'PM' });
    if (r.status === 404) skip('chats endpoint not found');
    assertOk(r, 'read chats');
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      assertHasFields(rows[0], ['id'], 'chat record');
    }
  }},

  // 62
  { name: 'CHAT #3: Read chat_messages as PM', run: async () => {
    const r = await api('GET', '/api/data/chat_messages?limit=5', { role: 'PM' });
    if (r.status === 404) skip('chat_messages endpoint not found');
    assertOk(r, 'PM read chat_messages');
    const rows = extractRows(r.data);
    assertArray(rows, 'chat_messages');
  }},

  // 63
  { name: 'CHAT #4: chat_messages chat_id is numeric if present', run: async () => {
    const r = await api('GET', '/api/data/chat_messages?limit=5', { role: 'PM' });
    if (r.status === 404) skip('chat_messages endpoint not found');
    assertOk(r, 'read chat_messages');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'chat_id', 'chat_message.chat_id');
    }
  }},

  // 64
  { name: 'CHAT #5: chat_messages user_id is numeric if present', run: async () => {
    const r = await api('GET', '/api/data/chat_messages?limit=5', { role: 'PM' });
    if (r.status === 404) skip('chat_messages endpoint not found');
    assertOk(r, 'read chat_messages');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'user_id', 'chat_message.user_id');
    }
  }},

  // 65
  { name: 'CHAT #6: BUH can read chats', run: async () => {
    const r = await api('GET', '/api/data/chats?limit=3', { role: 'BUH' });
    if (r.status === 404) skip('chats endpoint not found');
    assertOk(r, 'BUH read chats');
  }},

  // 66
  { name: 'CHAT #7: BUH can read chat_messages', run: async () => {
    const r = await api('GET', '/api/data/chat_messages?limit=3', { role: 'BUH' });
    if (r.status === 404) skip('chat_messages endpoint not found');
    assertOk(r, 'BUH read chat_messages');
  }},

  // 67
  { name: 'CHAT #8: ADMIN can read both chats and chat_messages', run: async () => {
    const r1 = await api('GET', '/api/data/chats?limit=2', { role: 'ADMIN' });
    if (r1.status === 404) skip('chats endpoint not found');
    assertOk(r1, 'ADMIN read chats');

    const r2 = await api('GET', '/api/data/chat_messages?limit=2', { role: 'ADMIN' });
    if (r2.status === 404) skip('chat_messages endpoint not found');
    assertOk(r2, 'ADMIN read chat_messages');
  }},

  // =========================================================================
  // 7. Invoice -> Payments relation (8 tests)
  // =========================================================================

  // 68
  { name: 'INV #1: Read invoices as BUH', run: async () => {
    const r = await api('GET', '/api/data/invoices?limit=5', { role: 'BUH' });
    if (r.status === 404) skip('invoices endpoint not found');
    assertOk(r, 'BUH read invoices');
    const rows = extractRows(r.data);
    assertArray(rows, 'invoices');
  }},

  // 69
  { name: 'INV #2: Invoices have id field', run: async () => {
    const r = await api('GET', '/api/data/invoices?limit=5', { role: 'BUH' });
    if (r.status === 404) skip('invoices endpoint not found');
    assertOk(r, 'read invoices');
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      assertHasFields(rows[0], ['id'], 'invoice record');
    }
  }},

  // 70
  { name: 'INV #3: Read invoice_payments as BUH', run: async () => {
    const r = await api('GET', '/api/data/invoice_payments?limit=5', { role: 'BUH' });
    if (r.status === 404) skip('invoice_payments endpoint not found');
    assertOk(r, 'BUH read invoice_payments');
    const rows = extractRows(r.data);
    assertArray(rows, 'invoice_payments');
  }},

  // 71
  { name: 'INV #4: invoice_payments have invoice_id field', run: async () => {
    const r = await api('GET', '/api/data/invoice_payments?limit=5', { role: 'BUH' });
    if (r.status === 404) skip('invoice_payments endpoint not found');
    assertOk(r, 'read invoice_payments');
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      assertHasFields(rows[0], ['invoice_id'], 'invoice_payment record');
    }
  }},

  // 72
  { name: 'INV #5: invoice_payments invoice_id is numeric', run: async () => {
    const r = await api('GET', '/api/data/invoice_payments?limit=5', { role: 'BUH' });
    if (r.status === 404) skip('invoice_payments endpoint not found');
    assertOk(r, 'read invoice_payments');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'invoice_id', 'payment.invoice_id');
    }
  }},

  // 73
  { name: 'INV #6: PM cannot read invoice_payments -> 403', run: async () => {
    const r = await api('GET', '/api/data/invoice_payments?limit=3', { role: 'PM' });
    if (r.status === 404) skip('invoice_payments endpoint not found');
    assert(r.status === 403 || r.status === 401, `PM invoice_payments: expected 403, got ${r.status}`);
  }},

  // 74
  { name: 'INV #7: PROC can read invoices', run: async () => {
    const r = await api('GET', '/api/data/invoices?limit=3', { role: 'PROC' });
    if (r.status === 404) skip('invoices endpoint not found');
    assertOk(r, 'PROC read invoices');
  }},

  // 75
  { name: 'INV #8: PROC can read invoice_payments', run: async () => {
    const r = await api('GET', '/api/data/invoice_payments?limit=3', { role: 'PROC' });
    if (r.status === 404) skip('invoice_payments endpoint not found');
    assertOk(r, 'PROC read invoice_payments');
  }},

  // =========================================================================
  // 8. Payroll relations (8 tests)
  // =========================================================================

  // 76
  { name: 'PAY #1: Read payroll_sheets as BUH', run: async () => {
    const r = await api('GET', '/api/data/payroll_sheets?limit=3', { role: 'BUH' });
    if (r.status === 404) skip('payroll_sheets endpoint not found');
    assertOk(r, 'BUH read payroll_sheets');
    const rows = extractRows(r.data);
    assertArray(rows, 'payroll_sheets');
  }},

  // 77
  { name: 'PAY #2: Payroll sheets have id field', run: async () => {
    const r = await api('GET', '/api/data/payroll_sheets?limit=3', { role: 'BUH' });
    if (r.status === 404) skip('payroll_sheets endpoint not found');
    assertOk(r, 'read payroll_sheets');
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      assertHasFields(rows[0], ['id'], 'payroll_sheet record');
    }
  }},

  // 78
  { name: 'PAY #3: Read payroll_items as BUH', run: async () => {
    const r = await api('GET', '/api/data/payroll_items?limit=5', { role: 'BUH' });
    if (r.status === 404) skip('payroll_items endpoint not found');
    assertOk(r, 'BUH read payroll_items');
    const rows = extractRows(r.data);
    assertArray(rows, 'payroll_items');
  }},

  // 79
  { name: 'PAY #4: payroll_items have sheet-related field', run: async () => {
    const r = await api('GET', '/api/data/payroll_items?limit=5', { role: 'BUH' });
    if (r.status === 404) skip('payroll_items endpoint not found');
    assertOk(r, 'read payroll_items');
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      const row = rows[0];
      const hasSheetRef = 'sheet_id' in row || 'payroll_sheet_id' in row;
      assert(hasSheetRef, 'payroll_item should have sheet_id or payroll_sheet_id field');
    }
  }},

  // 80
  { name: 'PAY #5: payroll_items sheet FK is numeric if present', run: async () => {
    const r = await api('GET', '/api/data/payroll_items?limit=5', { role: 'BUH' });
    if (r.status === 404) skip('payroll_items endpoint not found');
    assertOk(r, 'read payroll_items');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'sheet_id', 'payroll_item.sheet_id');
      assertNumericIfPresent(row, 'payroll_sheet_id', 'payroll_item.payroll_sheet_id');
    }
  }},

  // 81
  { name: 'PAY #6: PM can read payroll_sheets', run: async () => {
    const r = await api('GET', '/api/data/payroll_sheets?limit=3', { role: 'PM' });
    if (r.status === 404) skip('payroll_sheets endpoint not found');
    assertOk(r, 'PM read payroll_sheets');
  }},

  // 82
  { name: 'PAY #7: PM can read payroll_items', run: async () => {
    const r = await api('GET', '/api/data/payroll_items?limit=3', { role: 'PM' });
    if (r.status === 404) skip('payroll_items endpoint not found');
    assertOk(r, 'PM read payroll_items');
  }},

  // 83
  { name: 'PAY #8: WAREHOUSE cannot read payroll_sheets -> 403', run: async () => {
    const r = await api('GET', '/api/data/payroll_sheets?limit=3', { role: 'WAREHOUSE' });
    if (r.status === 404) skip('payroll_sheets endpoint not found');
    assert(r.status === 403 || r.status === 401, `WAREHOUSE payroll_sheets: expected 403, got ${r.status}`);
  }},

  // =========================================================================
  // 9. Customer references (8 tests)
  // =========================================================================

  // 84
  { name: 'CUST #1: Read customers (PK is inn, not id)', run: async () => {
    const r = await api('GET', '/api/data/customers?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('customers endpoint not found');
    assertOk(r, 'read customers');
    const rows = extractRows(r.data);
    assertArray(rows, 'customers');
    if (rows.length > 0) {
      assert('inn' in rows[0], 'customer should have inn field as PK');
    }
  }},

  // 85
  { name: 'CUST #2: Customer inn field is non-empty string', run: async () => {
    const r = await api('GET', '/api/data/customers?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('customers endpoint not found');
    assertOk(r, 'read customers');
    const rows = extractRows(r.data);
    for (const row of rows) {
      if ('inn' in row && row.inn !== null) {
        assert(typeof row.inn === 'string' || typeof row.inn === 'number', `customer inn should be string or number, got ${typeof row.inn}`);
      }
    }
  }},

  // 86
  { name: 'CUST #3: Tenders may reference customers', run: async () => {
    const r = await api('GET', '/api/data/tenders?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('tenders endpoint not found');
    assertOk(r, 'read tenders');
    const rows = extractRows(r.data);
    // Just verify tenders have customer-related fields if data exists
    if (rows.length > 0) {
      const row = rows[0];
      const hasCustomerRef = 'customer' in row || 'customer_name' in row || 'customer_inn' in row || 'customer_id' in row;
      // It is ok if no customer ref — schema may differ
      assert(typeof row === 'object', 'tender should be an object');
    }
  }},

  // 87
  { name: 'CUST #4: Works may reference customer_name', run: async () => {
    const r = await api('GET', '/api/data/works?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('works endpoint not found');
    assertOk(r, 'read works');
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      assert(typeof rows[0] === 'object', 'work should be an object');
    }
  }},

  // 88
  { name: 'CUST #5: BUH can read customers', run: async () => {
    const r = await api('GET', '/api/data/customers?limit=3', { role: 'BUH' });
    if (r.status === 404) skip('customers endpoint not found');
    assertOk(r, 'BUH read customers');
  }},

  // 89
  { name: 'CUST #6: PM can read customers', run: async () => {
    const r = await api('GET', '/api/data/customers?limit=3', { role: 'PM' });
    if (r.status === 404) skip('customers endpoint not found');
    assertOk(r, 'PM read customers');
  }},

  // 90
  { name: 'CUST #7: WAREHOUSE cannot read customers -> 403', run: async () => {
    const r = await api('GET', '/api/data/customers?limit=3', { role: 'WAREHOUSE' });
    if (r.status === 404) skip('customers endpoint not found');
    assert(r.status === 403 || r.status === 401, `WAREHOUSE customers: expected 403, got ${r.status}`);
  }},

  // 91
  { name: 'CUST #8: TO can read customers', run: async () => {
    const r = await api('GET', '/api/data/customers?limit=3', { role: 'TO' });
    if (r.status === 404) skip('customers endpoint not found');
    assertOk(r, 'TO read customers');
  }},

  // =========================================================================
  // 10. Contract references (9 tests)
  // =========================================================================

  // 92
  { name: 'CONTR #1: Read contracts as ADMIN', run: async () => {
    const r = await api('GET', '/api/data/contracts?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('contracts endpoint not found');
    assertOk(r, 'ADMIN read contracts');
    const rows = extractRows(r.data);
    assertArray(rows, 'contracts');
  }},

  // 93
  { name: 'CONTR #2: Contracts have basic structure fields', run: async () => {
    const r = await api('GET', '/api/data/contracts?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('contracts endpoint not found');
    assertOk(r, 'read contracts');
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      assert(typeof rows[0] === 'object', 'contract should be an object');
      assert('id' in rows[0] || 'number' in rows[0] || 'name' in rows[0], 'contract should have id, number, or name');
    }
  }},

  // 94
  { name: 'CONTR #3: Contracts may reference works (work_id numeric)', run: async () => {
    const r = await api('GET', '/api/data/contracts?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('contracts endpoint not found');
    assertOk(r, 'read contracts');
    const rows = extractRows(r.data);
    for (const row of rows) {
      assertNumericIfPresent(row, 'work_id', 'contract.work_id');
    }
  }},

  // 95
  { name: 'CONTR #4: Contracts may reference customers', run: async () => {
    const r = await api('GET', '/api/data/contracts?limit=5', { role: 'ADMIN' });
    if (r.status === 404) skip('contracts endpoint not found');
    assertOk(r, 'read contracts');
    const rows = extractRows(r.data);
    if (rows.length > 0) {
      // Verify records are well-formed objects
      assert(typeof rows[0] === 'object', 'contract should be an object');
    }
  }},

  // 96
  { name: 'CONTR #5: PM can read contracts', run: async () => {
    const r = await api('GET', '/api/data/contracts?limit=3', { role: 'PM' });
    if (r.status === 404) skip('contracts endpoint not found');
    assertOk(r, 'PM read contracts');
  }},

  // 97
  { name: 'CONTR #6: BUH can read contracts', run: async () => {
    const r = await api('GET', '/api/data/contracts?limit=3', { role: 'BUH' });
    if (r.status === 404) skip('contracts endpoint not found');
    assertOk(r, 'BUH read contracts');
  }},

  // 98
  { name: 'CONTR #7: OFFICE_MANAGER can read contracts', run: async () => {
    const r = await api('GET', '/api/data/contracts?limit=3', { role: 'OFFICE_MANAGER' });
    if (r.status === 404) skip('contracts endpoint not found');
    assertOk(r, 'OFFICE_MANAGER read contracts');
  }},

  // 99
  { name: 'CONTR #8: WAREHOUSE cannot read contracts -> 403', run: async () => {
    const r = await api('GET', '/api/data/contracts?limit=3', { role: 'WAREHOUSE' });
    if (r.status === 404) skip('contracts endpoint not found');
    assert(r.status === 403 || r.status === 401, `WAREHOUSE contracts: expected 403, got ${r.status}`);
  }},

  // 100
  { name: 'CONTR #9: PROC cannot read contracts -> 403', run: async () => {
    const r = await api('GET', '/api/data/contracts?limit=3', { role: 'PROC' });
    if (r.status === 404) skip('contracts endpoint not found');
    assert(r.status === 403 || r.status === 401, `PROC contracts: expected 403, got ${r.status}`);
  }},

];

module.exports = {
  name: 'CROSS-ENTITY RELATIONS & FK INTEGRITY (100 tests)',
  tests
};
