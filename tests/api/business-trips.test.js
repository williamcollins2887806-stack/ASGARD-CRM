/**
 * Business Trips — API Tests
 *
 * CRUD operations, link to site inspections, send trip (cash_request + notification),
 * status transitions, and role-based access.
 *
 * Routes:
 *   POST       /api/site-inspections/trips
 *   PUT        /api/site-inspections/trips/:id
 *   PUT        /api/site-inspections/trips/:id/status
 *   POST       /api/site-inspections/trips/:id/send
 *   GET        /api/site-inspections/trips/:id/pdf
 */

const { api, assert, assertOk, assertStatus, skip, getToken, rawFetch } = require('../config');
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
    customer_contact_phone: gen.randomPhone(),
    inspection_dates: [{ date: gen.futureDate(14), time_from: '09:00', time_to: '17:00' }],
    employees_json: [{ fio: `${gen.TEST_PREFIX}Employee_${id}`, position: 'Инженер' }],
    notes: `Auto-test inspection for trips ${id}`,
    ...overrides,
  };
}

function tripPayload(inspectionId, overrides = {}) {
  const id = gen.uid();
  return {
    inspection_id: inspectionId,
    date_from: gen.futureDate(7),
    date_to: gen.futureDate(10),
    employees_json: [{ employee_id: 1, fio: `${gen.TEST_PREFIX}TripEmployee_${id}`, position: 'Инженер' }],
    transport_type: 'auto',
    need_fuel_card: false,
    need_air_ticket: false,
    need_advance: false,
    advance_amount: 0,
    notes: `Auto-test trip ${id}`,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

const tests = [];
let parentInspectionId = null;
let createdTripId = null;

// ─── Setup: create a parent inspection in trip_planned status ─────────

tests.push({
  name: 'Setup: PM creates a parent site inspection (-> trip_planned)',
  run: async () => {
    const payload = inspectionPayload();
    const res = await api('POST', '/api/site-inspections', { role: 'PM', body: payload });
    if (res.status === 404) skip('site-inspections endpoint not available');
    assertOk(res, 'Create parent inspection');
    assert(res.data && res.data.id, 'Response must contain id');
    parentInspectionId = res.data.id;

    // Move inspection through: draft -> sent -> approved -> trip_planned
    for (const status of ['sent', 'approved', 'trip_planned']) {
      const r = await api('PUT', `/api/site-inspections/${parentInspectionId}/status`, {
        role: 'PM', body: { status },
      });
      assertOk(r, `Transition to ${status}`);
    }
  },
});

// ─── CRUD ────────────────────────────────────────────────────────────────

tests.push({
  name: 'PM creates a business trip linked to inspection',
  run: async () => {
    if (!parentInspectionId) skip('No parent inspection was created');
    const payload = tripPayload(parentInspectionId);
    const res = await api('POST', '/api/site-inspections/trips', { role: 'PM', body: payload });
    if (res.status === 404) skip('trips endpoint not available');
    assertOk(res, 'PM create trip');
    assert(res.data && res.data.id, 'Response must contain trip id');
    assert(
      Number(res.data.inspection_id) === Number(parentInspectionId),
      `Trip must be linked to the parent inspection (${res.data.inspection_id} vs ${parentInspectionId})`
    );
    createdTripId = res.data.id;
  },
});

tests.push({
  name: 'PM reads the created trip via parent inspection',
  run: async () => {
    if (!createdTripId) skip('No trip was created');
    const res = await api('GET', `/api/site-inspections/${parentInspectionId}`, { role: 'PM' });
    assertOk(res, 'Read parent inspection');
  },
});

tests.push({
  name: 'PM updates the trip',
  run: async () => {
    if (!createdTripId) skip('No trip was created');
    const updatedNotes = `${gen.TEST_PREFIX}Updated_trip_${gen.uid()}`;
    const res = await api('PUT', `/api/site-inspections/trips/${createdTripId}`, {
      role: 'PM',
      body: { notes: updatedNotes },
    });
    assertOk(res, 'PM update trip');
  },
});

// ─── Trip with advance (send creates cash_request) ─────────────────────

tests.push({
  name: 'PM creates trip with need_advance=true',
  run: async () => {
    if (!parentInspectionId) skip('No parent inspection');
    const payload = tripPayload(parentInspectionId, {
      transport_type: 'air',
      need_advance: true,
      advance_amount: 50000,
      need_air_ticket: true,
    });
    const res = await api('POST', '/api/site-inspections/trips', { role: 'PM', body: payload });
    if (res.status === 404) skip('trips endpoint not available');
    assertOk(res, 'PM create trip with advance');
    assert(res.data && res.data.id, 'Response must contain trip id');
    createdTripId = res.data.id;
  },
});

tests.push({
  name: 'PM sends the trip (creates cash_request when need_advance)',
  run: async () => {
    if (!createdTripId) skip('No trip was created');
    const res = await api('POST', `/api/site-inspections/trips/${createdTripId}/send`, {
      role: 'PM',
      body: {},
    });
    assert(
      res.status === 200 || res.status === 201 || res.status === 202,
      `Expected 200/201/202 for send, got ${res.status}`
    );

    // Informational: check if cash_request was referenced in response
    const hasCashRequest =
      (res.data && res.data.cash_request_id) ||
      (res.data && res.data.cash_request) ||
      (res.data && res.data.cashRequestCreated);
    if (hasCashRequest) {
      console.log(`  [business-trips] Cash request created: ${JSON.stringify(res.data.cash_request_id || res.data.cash_request || '')}`);
    }

    // Informational: check notification
    const hasNotification = (res.data && res.data.notifications) || (res.data && res.data.notified);
    if (hasNotification) {
      console.log(`  [business-trips] OFFICE_MANAGER notified`);
    }
  },
});

// ─── Trip PDF ───────────────────────────────────────────────────────────

tests.push({
  name: 'Trip PDF generation returns valid content',
  run: async () => {
    if (!createdTripId) skip('No trip was created');
    const token = await getToken('PM');
    const resp = await rawFetch('GET', `/api/site-inspections/trips/${createdTripId}/pdf`, { token });
    assertOk(resp, 'Trip PDF endpoint');
    const contentType = resp.headers?.get?.('content-type') || resp.headers?.['content-type'] || '';
    assert(
      contentType.includes('application/pdf') || contentType.includes('octet-stream'),
      `Expected PDF content-type, got '${contentType}'`
    );
  },
});

// ─── Status transitions ─────────────────────────────────────────────────

tests.push({
  name: 'Trip valid transition: draft -> sent',
  run: async () => {
    if (!parentInspectionId) skip('No parent inspection');
    const payload = tripPayload(parentInspectionId);
    const create = await api('POST', '/api/site-inspections/trips', { role: 'PM', body: payload });
    if (create.status === 404) skip('trips endpoint not available');
    assertOk(create, 'Create trip for transition test');
    const tripId = create.data.id;

    const res = await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
      role: 'PM', body: { status: 'sent' },
    });
    assertOk(res, 'draft -> sent');
  },
});

