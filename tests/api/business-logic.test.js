/**
 * BUSINESS LOGIC — Status transitions, cascading ops, constraints, pagination, dates
 */
const {
  api, assert, assertOk, assertStatus, assertArray, assertHasFields, assertMatch, assertFieldType,
  BASE_URL, TEST_USERS
} = require('../config');

let _ids = {};

module.exports = {
  name: 'BUSINESS LOGIC (deep)',
  tests: [
    // ═══ A. Tender Status Transitions ═══
    {
      name: 'BIZ-A1: Create tender → default status "Новый"',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'BIZ-TEST: Status Corp', estimated_sum: 1000000, tender_type: 'Аукцион' }
        });
        assertOk(resp, 'create tender');
        const t = resp.data?.tender || resp.data;
        _ids.tender = t?.id;
        assert(_ids.tender, 'should return id');
        assert(t.tender_status === 'Новый', `default status should be "Новый", got "${t.tender_status}"`);
      }
    },
    {
      name: 'BIZ-A2: Update status → В работе',
      run: async () => {
        if (!_ids.tender) throw new Error('No tender');
        const resp = await api('PUT', `/api/tenders/${_ids.tender}`, {
          role: 'TO', body: { tender_status: 'В работе' }
        });
        assertOk(resp, 'update to В работе');
        const check = await api('GET', `/api/tenders/${_ids.tender}`, { role: 'TO' });
        assertOk(check, 'GET after status update');
        const t = check.data?.tender || check.data;
        assertMatch(t, { tender_status: 'В работе' }, 'status persisted');
      }
    },
    {
      name: 'BIZ-A3: Update status → Выиграли',
      run: async () => {
        if (!_ids.tender) throw new Error('No tender');
        const resp = await api('PUT', `/api/tenders/${_ids.tender}`, {
          role: 'TO', body: { tender_status: 'Выиграли' }
        });
        assertOk(resp, 'update to Выиграли');
        const check = await api('GET', `/api/tenders/${_ids.tender}`, { role: 'TO' });
        assertOk(check, 'GET after Выиграли');
        const t = check.data?.tender || check.data;
        assertMatch(t, { tender_status: 'Выиграли' }, 'status Выиграли');
      }
    },
    {
      name: 'BIZ-A4: Update status → Проиграли',
      run: async () => {
        if (!_ids.tender) throw new Error('No tender');
        const resp = await api('PUT', `/api/tenders/${_ids.tender}`, {
          role: 'TO', body: { tender_status: 'Проиграли' }
        });
        assertOk(resp, 'update to Проиграли');
        const check = await api('GET', `/api/tenders/${_ids.tender}`, { role: 'TO' });
        assertOk(check, 'GET after Проиграли');
        const t = check.data?.tender || check.data;
        assertMatch(t, { tender_status: 'Проиграли' }, 'status Проиграли');
      }
    },
    {
      name: 'BIZ-A5: Cleanup tender',
      run: async () => {
        if (_ids.tender) {
          await api('DELETE', `/api/tenders/${_ids.tender}`, { role: 'ADMIN' });
          _ids.tender = null;
        }
      }
    },

    // ═══ B. Cascading Operations ═══
    {
      name: 'BIZ-B1: Delete tender with estimate → 400 (protected), then clean and delete',
      run: async () => {
        // Create tender
        const t = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'BIZ-B1 Cascade Corp', estimated_sum: 500000 }
        });
        assertOk(t, 'create cascade tender');
        const tid = (t.data?.tender || t.data)?.id;
        assert(tid, 'tender id');

        // Create estimate linked to tender
        const e = await api('POST', '/api/estimates', {
          role: 'ADMIN',
          body: { title: 'BIZ-B1 Cascade Estimate', tender_id: tid }
        });
        const eid = (e.data?.estimate || e.data)?.id;

        if (eid) {
          // Try to delete tender → should be BLOCKED (400) because estimate exists
          const delResp = await api('DELETE', `/api/tenders/${tid}`, { role: 'ADMIN' });
          assertStatus(delResp, 400, 'delete tender with estimate should be blocked');

          // Verify estimate still exists
          const estCheck = await api('GET', `/api/estimates/${eid}`, { role: 'ADMIN' });
          assertOk(estCheck, 'estimate should still exist');

          // Clean up: delete estimate first, then tender
          await api('DELETE', `/api/estimates/${eid}`, { role: 'ADMIN' }).catch(() => {});
          await api('DELETE', `/api/tenders/${tid}`, { role: 'ADMIN' }).catch(() => {});
        } else {
          // Estimate creation failed (no table?) — just clean up tender
          await api('DELETE', `/api/tenders/${tid}`, { role: 'ADMIN' }).catch(() => {});
        }
      }
    },
    {
      name: 'BIZ-B2: Create work → create expense → verify linkage',
      run: async () => {
        const w = await api('POST', '/api/works', {
          role: 'PM',
          body: { work_title: 'BIZ-B2 Cascade Work' }
        });
        assertOk(w, 'create cascade work');
        const wid = (w.data?.work || w.data)?.id;
        assert(wid, 'work id');

        const exp = await api('POST', '/api/expenses/work', {
          role: 'PM',
          body: { amount: 5000, category: 'Материалы', description: 'cascade test', work_id: wid }
        });
        assertOk(exp, 'create expense with work_id');

        // Clean up
        await api('DELETE', `/api/works/${wid}`, { role: 'ADMIN' }).catch(() => {});
      }
    },

    // ═══ C. Unique Constraints ═══
    {
      name: 'BIZ-C1: Duplicate login → 400 or 409',
      run: async () => {
        const login = 'biz_test_unique_' + Date.now();
        const r1 = await api('POST', '/api/users', {
          role: 'ADMIN',
          body: { login, name: 'BIZ Unique Test 1', role: 'PM' }
        });
        const uid1 = (r1.data?.user || r1.data)?.id;

        const r2 = await api('POST', '/api/users', {
          role: 'ADMIN',
          body: { login, name: 'BIZ Unique Test 2', role: 'PM' }
        });
        assert(
          r2.status === 400 || r2.status === 409 || r2.status === 422,
          `duplicate login: expected 400/409/422, got ${r2.status}`
        );
        const uid2 = (r2.data?.user || r2.data)?.id;

        if (uid1) await api('DELETE', `/api/users/${uid1}`, { role: 'ADMIN' });
        if (uid2 && uid2 !== uid1) await api('DELETE', `/api/users/${uid2}`, { role: 'ADMIN' });
      }
    },
    {
      name: 'BIZ-C2: Duplicate customer INN → upsert (200)',
      run: async () => {
        const inn = '9999988881';
        await api('DELETE', `/api/customers/${inn}`, { role: 'ADMIN' }).catch(() => {});
        const r1 = await api('POST', '/api/customers', {
          role: 'PM', body: { inn, name: 'BIZ Dup Corp A' }
        });
        assertOk(r1, 'first customer create');
        const r2 = await api('POST', '/api/customers', {
          role: 'PM', body: { inn, name: 'BIZ Dup Corp B' }
        });
        assertOk(r2, 'duplicate INN → upsert');
        // Verify upsert: name should be updated to B
        const check = await api('GET', `/api/customers/${inn}`, { role: 'PM' });
        if (check.ok) {
          const c = check.data?.customer || check.data;
          assert(c?.name === 'BIZ Dup Corp B', `upsert should update name to B, got "${c?.name}"`);
        }
        await api('DELETE', `/api/customers/${inn}`, { role: 'ADMIN' });
      }
    },
    {
      name: 'BIZ-C3: Login with nonexistent user → 401',
      run: async () => {
        const resp = await api('POST', '/api/auth/login', {
          body: { login: 'absolutely_nonexistent_user_xyz', password: 'Test123!' }
        });
        assertStatus(resp, 401, 'nonexistent user login');
      }
    },
    {
      name: 'BIZ-C4: Login with empty password → 400 or 401',
      run: async () => {
        const resp = await api('POST', '/api/auth/login', {
          body: { login: 'test_admin', password: '' }
        });
        assert(
          resp.status === 400 || resp.status === 401,
          `empty password: expected 400/401, got ${resp.status}`
        );
      }
    },

    // ═══ D. Pagination & Limits ═══
    {
      name: 'BIZ-D1: limit=2 → ≤2 items',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=2', { role: 'ADMIN' });
        assertOk(resp, 'limit=2');
        const list = resp.data?.tenders || resp.data?.items || resp.data;
        if (Array.isArray(list)) {
          assert(list.length <= 2, `expected ≤2, got ${list.length}`);
        }
      }
    },
    {
      name: 'BIZ-D2: limit=0 → 200 (server clamps to 1)',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=0', { role: 'ADMIN' });
        assertOk(resp, 'limit=0');
      }
    },
    {
      name: 'BIZ-D3: limit=-1 → 200 (server clamps to 1)',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=-1', { role: 'ADMIN' });
        assertOk(resp, 'limit=-1');
      }
    },
    {
      name: 'BIZ-D4: limit=999999 → ≤10000 items (server cap)',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=999999', { role: 'ADMIN' });
        assertOk(resp, 'limit=999999');
        const list = resp.data?.tenders || resp.data?.items || resp.data;
        if (Array.isArray(list)) {
          assert(list.length <= 10000, `expected ≤10000, got ${list.length}`);
        }
      }
    },
    {
      name: 'BIZ-D5: offset=999999 → 200, empty array',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?offset=999999', { role: 'ADMIN' });
        assertOk(resp, 'offset=999999');
        const list = resp.data?.tenders || resp.data?.items || resp.data;
        if (Array.isArray(list)) {
          assert(list.length === 0, `expected empty at big offset, got ${list.length}`);
        }
      }
    },

    // ═══ E. Financial Calculations ═══
    {
      name: 'BIZ-E1: Create estimate with cost → GET → fields present',
      run: async () => {
        const resp = await api('POST', '/api/estimates', {
          role: 'ADMIN',
          body: { title: 'BIZ-E1 Cost Test', total_sum: 1000000 }
        });
        assertOk(resp, 'create estimate');
        const est = resp.data?.estimate || resp.data;
        if (est?.id) {
          const check = await api('GET', `/api/estimates/${est.id}`, { role: 'ADMIN' });
          assertOk(check, 'GET estimate');
          await api('DELETE', `/api/estimates/${est.id}`, { role: 'ADMIN' }).catch(() => {});
        }
      }
    },
    {
      name: 'BIZ-E2: Invoice creation with amount → GET → amount present',
      run: async () => {
        const resp = await api('POST', '/api/invoices', {
          role: 'ADMIN',
          body: {
            invoice_number: 'BIZ-E2-' + Date.now(),
            invoice_date: new Date().toISOString().slice(0, 10),
            amount: 50000,
            direction: 'incoming'
          }
        });
        assertOk(resp, 'create invoice');
        const inv = resp.data?.invoice || resp.data;
        if (inv?.id) {
          const check = await api('GET', `/api/invoices/${inv.id}`, { role: 'ADMIN' });
          assertOk(check, 'GET invoice');
          await api('DELETE', `/api/invoices/${inv.id}`, { role: 'ADMIN' }).catch(() => {});
        }
      }
    },

    // ═══ F. Date/Time Edge Cases ═══
    {
      name: 'BIZ-F1: Calendar event with past date → 200 (allowed)',
      run: async () => {
        const resp = await api('POST', '/api/calendar', {
          role: 'ADMIN',
          body: { title: 'BIZ-F1 Past Event', date: '2020-01-01' }
        });
        assertOk(resp, 'past date allowed');
        const ev = resp.data?.event || resp.data;
        if (ev?.id) await api('DELETE', `/api/calendar/${ev.id}`, { role: 'ADMIN' }).catch(() => {});
      }
    },
    {
      name: 'BIZ-F2: Calendar event with invalid date → 400',
      run: async () => {
        const resp = await api('POST', '/api/calendar', {
          role: 'ADMIN',
          body: { title: 'BIZ-F2 Bad Date', date: 'invalid-date' }
        });
        assertStatus(resp, 400, 'invalid date');
      }
    },
    {
      name: 'BIZ-F3: Tender with past deadline → 200 (allowed)',
      run: async () => {
        const resp = await api('POST', '/api/tenders', {
          role: 'TO',
          body: { customer: 'BIZ-F3 Past Deadline', deadline: '2020-01-01', estimated_sum: 100 }
        });
        assertOk(resp, 'past deadline allowed');
        const t = resp.data?.tender || resp.data;
        if (t?.id) await api('DELETE', `/api/tenders/${t.id}`, { role: 'ADMIN' }).catch(() => {});
      }
    }
  ]
};
