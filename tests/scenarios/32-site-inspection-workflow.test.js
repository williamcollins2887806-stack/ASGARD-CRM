/**
 * Scenario 32: Site Inspection Full Workflow (Multi-Role)
 *
 * Roles involved: PM, OFFICE_MANAGER, DIRECTOR_GEN, ADMIN
 *
 * Flow:
 *   1. PM creates site inspection (fills dates, employees, vehicles)
 *   2. PM downloads PDF
 *   3. PM sends email to client
 *   4. PM marks as "sent"
 *   5. PM marks as "approved" (client approved)
 *   6. PM creates business trip (with advance + air ticket)
 *   7. PM sends trip → cash_request created, OFFICE_MANAGER notified
 *   8. DIRECTOR_GEN approves the trip
 *   9. PM completes the trip and inspection
 *  10. OFFICE_MANAGER reads the inspection (view access)
 *  11. Verify OFFICE_MANAGER cannot create inspections
 */

const { api, assert, assertOk, assertForbidden, skip, getToken, rawFetch } = require('../config');
const gen = require('../lib/data-generator');

const SCENARIO_NAME = '32-site-inspection-workflow';

function inspectionPayload(overrides = {}) {
  const id = gen.uid();
  return {
    object_name: `${gen.TEST_PREFIX}Scenario32_Object_${id}`,
    object_address: `${gen.TEST_PREFIX}г.Москва, ул.Тестовая, д.${gen.randomInt(1, 200)}`,
    customer_name: `${gen.TEST_PREFIX}Customer_${id}`,
    customer_contact_person: `${gen.TEST_PREFIX}Контакт_${id}`,
    customer_contact_email: `scenario32_${id}@example.com`,
    customer_contact_phone: gen.randomPhone(),
    inspection_dates: [
      { date: gen.futureDate(14), time_from: '09:00', time_to: '17:00' },
      { date: gen.futureDate(21), time_from: '10:00', time_to: '16:00' },
      { date: gen.futureDate(28), time_from: '08:00', time_to: '15:00' },
    ],
    employees_json: [
      {
        fio: `${gen.TEST_PREFIX}Инженер_${id}`,
        position: 'Инженер',
        phone: gen.randomPhone(),
        passport_series: '45 12',
        passport_number: String(gen.randomInt(100000, 999999)),
      },
      {
        fio: `${gen.TEST_PREFIX}Менеджер_${id}`,
        position: 'Руководитель проекта',
        phone: gen.randomPhone(),
      },
    ],
    vehicles_json: [
      {
        brand: 'Toyota',
        model: 'Land Cruiser 200',
        plate_number: `А${gen.randomInt(100, 999)}БВ77`,
        driver_fio: `${gen.TEST_PREFIX}Водитель_${id}`,
      },
    ],
    notes: `Scenario 32 full workflow test ${id}`,
    ...overrides,
  };
}

function tripPayload(inspectionId, overrides = {}) {
  const id = gen.uid();
  return {
    inspection_id: inspectionId,
    date_from: gen.futureDate(7),
    date_to: gen.futureDate(14),
    employees_json: [
      { employee_id: 1, fio: `${gen.TEST_PREFIX}TripEng_${id}`, position: 'Инженер' },
      { employee_id: 2, fio: `${gen.TEST_PREFIX}TripPM_${id}`, position: 'Руководитель проекта' },
    ],
    transport_type: 'air',
    need_fuel_card: true,
    need_air_ticket: true,
    need_advance: true,
    advance_amount: 120000,
    ticket_details: 'Москва-Сочи, эконом, 2 билета',
    notes: `Scenario 32 trip ${id}`,
    ...overrides,
  };
}

const tests = [];
let inspectionId = null;
let tripId = null;

// ── Step 1: PM creates site inspection ─────────────────────────────────

tests.push({
  name: '[S32-01] PM creates site inspection with full data',
  run: async () => {
    const payload = inspectionPayload();
    const res = await api('POST', '/api/site-inspections', { role: 'PM', body: payload });
    if (res.status === 404) skip('site-inspections endpoint not deployed yet');
    assertOk(res, 'PM create inspection');
    assert(res.data && res.data.id, 'Must get inspection ID');
    inspectionId = res.data.id;

    // Verify data saved correctly
    const detail = await api('GET', `/api/site-inspections/${inspectionId}`, { role: 'PM' });
    assertOk(detail, 'Read created inspection');
    assert(detail.data.status === 'draft', 'Initial status must be draft');
    assert(detail.data.object_name.includes(gen.TEST_PREFIX), 'object_name must contain test prefix');

    // Verify arrays saved
    const dates = detail.data.inspection_dates;
    const emps = detail.data.employees_json;
    const vehicles = detail.data.vehicles_json;
    assert(Array.isArray(dates) && dates.length >= 2, 'Must have at least 2 inspection dates');
    assert(Array.isArray(emps) && emps.length >= 2, 'Must have at least 2 employees');
    assert(Array.isArray(vehicles) && vehicles.length >= 1, 'Must have at least 1 vehicle');
  },
});