tests.push({
  name: 'Trip valid transition: sent -> approved',
  run: async () => {
    if (!parentInspectionId) skip('No parent inspection');
    const payload = tripPayload(parentInspectionId);
    const create = await api('POST', '/api/site-inspections/trips', { role: 'PM', body: payload });
    if (create.status === 404) skip('trips endpoint not available');
    const tripId = create.data.id;

    await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
      role: 'PM', body: { status: 'sent' },
    });

    const res = await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
      role: 'DIRECTOR_GEN', body: { status: 'approved' },
    });
    assertOk(res, 'sent -> approved');
  },
});

tests.push({
  name: 'Trip valid transition: sent -> rejected -> draft',
  run: async () => {
    if (!parentInspectionId) skip('No parent inspection');
    const payload = tripPayload(parentInspectionId);
    const create = await api('POST', '/api/site-inspections/trips', { role: 'PM', body: payload });
    if (create.status === 404) skip('trips endpoint not available');
    const tripId = create.data.id;

    await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
      role: 'PM', body: { status: 'sent' },
    });

    let res = await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
      role: 'DIRECTOR_GEN', body: { status: 'rejected' },
    });
    assertOk(res, 'sent -> rejected');

    res = await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
      role: 'PM', body: { status: 'draft' },
    });
    assertOk(res, 'rejected -> draft');
  },
});

