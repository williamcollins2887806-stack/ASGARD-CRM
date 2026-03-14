/**
 * Site Inspections — API Tests
 *
 * CRUD operations, status transitions, PDF generation,
 * email sending, role access control, and validation.
 *
 * Routes:
 *   GET/POST   /api/site-inspections
 *   GET/PUT    /api/site-inspections/:id
 *   PUT        /api/site-inspections/:id/status
 *   GET        /api/site-inspections/:id/pdf
 *   POST       /api/site-inspections/:id/send-email
 */

const { api, assert, assertOk, assertStatus, assertForbidden, skip, getToken, rawFetch, BASE_URL } = require('../config');
const gen = require('../lib/data-generator');

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function inspectionPayload(overrides = {}) {
  const id = gen.uid();
  return {
    object_name: `${gen.TEST_PREFIX}Object_${id}`,
    object_address: `${gen.TEST_PREFIX}Address_${id}`,
    customer_name: `${gen.TEST_PREFIX}Customer_${id}`,
    customer_contact_person: `${gen.TEST_PREFIX}Contact_${id}`,
    customer_contact_email: `test_${id}@example.com`,
    customer_contact_phone: gen.randomPhone(),
    inspection_dates: [
      { date: gen.futureDate(14), time_from: '09:00', time_to: '17:00' },
      { date: gen.futureDate(21), time_from: '10:00', time_to: '16:00' },
    ],
    employees_json: [
      { fio: `${gen.TEST_PREFIX}Employee_${id}`, position: 'Инженер', phone: gen.randomPhone() },
    ],
    vehicles_json: [
      { brand: 'Toyota', model: 'Hilux', plate_number: 'А123БВ77', driver_fio: `${gen.TEST_PREFIX}Driver_${id}` },
    ],
    notes: `Auto-test inspection ${id}`,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

const tests = [];
let createdInspectionId = null;

// ─── CRUD ────────────────────────────────────────────────────────────────

tests.push({
  name: 'PM creates a site inspection',
  run: async () => {
    const payload = inspectionPayload();
    const res = await api('POST', '/api/site-inspections', { role: 'PM', body: payload });
    if (res.status === 404) skip('site-inspections endpoint not available');
    assertOk(res, 'PM create inspection');
    assert(res.data && res.data.id, 'Response must contain id');
    createdInspectionId = res.data.id;
  },
});

tests.push({
  name: 'PM reads the created inspection',
  run: async () => {
    if (!createdInspectionId) skip('No inspection was created');
    const res = await api('GET', `/api/site-inspections/${createdInspectionId}`, { role: 'PM' });
    assertOk(res, 'PM read inspection');
    assert(res.data && (res.data.id === createdInspectionId || Number(res.data.id) === Number(createdInspectionId)), 'Returned ID must match');
    assert(res.data.object_name && res.data.object_name.includes(gen.TEST_PREFIX), 'object_name must contain test prefix');
    assert(res.data.status === 'draft', `Initial status must be draft, got '${res.data.status}'`);
  },
});

tests.push({
  name: 'PM updates the inspection',
  run: async () => {
    if (!createdInspectionId) skip('No inspection was created');
    const updatedNotes = `${gen.TEST_PREFIX}Updated_notes_${gen.uid()}`;
    const res = await api('PUT', `/api/site-inspections/${createdInspectionId}`, {
      role: 'PM',
      body: { notes: updatedNotes },
    });
    assertOk(res, 'PM update inspection');

    // Verify update persisted
    const verify = await api('GET', `/api/site-inspections/${createdInspectionId}`, { role: 'PM' });
    assertOk(verify, 'Verify update');
    assert(verify.data.notes === updatedNotes, `Notes must be updated, got '${verify.data.notes}'`);
  },
});

tests.push({
  name: 'PM lists site inspections',
  run: async () => {
    const res = await api('GET', '/api/site-inspections', { role: 'PM' });
    if (res.status === 404) skip('site-inspections endpoint not available');
    assertOk(res, 'PM list inspections');
    const items = Array.isArray(res.data) ? res.data : (res.data?.items || res.data?.rows || res.data?.data || []);
    assert(Array.isArray(items), 'Response must contain an array of inspections');
  },
});

// ─── Status transitions ─────────────────────────────────────────────────

tests.push({
  name: 'Valid transition: draft -> sent',
  run: async () => {
    if (!createdInspectionId) skip('No inspection was created');
    const res = await api('PUT', `/api/site-inspections/${createdInspectionId}/status`, {
      role: 'PM',
      body: { status: 'sent' },
    });
    assertOk(res, 'draft -> sent');

    const verify = await api('GET', `/api/site-inspections/${createdInspectionId}`, { role: 'PM' });
    assert(verify.data.status === 'sent', `Expected status 'sent', got '${verify.data.status}'`);
  },
});

tests.push({
  name: 'Valid transition: sent -> approved',
  run: async () => {
    if (!createdInspectionId) skip('No inspection was created');
    const res = await api('PUT', `/api/site-inspections/${createdInspectionId}/status`, {
      role: 'PM',
      body: { status: 'approved' },
    });
    assertOk(res, 'sent -> approved');

    const verify = await api('GET', `/api/site-inspections/${createdInspectionId}`, { role: 'PM' });
    assert(verify.data.status === 'approved', `Expected status 'approved', got '${verify.data.status}'`);
  },
});

tests.push({
  name: 'Valid transition: approved -> trip_planned',
  run: async () => {
    if (!createdInspectionId) skip('No inspection was created');
    const res = await api('PUT', `/api/site-inspections/${createdInspectionId}/status`, {
      role: 'PM',
      body: { status: 'trip_planned' },
    });
    assertOk(res, 'approved -> trip_planned');
  },
});

tests.push({
  name: 'Invalid transition: draft -> approved (must go through sent)',
  run: async () => {
    const payload = inspectionPayload();
    const create = await api('POST', '/api/site-inspections', { role: 'PM', body: payload });
    if (create.status === 404) skip('site-inspections endpoint not available');
    assertOk(create, 'Create fresh inspection');
    const freshId = create.data.id;

    const res = await api('PUT', `/api/site-inspections/${freshId}/status`, {
      role: 'PM',
      body: { status: 'approved' },
    });
    assert(res.status === 400 || res.status === 422, `Expected 400/422 for invalid transition, got ${res.status}`);
  },
});

tests.push({
  name: 'Invalid transition: draft -> completed (not allowed directly)',
  run: async () => {
    const payload = inspectionPayload();
    const create = await api('POST', '/api/site-inspections', { role: 'PM', body: payload });
    if (create.status === 404) skip('site-inspections endpoint not available');
    const freshId = create.data.id;

    const res = await api('PUT', `/api/site-inspections/${freshId}/status`, {
      role: 'PM',
      body: { status: 'completed' },
    });
    assert(res.status === 400 || res.status === 422, `Expected 400/422 for invalid transition, got ${res.status}`);
  },
});

tests.push({
  name: 'Valid transition: sent -> rejected -> draft (rejection cycle)',
  run: async () => {
    const payload = inspectionPayload();
    const create = await api('POST', '/api/site-inspections', { role: 'PM', body: payload });
    if (create.status === 404) skip('site-inspections endpoint not available');
    const freshId = create.data.id;

    // draft -> sent
    let res = await api('PUT', `/api/site-inspections/${freshId}/status`, {
      role: 'PM', body: { status: 'sent' },
    });
    assertOk(res, 'draft -> sent');

    // sent -> rejected
    res = await api('PUT', `/api/site-inspections/${freshId}/status`, {
      role: 'PM', body: { status: 'rejected' },
    });
    assertOk(res, 'sent -> rejected');

    // rejected -> draft
    res = await api('PUT', `/api/site-inspections/${freshId}/status`, {
      role: 'PM', body: { status: 'draft' },
    });
    assertOk(res, 'rejected -> draft');

    // Verify back in draft
    const verify = await api('GET', `/api/site-inspections/${freshId}`, { role: 'PM' });
    assert(verify.data.status === 'draft', `Expected 'draft' after rejection cycle, got '${verify.data.status}'`);
  },
});

// ─── Complete workflow: draft → sent → approved → trip_planned → completed ─

tests.push({
  name: 'Full workflow: draft -> sent -> approved -> trip_planned -> completed',
  run: async () => {
    const payload = inspectionPayload();
    const create = await api('POST', '/api/site-inspections', { role: 'PM', body: payload });
    if (create.status === 404) skip('site-inspections endpoint not available');
    assertOk(create, 'Create inspection for full workflow');
    const id = create.data.id;

    const transitions = ['sent', 'approved', 'trip_planned', 'completed'];
    for (const status of transitions) {
      const res = await api('PUT', `/api/site-inspections/${id}/status`, {
        role: 'PM', body: { status },
      });
      assertOk(res, `transition to ${status}`);
    }

    const verify = await api('GET', `/api/site-inspections/${id}`, { role: 'PM' });
    assert(verify.data.status === 'completed', `Expected 'completed', got '${verify.data.status}'`);
  },
});

// ─── PDF generation ─────────────────────────────────────────────────────

tests.push({
  name: 'PDF generation returns application/pdf',
  run: async () => {
    if (!createdInspectionId) skip('No inspection was created');
    const token = await getToken('PM');
    const resp = await rawFetch('GET', `/api/site-inspections/${createdInspectionId}/pdf`, { token });
    assertOk(resp, 'PDF endpoint');
    const contentType = resp.headers?.get?.('content-type') || resp.headers?.['content-type'] || '';
    assert(
      contentType.includes('application/pdf') || contentType.includes('octet-stream'),
      `Expected PDF content-type, got '${contentType}'`
    );
  },
});

// ─── Email sending ──────────────────────────────────────────────────────

tests.push({
  name: 'Send email for inspection',
  run: async () => {
    if (!createdInspectionId) skip('No inspection was created');
    const res = await api('POST', `/api/site-inspections/${createdInspectionId}/send-email`, {
      role: 'PM',
      body: {
        to: 'test@example.com',
        subject: `${gen.TEST_PREFIX}Test inspection email`,
        body: 'Auto-test email body for site inspection',
      },
    });
    assert(
      res.status === 200 || res.status === 201 || res.status === 202,
      `Expected 200/201/202 for send-email, got ${res.status}`
    );
  },
});

// ─── Role access control ────────────────────────────────────────────────

tests.push({
  name: 'OFFICE_MANAGER cannot create inspections',
  run: async () => {
    const payload = inspectionPayload();
    const res = await api('POST', '/api/site-inspections', { role: 'OFFICE_MANAGER', body: payload });
    if (res.status === 404) skip('site-inspections endpoint not available');
    assertForbidden(res, 'OFFICE_MANAGER create inspection');
  },
});

tests.push({
  name: 'OFFICE_MANAGER can read inspections',
  run: async () => {
    const res = await api('GET', '/api/site-inspections', { role: 'OFFICE_MANAGER' });
    if (res.status === 404) skip('site-inspections endpoint not available');
    assertOk(res, 'OFFICE_MANAGER read inspections');
  },
});

tests.push({
  name: 'ADMIN can create inspections',
  run: async () => {
    const payload = inspectionPayload();
    const res = await api('POST', '/api/site-inspections', { role: 'ADMIN', body: payload });
    if (res.status === 404) skip('site-inspections endpoint not available');
    assertOk(res, 'ADMIN create inspection');
    assert(res.data && res.data.id, 'ADMIN create must return id');
  },
});

tests.push({
  name: 'ADMIN can read all inspections',
  run: async () => {
    const res = await api('GET', '/api/site-inspections', { role: 'ADMIN' });
    if (res.status === 404) skip('site-inspections endpoint not available');
    assertOk(res, 'ADMIN list inspections');
  },
});

tests.push({
  name: 'ADMIN can update any inspection',
  run: async () => {
    // Create a fresh inspection in draft status so it can be updated
    const payload = inspectionPayload();
    const createRes = await api('POST', '/api/site-inspections', { role: 'ADMIN', body: payload });
    if (createRes.status === 404) skip('site-inspections endpoint not available');
    assertOk(createRes, 'ADMIN create for update test');
    const freshId = createRes.data.id;
    assert(freshId, 'Must get inspection ID');

    const res = await api('PUT', `/api/site-inspections/${freshId}`, {
      role: 'ADMIN',
      body: { notes: `${gen.TEST_PREFIX}Admin_updated_${gen.uid()}` },
    });
    assertOk(res, 'ADMIN update inspection');
  },
});

tests.push({
  name: 'HEAD_PM can read inspections',
  run: async () => {
    const res = await api('GET', '/api/site-inspections', { role: 'HEAD_PM' });
    if (res.status === 404) skip('site-inspections endpoint not available');
    assertOk(res, 'HEAD_PM list inspections');
  },
});

tests.push({
  name: 'DIRECTOR_GEN can read inspections',
  run: async () => {
    const res = await api('GET', '/api/site-inspections', { role: 'DIRECTOR_GEN' });
    if (res.status === 404) skip('site-inspections endpoint not available');
    assertOk(res, 'DIRECTOR_GEN list inspections');
  },
});

// ─── Validation ─────────────────────────────────────────────────────────

tests.push({
  name: 'Validation: empty object_name returns 400/422',
  run: async () => {
    const payload = inspectionPayload({ object_name: '' });
    const res = await api('POST', '/api/site-inspections', { role: 'PM', body: payload });
    if (res.status === 404) skip('site-inspections endpoint not available');
    assert(res.status === 400 || res.status === 422, `Expected 400/422 for empty object_name, got ${res.status}`);
  },
});

tests.push({
  name: 'Validation: missing object_name returns 400/422',
  run: async () => {
    const payload = inspectionPayload();
    delete payload.object_name;
    const res = await api('POST', '/api/site-inspections', { role: 'PM', body: payload });
    if (res.status === 404) skip('site-inspections endpoint not available');
    assert(res.status === 400 || res.status === 422, `Expected 400/422 for missing object_name, got ${res.status}`);
  },
});

tests.push({
  name: 'GET non-existent inspection returns 404',
  run: async () => {
    const res = await api('GET', '/api/site-inspections/999999999', { role: 'PM' });
    assertStatus(res, 404, 'Non-existent inspection');
  },
});

// ─── Filter by work_id ──────────────────────────────────────────────────

tests.push({
  name: 'Filter inspections by work_id returns valid result',
  run: async () => {
    const res = await api('GET', '/api/site-inspections?work_id=1', { role: 'PM' });
    if (res.status === 404) skip('site-inspections endpoint not available');
    assertOk(res, 'Filter by work_id');
  },
});

tests.push({
  name: 'Filter inspections by status returns valid result',
  run: async () => {
    const res = await api('GET', '/api/site-inspections?status=draft', { role: 'PM' });
    if (res.status === 404) skip('site-inspections endpoint not available');
    assertOk(res, 'Filter by status');
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  name: 'site-inspections',
  tests,
};