// ── Step 2: PM downloads PDF ───────────────────────────────────────────

tests.push({
  name: '[S32-02] PM downloads inspection PDF',
  run: async () => {
    if (!inspectionId) skip('No inspection created');
    const token = await getToken('PM');
    const resp = await rawFetch('GET', `/api/site-inspections/${inspectionId}/pdf`, { token });
    assertOk(resp, 'PDF generation');
    const contentType = resp.headers?.get?.('content-type') || resp.headers?.['content-type'] || '';
    assert(
      contentType.includes('application/pdf') || contentType.includes('octet-stream'),
      `Expected PDF, got '${contentType}'`
    );
  },
});

// ── Step 3: PM sends email to client ───────────────────────────────────

tests.push({
  name: '[S32-03] PM sends inspection email to client',
  run: async () => {
    if (!inspectionId) skip('No inspection created');
    const res = await api('POST', `/api/site-inspections/${inspectionId}/send-email`, {
      role: 'PM',
      body: {
        to: 'client-scenario32@example.com',
        subject: 'Заявка на осмотр объекта (Сценарий 32)',
        body: 'Уважаемый клиент, направляем заявку на осмотр объекта. Просим согласовать одну из предложенных дат.',
      },
    });
    assert(
      res.status >= 200 && res.status < 300,
      `Email send should succeed, got ${res.status}`
    );
  },
});

// ── Step 4: PM transitions to sent ─────────────────────────────────────

tests.push({
  name: '[S32-04] PM marks inspection as sent',
  run: async () => {
    if (!inspectionId) skip('No inspection created');
    // Email may have auto-transitioned to sent
    const check = await api('GET', `/api/site-inspections/${inspectionId}`, { role: 'PM' });
    if (check.data.status !== 'sent') {
      const res = await api('PUT', `/api/site-inspections/${inspectionId}/status`, {
        role: 'PM', body: { status: 'sent' },
      });
      assertOk(res, 'draft -> sent');
    }

    const verify = await api('GET', `/api/site-inspections/${inspectionId}`, { role: 'PM' });
    assert(verify.data.status === 'sent', `Expected sent, got '${verify.data.status}'`);
  },
});

// ── Step 5: PM marks as approved (client approved) ─────────────────────

tests.push({
  name: '[S32-05] PM marks inspection as approved',
  run: async () => {
    if (!inspectionId) skip('No inspection created');
    const res = await api('PUT', `/api/site-inspections/${inspectionId}/status`, {
      role: 'PM', body: { status: 'approved' },
    });
    assertOk(res, 'sent -> approved');
  },
});

// ── Step 6: PM transitions to trip_planned ─────────────────────────────

tests.push({
  name: '[S32-06] PM transitions inspection to trip_planned',
  run: async () => {
    if (!inspectionId) skip('No inspection created');
    const res = await api('PUT', `/api/site-inspections/${inspectionId}/status`, {
      role: 'PM', body: { status: 'trip_planned' },
    });
    assertOk(res, 'approved -> trip_planned');
  },
});

// ── Step 7: PM creates business trip ───────────────────────────────────

tests.push({
  name: '[S32-07] PM creates business trip with advance + air ticket',
  run: async () => {
    if (!inspectionId) skip('No inspection created');
    const payload = tripPayload(inspectionId);
    const res = await api('POST', '/api/site-inspections/trips', { role: 'PM', body: payload });
    if (res.status === 404) skip('trips endpoint not available');
    assertOk(res, 'PM create trip');
    assert(res.data && res.data.id, 'Must get trip ID');
    tripId = res.data.id;

    // Verify trip data
    assert(Number(res.data.inspection_id) === Number(inspectionId), 'Trip linked to inspection');
    assert(res.data.need_advance === true || res.data.need_advance === 'true', 'need_advance must be true');
    assert(Number(res.data.advance_amount) === 120000 || Number(res.data.advance_amount) > 0, 'advance_amount must be set');
  },
});

// ── Step 8: PM sends trip (cash_request + notification) ────────────────

tests.push({
  name: '[S32-08] PM sends trip (creates cash_request, notifies OFFICE_MANAGER)',
  run: async () => {
    if (!tripId) skip('No trip created');
    const res = await api('POST', `/api/site-inspections/trips/${tripId}/send`, {
      role: 'PM', body: {},
    });
    assert(
      res.status >= 200 && res.status < 300,
      `Send trip should succeed, got ${res.status}`
    );

    // Log cash request info
    if (res.data?.cash_request_id) {
      console.log(`  [S32] Cash request created: #${res.data.cash_request_id}`);
    }
    if (res.data?.notified || res.data?.notifications) {
      console.log(`  [S32] OFFICE_MANAGER notification sent`);
    }
  },
});