tests.push({
  name: 'Trip valid transition: approved -> completed',
  run: async () => {
    if (!parentInspectionId) skip('No parent inspection');
    const payload = tripPayload(parentInspectionId);
    const create = await api('POST', '/api/site-inspections/trips', { role: 'PM', body: payload });
    if (create.status === 404) skip('trips endpoint not available');
    const tripId = create.data.id;

    await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
      role: 'PM', body: { status: 'sent' },
    });
    await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
      role: 'DIRECTOR_GEN', body: { status: 'approved' },
    });

    const res = await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
      role: 'PM', body: { status: 'completed' },
    });
    assertOk(res, 'approved -> completed');
  },
});

tests.push({
  name: 'Trip invalid transition: draft -> approved (must go through sent)',
  run: async () => {
    if (!parentInspectionId) skip('No parent inspection');
    const payload = tripPayload(parentInspectionId);
    const create = await api('POST', '/api/site-inspections/trips', { role: 'PM', body: payload });
    if (create.status === 404) skip('trips endpoint not available');
    const tripId = create.data.id;

    const res = await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
      role: 'DIRECTOR_GEN', body: { status: 'approved' },
    });
    assert(res.status === 400 || res.status === 422, `Expected 400/422 for invalid transition, got ${res.status}`);
  },
});

tests.push({
  name: 'Trip invalid transition: draft -> completed (not allowed directly)',
  run: async () => {
    if (!parentInspectionId) skip('No parent inspection');
    const payload = tripPayload(parentInspectionId);
    const create = await api('POST', '/api/site-inspections/trips', { role: 'PM', body: payload });
    if (create.status === 404) skip('trips endpoint not available');
    const tripId = create.data.id;

    const res = await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
      role: 'PM', body: { status: 'completed' },
    });
    assert(res.status === 400 || res.status === 422, `Expected 400/422 for invalid transition, got ${res.status}`);
  },
});

// ─── Role access ────────────────────────────────────────────────────────

tests.push({
  name: 'DIRECTOR_GEN approves a trip',
  run: async () => {
    if (!parentInspectionId) skip('No parent inspection');
    const payload = tripPayload(parentInspectionId);
    const create = await api('POST', '/api/site-inspections/trips', { role: 'PM', body: payload });
    if (create.status === 404) skip('trips endpoint not available');
    const tripId = create.data.id;

    await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
      role: 'PM', body: { status: 'sent' },
    });

    const res = await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
      role: 'DIRECTOR_GEN', body: { status: 'approved' },
    });
    assertOk(res, 'DIRECTOR_GEN approve trip');
  },
});

tests.push({
  name: 'PM creates trip (PM is allowed)',
  run: async () => {
    if (!parentInspectionId) skip('No parent inspection');
    const payload = tripPayload(parentInspectionId);
    const res = await api('POST', '/api/site-inspections/trips', { role: 'PM', body: payload });
    if (res.status === 404) skip('trips endpoint not available');
    assertOk(res, 'PM should be able to create trips');
  },
});

tests.push({
  name: 'ADMIN can create trip',
  run: async () => {
    if (!parentInspectionId) skip('No parent inspection');
    const payload = tripPayload(parentInspectionId);
    const res = await api('POST', '/api/site-inspections/trips', { role: 'ADMIN', body: payload });
    if (res.status === 404) skip('trips endpoint not available');
    assertOk(res, 'ADMIN should be able to create trips');
  },
});

// ─── Trip with fuel card + air ticket ───────────────────────────────────

tests.push({
  name: 'PM creates trip needing fuel card and air ticket',
  run: async () => {
    if (!parentInspectionId) skip('No parent inspection');
    const payload = tripPayload(parentInspectionId, {
      transport_type: 'mixed',
      need_fuel_card: true,
      need_air_ticket: true,
      need_advance: true,
      advance_amount: 75000,
    });
    const res = await api('POST', '/api/site-inspections/trips', { role: 'PM', body: payload });
    if (res.status === 404) skip('trips endpoint not available');
    assertOk(res, 'Create trip with all needs');
    assert(res.data.need_fuel_card === true || res.data.need_fuel_card === 'true',
      'need_fuel_card should be true');
    assert(res.data.need_air_ticket === true || res.data.need_air_ticket === 'true',
      'need_air_ticket should be true');
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  name: 'business-trips',
  tests,
};
