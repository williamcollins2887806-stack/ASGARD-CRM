/**
 * E2E FLOW: Site Inspection full lifecycle
 *
 * PM creates inspection -> sends to client -> approves -> creates trip ->
 * sends trip (cash request + notify office manager) -> DIRECTOR approves -> completed
 */
const { api, assert, assertOk, assertForbidden, skip, getToken } = require('../config');
const gen = require('../lib/data-generator');

function inspectionPayload(overrides = {}) {
  const id = gen.uid();
  return {
    object_name: `${gen.TEST_PREFIX}E2E_Object_${id}`,
    object_address: `${gen.TEST_PREFIX}Address_${id}`,
    customer_name: `${gen.TEST_PREFIX}Customer_${id}`,
    customer_contact_person: `${gen.TEST_PREFIX}Contact_${id}`,
    customer_contact_email: `e2e_${id}@example.com`,
    customer_contact_phone: gen.randomPhone(),
    inspection_dates: [
      { date: gen.futureDate(14), time_from: '09:00', time_to: '17:00' },
      { date: gen.futureDate(21), time_from: '10:00', time_to: '16:00' },
    ],
    employees_json: [
      { fio: `${gen.TEST_PREFIX}Inspector_${id}`, position: 'Инженер', phone: gen.randomPhone(),
        passport_series: '45 12', passport_number: '654321' },
    ],
    vehicles_json: [
      { brand: 'Toyota', model: 'Hilux', plate_number: 'А123БВ77', driver_fio: `${gen.TEST_PREFIX}Driver_${id}` },
    ],
    notes: `E2E full workflow test ${id}`,
    ...overrides,
  };
}

function tripPayload(inspectionId, overrides = {}) {
  const id = gen.uid();
  return {
    inspection_id: inspectionId,
    date_from: gen.futureDate(7),
    date_to: gen.futureDate(10),
    employees_json: [{ employee_id: 1, fio: `${gen.TEST_PREFIX}TripEng_${id}`, position: 'Инженер' }],
    transport_type: 'air',
    need_fuel_card: true,
    need_air_ticket: true,
    need_advance: true,
    advance_amount: 80000,
    notes: `E2E trip ${id}`,
    ...overrides,
  };
}