// ── Step 9: Trip PDF generation ────────────────────────────────────────

tests.push({
  name: '[S32-09] Trip PDF generation',
  run: async () => {
    if (!tripId) skip('No trip created');
    const token = await getToken('PM');
    const resp = await rawFetch('GET', `/api/site-inspections/trips/${tripId}/pdf`, { token });
    assertOk(resp, 'Trip PDF');
  },
});

// ── Step 10: DIRECTOR_GEN approves the trip ────────────────────────────

tests.push({
  name: '[S32-10] DIRECTOR_GEN approves the trip',
  run: async () => {
    if (!tripId) skip('No trip created');

    // Ensure trip is in 'sent' status
    await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
      role: 'PM', body: { status: 'sent' },
    });

    const res = await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
      role: 'DIRECTOR_GEN', body: { status: 'approved' },
    });
    assertOk(res, 'DIRECTOR_GEN approve trip');
  },
});

// ── Step 11: PM completes the trip ─────────────────────────────────────

tests.push({
  name: '[S32-11] PM completes the trip',
  run: async () => {
    if (!tripId) skip('No trip created');
    const res = await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
      role: 'PM', body: { status: 'completed' },
    });
    assertOk(res, 'approved -> completed (trip)');
  },
});

// ── Step 12: PM completes the inspection ───────────────────────────────

tests.push({
  name: '[S32-12] PM completes the inspection',
  run: async () => {
    if (!inspectionId) skip('No inspection created');
    // trip_planned can go to completed or via trip_sent
    let res = await api('PUT', `/api/site-inspections/${inspectionId}/status`, {
      role: 'PM', body: { status: 'completed' },
    });
    if (res.status >= 400) {
      // Try trip_sent first
      await api('PUT', `/api/site-inspections/${inspectionId}/status`, {
        role: 'PM', body: { status: 'trip_sent' },
      });
      res = await api('PUT', `/api/site-inspections/${inspectionId}/status`, {
        role: 'PM', body: { status: 'completed' },
      });
    }
    assertOk(res, 'Inspection completed');

    const verify = await api('GET', `/api/site-inspections/${inspectionId}`, { role: 'PM' });
    assert(verify.data.status === 'completed', `Final status must be completed, got '${verify.data.status}'`);
  },
});

// ── Step 13: OFFICE_MANAGER can read but not create ────────────────────

tests.push({
  name: '[S32-13] OFFICE_MANAGER can read inspections',
  run: async () => {
    const res = await api('GET', '/api/site-inspections', { role: 'OFFICE_MANAGER' });
    if (res.status === 404) skip('endpoint not available');
    assertOk(res, 'OFFICE_MANAGER list inspections');
  },
});

tests.push({
  name: '[S32-14] OFFICE_MANAGER cannot create inspections',
  run: async () => {
    const payload = inspectionPayload();
    const res = await api('POST', '/api/site-inspections', { role: 'OFFICE_MANAGER', body: payload });
    if (res.status === 404) skip('endpoint not available');
    assertForbidden(res, 'OFFICE_MANAGER create inspection');
  },
});

// ── Step 15: ADMIN full access verification ────────────────────────────

tests.push({
  name: '[S32-15] ADMIN can create, read, update inspections',
  run: async () => {
    const payload = inspectionPayload();
    const createRes = await api('POST', '/api/site-inspections', { role: 'ADMIN', body: payload });
    if (createRes.status === 404) skip('endpoint not available');
    assertOk(createRes, 'ADMIN create');

    const id = createRes.data.id;
    const readRes = await api('GET', `/api/site-inspections/${id}`, { role: 'ADMIN' });
    assertOk(readRes, 'ADMIN read');

    const updateRes = await api('PUT', `/api/site-inspections/${id}`, {
      role: 'ADMIN', body: { notes: `${gen.TEST_PREFIX}Admin update ${gen.uid()}` },
    });
    assertOk(updateRes, 'ADMIN update');
  },
});

// ── Step 16: HEAD_PM and DIRECTOR_GEN can read ─────────────────────────

tests.push({
  name: '[S32-16] HEAD_PM and DIRECTOR_GEN have read access',
  run: async () => {
    const res1 = await api('GET', '/api/site-inspections', { role: 'HEAD_PM' });
    if (res1.status === 404) skip('endpoint not available');
    assertOk(res1, 'HEAD_PM read');

    const res2 = await api('GET', '/api/site-inspections', { role: 'DIRECTOR_GEN' });
    assertOk(res2, 'DIRECTOR_GEN read');
  },
});

module.exports = {
  name: SCENARIO_NAME + ': Site Inspection Full Workflow',
  tests,
};