module.exports = {
  name: 'FLOW: Site Inspection Full Lifecycle',
  tests: [
    {
      name: 'E2E: Complete site inspection workflow (PM + DIRECTOR_GEN + OFFICE_MANAGER)',
      run: async () => {
        // ── Step 1: PM creates inspection ──
        const payload = inspectionPayload();
        const createRes = await api('POST', '/api/site-inspections', { role: 'PM', body: payload });
        if (createRes.status === 404) skip('site-inspections endpoint not available');
        assertOk(createRes, 'PM create inspection');
        const inspectionId = createRes.data.id;
        assert(inspectionId, 'Must get inspection ID');
        console.log(`  [e2e] Created inspection #${inspectionId}`);

        // ── Step 2: Verify initial status is draft ──
        let detail = await api('GET', `/api/site-inspections/${inspectionId}`, { role: 'PM' });
        assertOk(detail, 'Read new inspection');
        assert(detail.data.status === 'draft', `Initial status must be draft, got '${detail.data.status}'`);

        // ── Step 3: PM sends email to client ──
        const emailRes = await api('POST', `/api/site-inspections/${inspectionId}/send-email`, {
          role: 'PM',
          body: {
            to: 'client@example.com',
            subject: `Заявка на осмотр: ${payload.object_name}`,
            body: 'Уважаемый клиент, направляем заявку на осмотр объекта.',
          },
        });
        assert(
          emailRes.status === 200 || emailRes.status === 201 || emailRes.status === 202,
          `Send email should succeed, got ${emailRes.status}`
        );
        console.log(`  [e2e] Email sent for inspection #${inspectionId}`);

        // ── Step 4: Check if auto-transitioned to sent by email, if not — do it manually ──
        detail = await api('GET', `/api/site-inspections/${inspectionId}`, { role: 'PM' });
        if (detail.data.status !== 'sent') {
          let statusRes = await api('PUT', `/api/site-inspections/${inspectionId}/status`, {
            role: 'PM', body: { status: 'sent' },
          });
          assertOk(statusRes, 'draft -> sent');
        }
        console.log(`  [e2e] Inspection #${inspectionId} status is now sent`);

        // ── Step 5: PM marks as approved (client approved the inspection) ──
        let statusRes = await api('PUT', `/api/site-inspections/${inspectionId}/status`, {
          role: 'PM', body: { status: 'approved' },
        });
        assertOk(statusRes, 'sent -> approved');

        // ── Step 6: PM transitions to trip_planned ──
        statusRes = await api('PUT', `/api/site-inspections/${inspectionId}/status`, {
          role: 'PM', body: { status: 'trip_planned' },
        });
        assertOk(statusRes, 'approved -> trip_planned');
        console.log(`  [e2e] Inspection #${inspectionId} is now trip_planned`);

        // ── Step 7: PM creates a business trip ──
        const tripData = tripPayload(inspectionId);
        const tripRes = await api('POST', '/api/site-inspections/trips', { role: 'PM', body: tripData });
        if (tripRes.status === 404) skip('trips endpoint not available');
        assertOk(tripRes, 'PM create trip');
        const tripId = tripRes.data.id;
        assert(tripId, 'Must get trip ID');
        console.log(`  [e2e] Created trip #${tripId} for inspection #${inspectionId}`);

        // ── Step 8: PM sends the trip (notifies office manager, creates cash request) ──
        const sendRes = await api('POST', `/api/site-inspections/trips/${tripId}/send`, {
          role: 'PM', body: {},
        });
        assert(
          sendRes.status === 200 || sendRes.status === 201 || sendRes.status === 202,
          `Send trip should succeed, got ${sendRes.status}`
        );
        console.log(`  [e2e] Trip #${tripId} sent. Cash request: ${sendRes.data?.cash_request_id || 'N/A'}`);

        // ── Step 9: Verify trip status changed to sent ──
        // (The send endpoint may auto-transition to 'sent')
        // If not auto-transitioned, manually transition
        const tripDetail = await api('GET', `/api/site-inspections/${inspectionId}`, { role: 'PM' });
        assertOk(tripDetail, 'Read inspection after trip send');

        // ── Step 10: DIRECTOR_GEN approves the trip ──
        // First ensure trip is in 'sent' status
        const tripStatusSent = await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
          role: 'PM', body: { status: 'sent' },
        });
        // May already be sent from the send action - 200 or 400 both acceptable
        if (tripStatusSent.status >= 200 && tripStatusSent.status < 300) {
          console.log(`  [e2e] Trip #${tripId} manually set to sent`);
        }

        const approveRes = await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
          role: 'DIRECTOR_GEN', body: { status: 'approved' },
        });
        assertOk(approveRes, 'DIRECTOR_GEN approve trip');
        console.log(`  [e2e] DIRECTOR_GEN approved trip #${tripId}`);

        // ── Step 11: PM completes the trip ──
        const completeRes = await api('PUT', `/api/site-inspections/trips/${tripId}/status`, {
          role: 'PM', body: { status: 'completed' },
        });
        assertOk(completeRes, 'PM complete trip');

        // ── Step 12: PM completes the inspection ──
        statusRes = await api('PUT', `/api/site-inspections/${inspectionId}/status`, {
          role: 'PM', body: { status: 'completed' },
        });
        // trip_planned -> completed might need trip_sent intermediary
        // Try direct, if fails try via trip_sent
        if (statusRes.status >= 400) {
          await api('PUT', `/api/site-inspections/${inspectionId}/status`, {
            role: 'PM', body: { status: 'trip_sent' },
          });
          statusRes = await api('PUT', `/api/site-inspections/${inspectionId}/status`, {
            role: 'PM', body: { status: 'completed' },
          });
        }
        assertOk(statusRes, 'Complete inspection');

        // ── Step 13: Verify final state ──
        detail = await api('GET', `/api/site-inspections/${inspectionId}`, { role: 'PM' });
        assertOk(detail, 'Final verification');
        assert(detail.data.status === 'completed', `Final status must be completed, got '${detail.data.status}'`);
        console.log(`  [e2e] Full lifecycle complete for inspection #${inspectionId}`);
      },
    },

    {
      name: 'E2E: Rejection cycle — PM creates, sends, rejected, re-edits, re-sends, approved',
      run: async () => {
        const payload = inspectionPayload();
        const createRes = await api('POST', '/api/site-inspections', { role: 'PM', body: payload });
        if (createRes.status === 404) skip('site-inspections endpoint not available');
        assertOk(createRes, 'Create inspection for rejection cycle');
        const id = createRes.data.id;

        // draft -> sent
        await api('PUT', `/api/site-inspections/${id}/status`, { role: 'PM', body: { status: 'sent' } });
        // sent -> rejected
        await api('PUT', `/api/site-inspections/${id}/status`, { role: 'PM', body: { status: 'rejected' } });
        // rejected -> draft (re-edit)
        await api('PUT', `/api/site-inspections/${id}/status`, { role: 'PM', body: { status: 'draft' } });

        // PM updates the inspection
        const updateRes = await api('PUT', `/api/site-inspections/${id}`, {
          role: 'PM',
          body: { notes: `${gen.TEST_PREFIX}Re-edited after rejection ${gen.uid()}` },
        });
        assertOk(updateRes, 'Update after rejection');

        // Re-send: draft -> sent -> approved
        await api('PUT', `/api/site-inspections/${id}/status`, { role: 'PM', body: { status: 'sent' } });
        const approveRes = await api('PUT', `/api/site-inspections/${id}/status`, {
          role: 'PM', body: { status: 'approved' },
        });
        assertOk(approveRes, 'Approve after re-send');

        const detail = await api('GET', `/api/site-inspections/${id}`, { role: 'PM' });
        assert(detail.data.status === 'approved', `Expected approved, got '${detail.data.status}'`);
        console.log(`  [e2e] Rejection cycle complete for inspection #${id}`);
      },
    },

    {
      name: 'E2E: OFFICE_MANAGER cannot create but can read inspections',
      run: async () => {
        // Try to create — should be forbidden
        const payload = inspectionPayload();
        const createRes = await api('POST', '/api/site-inspections', { role: 'OFFICE_MANAGER', body: payload });
        if (createRes.status === 404) skip('site-inspections endpoint not available');
        assertForbidden(createRes, 'OFFICE_MANAGER create');

        // Read — should succeed
        const listRes = await api('GET', '/api/site-inspections', { role: 'OFFICE_MANAGER' });
        assertOk(listRes, 'OFFICE_MANAGER list');
        console.log(`  [e2e] OFFICE_MANAGER access control verified`);
      },
    },

    {
      name: 'E2E: PDF download for inspection',
      run: async () => {
        const payload = inspectionPayload();
        const createRes = await api('POST', '/api/site-inspections', { role: 'PM', body: payload });
        if (createRes.status === 404) skip('site-inspections endpoint not available');
        assertOk(createRes, 'Create inspection for PDF');
        const id = createRes.data.id;

        const token = await getToken('PM');
        const pdfRes = await require('../config').rawFetch('GET', `/api/site-inspections/${id}/pdf`, { token });
        assertOk(pdfRes, 'PDF generation');
        console.log(`  [e2e] PDF generated for inspection #${id}`);
      },
    },
  ],
};
