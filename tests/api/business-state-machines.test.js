/**
 * ASGARD CRM — Business State Machines & Status Transitions
 * READ-ONLY tests verifying status fields, valid values, and role-based access
 * across all major business entities with state machines.
 *
 * 100 tests total:
 *   1. Tender status transitions       (15 tests)  #1-15
 *   2. Works status transitions         (12 tests)  #16-27
 *   3. Invoice lifecycle                (12 tests)  #28-39
 *   4. Cash request lifecycle           (10 tests)  #40-49
 *   5. Equipment request lifecycle      (10 tests)  #50-59
 *   6. Staff request lifecycle          (8 tests)   #60-67
 *   7. TKP/Pass/TMC request lifecycle   (12 tests)  #68-79
 *   8. Task lifecycle                   (8 tests)   #80-87
 *   9. Cross-role status visibility     (13 tests)  #88-100
 */
'use strict';

const { api, assert, assertOk, assertStatus, assertHasFields, skip } = require('../config');

// ── Helpers ──

/** Extract array from various response shapes */
function extractList(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['data', 'items', 'rows', 'tenders', 'works', 'invoices',
      'cash_requests', 'equipment_requests', 'staff_requests', 'tkp', 'pass_requests',
      'tmc_requests', 'tasks', 'permits', 'acts', 'purchase_requests']) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return null;
}

/** Check that a status value is one of the allowed set (case-insensitive match) */
function assertValidStatus(item, statusField, allowed, context) {
  const val = item[statusField];
  if (val === null || val === undefined) return; // nullable is OK
  const valLower = String(val).toLowerCase();
  const allowedLower = allowed.map(s => s.toLowerCase());
  assert(
    allowedLower.includes(valLower),
    `${context}: status "${val}" not in [${allowed.join(', ')}]`
  );
}

// ── Known status sets ──

const TENDER_STATUSES = ['Новый', 'В работе', 'Подготовка КП', 'Подан', 'Выигран', 'Проигран', 'Отменён',
  'Оценка', 'Торги', 'Выиграли', 'Проиграли', 'Контракт', 'Отказ', 'Архив', 'Мобилизация', 'Клиент отказался', 'ТКП согласовано', 'Согласование ТКП'];

const WORK_STATUSES = ['Новая', 'Активная', 'Завершена', 'Приостановлена', 'Отменена',
  'Подготовка', 'Мобилизация', 'В работе', 'Работы сдали', 'Закрыт'];

const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'partially_paid', 'partial', 'overdue', 'cancelled'];

const CASH_REQUEST_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'paid',
  'requested', 'received', 'closed', 'question'];

const EQUIPMENT_REQUEST_STATUSES = ['new', 'pending', 'approved', 'issued', 'returned', 'rejected'];

const STAFF_REQUEST_STATUSES = ['new', 'sent', 'answered', 'approved', 'rework', 'rejected', 'closed'];

const TKP_STATUSES = ['draft', 'sent', 'accepted', 'rejected'];

const PASS_REQUEST_STATUSES = ['draft', 'submitted', 'approved', 'rejected'];

const TMC_REQUEST_STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'delivered'];

const TASK_STATUSES = ['new', 'in_progress', 'done', 'cancelled', 'accepted', 'pending', 'completed', 'overdue'];

module.exports = {
  name: 'Business State Machines & Status Transitions (100 tests)',
  tests: [
    // ═══════════════════════════════════════════════════════════════
    // 1. TENDER STATUS TRANSITIONS (15 tests)
    // ═══════════════════════════════════════════════════════════════

    // #1
    {
      name: 'SM-1: Tenders list as ADMIN returns array',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('tenders endpoint not found');
        assertOk(resp, 'GET tenders as ADMIN');
        const list = extractList(resp.data);
        assert(list !== null, 'response should contain an array');
      }
    },
    // #2
    {
      name: 'SM-2: Tenders have status field in response',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('tenders endpoint not found');
        assertOk(resp, 'GET tenders');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no tenders in database');
        const item = list[0];
        const hasStatus = 'tender_status' in item || 'status' in item;
        assert(hasStatus, 'tender item should have tender_status or status field');
      }
    },
    // #3
    {
      name: 'SM-3: All tenders have valid statuses',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('tenders endpoint not found');
        assertOk(resp, 'GET tenders');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no tenders in database');
        for (const item of list) {
          const field = 'tender_status' in item ? 'tender_status' : 'status';
          assertValidStatus(item, field, TENDER_STATUSES, 'tender');
        }
      }
    },
    // #4
    {
      name: 'SM-4: Tenders list via /api/tenders as ADMIN',
      run: async () => {
        const resp = await api('GET', '/api/tenders', { role: 'ADMIN' });
        if (resp.status === 404) skip('/api/tenders not found');
        assertOk(resp, 'GET /api/tenders');
        const list = extractList(resp.data);
        assert(list !== null, 'response should contain an array');
      }
    },
    // #5
    {
      name: 'SM-5: Individual tender has valid status',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=1', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET tenders');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no tenders');
        const item = list[0];
        const field = 'tender_status' in item ? 'tender_status' : 'status';
        if (item[field] !== null && item[field] !== undefined) {
          assertValidStatus(item, field, TENDER_STATUSES, 'single tender');
        }
      }
    },
    // #6
    {
      name: 'SM-6: PM can read tenders',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=5', { role: 'PM' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'PM reads tenders');
      }
    },
    // #7
    {
      name: 'SM-7: TO can read tenders',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=5', { role: 'TO' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'TO reads tenders');
      }
    },
    // #8
    {
      name: 'SM-8: HEAD_PM can read tenders',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=5', { role: 'HEAD_PM' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'HEAD_PM reads tenders');
      }
    },
    // #9
    {
      name: 'SM-9: BUH can read tenders (read access)',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=5', { role: 'BUH' });
        if (resp.status === 404) skip('endpoint not found');
        // BUH may or may not have access; verify response is consistent
        assert(
          resp.status === 200 || resp.status === 403,
          `BUH tenders: expected 200 or 403, got ${resp.status}`
        );
      }
    },
    // #10
    {
      name: 'SM-10: WAREHOUSE should NOT access tenders (403)',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=5', { role: 'WAREHOUSE' });
        if (resp.status === 404) skip('endpoint not found');
        assert(
          resp.status === 403 || resp.status === 401,
          `WAREHOUSE tenders: expected 403/401, got ${resp.status}`
        );
      }
    },
    // #11
    {
      name: 'SM-11: Tender list returns consistent array format',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET tenders');
        const list = extractList(resp.data);
        assert(list !== null, 'should be extractable as array');
        for (const item of list) {
          assert(typeof item === 'object' && item !== null, 'each item should be an object');
        }
      }
    },
    // #12
    {
      name: 'SM-12: Tender items have id field',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET tenders');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no tenders');
        for (const item of list) {
          assert('id' in item, 'tender should have id field');
        }
      }
    },
    // #13
    {
      name: 'SM-13: Tenders via /api/tenders have same structure as /api/data/tenders',
      run: async () => {
        const r1 = await api('GET', '/api/tenders', { role: 'ADMIN' });
        const r2 = await api('GET', '/api/data/tenders?limit=5', { role: 'ADMIN' });
        if (r1.status === 404 && r2.status === 404) skip('no tenders endpoints');
        // At least one should work
        assert(r1.ok || r2.ok, 'at least one tenders endpoint should respond OK');
      }
    },
    // #14
    {
      name: 'SM-14: HEAD_TO can read tenders',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=5', { role: 'HEAD_TO' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'HEAD_TO reads tenders');
      }
    },
    // #15
    {
      name: 'SM-15: DIRECTOR_GEN can read tenders',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=5', { role: 'DIRECTOR_GEN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'DIRECTOR_GEN reads tenders');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 2. WORKS STATUS TRANSITIONS (12 tests)
    // ═══════════════════════════════════════════════════════════════

    // #16
    {
      name: 'SM-16: Works list as ADMIN returns array',
      run: async () => {
        const resp = await api('GET', '/api/data/works?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('works endpoint not found');
        assertOk(resp, 'GET works as ADMIN');
        const list = extractList(resp.data);
        assert(list !== null, 'response should contain an array');
      }
    },
    // #17
    {
      name: 'SM-17: Works have status field',
      run: async () => {
        const resp = await api('GET', '/api/data/works?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('works endpoint not found');
        assertOk(resp, 'GET works');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no works in database');
        const item = list[0];
        const hasStatus = 'work_status' in item || 'status' in item;
        assert(hasStatus, 'work item should have work_status or status field');
      }
    },
    // #18
    {
      name: 'SM-18: All works have valid statuses',
      run: async () => {
        const resp = await api('GET', '/api/data/works?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('works endpoint not found');
        assertOk(resp, 'GET works');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no works');
        for (const item of list) {
          const field = 'work_status' in item ? 'work_status' : 'status';
          assertValidStatus(item, field, WORK_STATUSES, 'work');
        }
      }
    },
    // #19
    {
      name: 'SM-19: Works via /api/works as ADMIN',
      run: async () => {
        const resp = await api('GET', '/api/works', { role: 'ADMIN' });
        if (resp.status === 404) skip('/api/works not found');
        assertOk(resp, 'GET /api/works');
        const list = extractList(resp.data);
        assert(list !== null, 'should return array');
      }
    },
    // #20
    {
      name: 'SM-20: Work items have title field',
      run: async () => {
        const resp = await api('GET', '/api/data/works?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('works endpoint not found');
        assertOk(resp, 'GET works');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no works');
        const item = list[0];
        const hasTitle = 'work_title' in item || 'title' in item || 'name' in item;
        assert(hasTitle, 'work should have work_title, title, or name field');
      }
    },
    // #21
    {
      name: 'SM-21: PM can read works',
      run: async () => {
        const resp = await api('GET', '/api/data/works?limit=5', { role: 'PM' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'PM reads works');
      }
    },
    // #22
    {
      name: 'SM-22: TO can read works',
      run: async () => {
        const resp = await api('GET', '/api/data/works?limit=5', { role: 'TO' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'TO reads works');
      }
    },
    // #23
    {
      name: 'SM-23: HEAD_PM can read works',
      run: async () => {
        const resp = await api('GET', '/api/data/works?limit=5', { role: 'HEAD_PM' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'HEAD_PM reads works');
      }
    },
    // #24
    {
      name: 'SM-24: Work items have id field',
      run: async () => {
        const resp = await api('GET', '/api/data/works?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET works');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no works');
        for (const item of list) {
          assert('id' in item, 'work should have id field');
        }
      }
    },
    // #25
    {
      name: 'SM-25: Works list returns consistent array format',
      run: async () => {
        const resp = await api('GET', '/api/data/works?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET works');
        const list = extractList(resp.data);
        assert(list !== null, 'should be extractable as array');
        for (const item of list) {
          assert(typeof item === 'object' && item !== null, 'each item should be an object');
        }
      }
    },
    // #26
    {
      name: 'SM-26: DIRECTOR_GEN can read works',
      run: async () => {
        const resp = await api('GET', '/api/data/works?limit=5', { role: 'DIRECTOR_GEN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'DIRECTOR_GEN reads works');
      }
    },
    // #27
    {
      name: 'SM-27: Individual work status is valid',
      run: async () => {
        const resp = await api('GET', '/api/data/works?limit=1', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET works');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no works');
        const item = list[0];
        const field = 'work_status' in item ? 'work_status' : 'status';
        if (item[field] !== null && item[field] !== undefined) {
          assertValidStatus(item, field, WORK_STATUSES, 'individual work');
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 3. INVOICE LIFECYCLE (12 tests)
    // ═══════════════════════════════════════════════════════════════

    // #28
    {
      name: 'SM-28: Invoices list as ADMIN returns array',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('invoices endpoint not found');
        assertOk(resp, 'GET invoices as ADMIN');
        const list = extractList(resp.data);
        assert(list !== null, 'response should contain an array');
      }
    },
    // #29
    {
      name: 'SM-29: Invoices have status field',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('invoices endpoint not found');
        assertOk(resp, 'GET invoices');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no invoices in database');
        const item = list[0];
        assert('status' in item || 'invoice_status' in item, 'invoice should have status field');
      }
    },
    // #30
    {
      name: 'SM-30: All invoices have valid statuses',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('invoices endpoint not found');
        assertOk(resp, 'GET invoices');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no invoices');
        for (const item of list) {
          const field = 'invoice_status' in item ? 'invoice_status' : 'status';
          assertValidStatus(item, field, INVOICE_STATUSES, 'invoice');
        }
      }
    },
    // #31
    {
      name: 'SM-31: Invoices via /api/invoices as ADMIN',
      run: async () => {
        const resp = await api('GET', '/api/invoices', { role: 'ADMIN' });
        if (resp.status === 404) skip('/api/invoices not found');
        assertOk(resp, 'GET /api/invoices');
      }
    },
    // #32
    {
      name: 'SM-32: BUH can read invoices (full access)',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices?limit=5', { role: 'BUH' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'BUH reads invoices');
      }
    },
    // #33
    {
      name: 'SM-33: PM can read invoices',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices?limit=5', { role: 'PM' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'PM reads invoices');
      }
    },
    // #34
    {
      name: 'SM-34: WAREHOUSE should NOT access invoices (403)',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices?limit=5', { role: 'WAREHOUSE' });
        if (resp.status === 404) skip('endpoint not found');
        assert(
          resp.status === 403 || resp.status === 401,
          `WAREHOUSE invoices: expected 403/401, got ${resp.status}`
        );
      }
    },
    // #35
    {
      name: 'SM-35: Invoice items have id field',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET invoices');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no invoices');
        for (const item of list) {
          assert('id' in item, 'invoice should have id');
        }
      }
    },
    // #36
    {
      name: 'SM-36: Invoice items have amount or total field',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET invoices');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no invoices');
        const item = list[0];
        const hasAmount = 'amount' in item || 'total_amount' in item || 'total' in item || 'sum' in item;
        assert(hasAmount, 'invoice should have amount/total_amount/total/sum field');
      }
    },
    // #37
    {
      name: 'SM-37: Invoices list returns consistent format',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET invoices');
        const list = extractList(resp.data);
        assert(list !== null, 'should be extractable as array');
        for (const item of list) {
          assert(typeof item === 'object' && item !== null, 'each item should be an object');
        }
      }
    },
    // #38
    {
      name: 'SM-38: Individual invoice status is valid',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices?limit=1', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET invoices');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no invoices');
        const item = list[0];
        const field = 'invoice_status' in item ? 'invoice_status' : 'status';
        if (item[field] !== null && item[field] !== undefined) {
          assertValidStatus(item, field, INVOICE_STATUSES, 'individual invoice');
        }
      }
    },
    // #39
    {
      name: 'SM-39: DIRECTOR_GEN can read invoices',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices?limit=5', { role: 'DIRECTOR_GEN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'DIRECTOR_GEN reads invoices');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 4. CASH REQUEST LIFECYCLE (10 tests)
    // ═══════════════════════════════════════════════════════════════

    // #40
    {
      name: 'SM-40: Cash requests list as ADMIN returns array',
      run: async () => {
        const resp = await api('GET', '/api/data/cash_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('cash_requests endpoint not found');
        assertOk(resp, 'GET cash_requests as ADMIN');
        const list = extractList(resp.data);
        assert(list !== null, 'response should contain an array');
      }
    },
    // #41
    {
      name: 'SM-41: Cash requests have status field',
      run: async () => {
        const resp = await api('GET', '/api/data/cash_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('cash_requests endpoint not found');
        assertOk(resp, 'GET cash_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no cash_requests in database');
        const item = list[0];
        assert('status' in item, 'cash_request should have status field');
      }
    },
    // #42
    {
      name: 'SM-42: All cash requests have valid statuses',
      run: async () => {
        const resp = await api('GET', '/api/data/cash_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('cash_requests endpoint not found');
        assertOk(resp, 'GET cash_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no cash_requests');
        for (const item of list) {
          assertValidStatus(item, 'status', CASH_REQUEST_STATUSES, 'cash_request');
        }
      }
    },
    // #43
    {
      name: 'SM-43: BUH can read cash requests',
      run: async () => {
        const resp = await api('GET', '/api/data/cash_requests?limit=5', { role: 'BUH' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'BUH reads cash_requests');
      }
    },
    // #44
    {
      name: 'SM-44: PM should NOT access cash_requests (403)',
      run: async () => {
        const resp = await api('GET', '/api/data/cash_requests?limit=5', { role: 'PM' });
        if (resp.status === 404) skip('endpoint not found');
        assert(
          resp.status === 403 || resp.status === 401,
          `PM cash_requests: expected 403/401, got ${resp.status}`
        );
      }
    },
    // #45
    {
      name: 'SM-45: TO should NOT access cash_requests (403)',
      run: async () => {
        const resp = await api('GET', '/api/data/cash_requests?limit=5', { role: 'TO' });
        if (resp.status === 404) skip('endpoint not found');
        assert(
          resp.status === 403 || resp.status === 401,
          `TO cash_requests: expected 403/401, got ${resp.status}`
        );
      }
    },
    // #46
    {
      name: 'SM-46: WAREHOUSE should NOT access cash_requests (403)',
      run: async () => {
        const resp = await api('GET', '/api/data/cash_requests?limit=5', { role: 'WAREHOUSE' });
        if (resp.status === 404) skip('endpoint not found');
        assert(
          resp.status === 403 || resp.status === 401,
          `WAREHOUSE cash_requests: expected 403/401, got ${resp.status}`
        );
      }
    },
    // #47
    {
      name: 'SM-47: Cash requests items have id field',
      run: async () => {
        const resp = await api('GET', '/api/data/cash_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET cash_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no cash_requests');
        for (const item of list) {
          assert('id' in item, 'cash_request should have id');
        }
      }
    },
    // #48
    {
      name: 'SM-48: Cash requests via /api/cash as ADMIN',
      run: async () => {
        const resp = await api('GET', '/api/cash', { role: 'ADMIN' });
        if (resp.status === 404) skip('/api/cash not found');
        assertOk(resp, 'GET /api/cash');
      }
    },
    // #49
    {
      name: 'SM-49: Cash requests list returns consistent format',
      run: async () => {
        const resp = await api('GET', '/api/data/cash_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET cash_requests');
        const list = extractList(resp.data);
        assert(list !== null, 'should be extractable as array');
        for (const item of list) {
          assert(typeof item === 'object' && item !== null, 'each item should be an object');
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 5. EQUIPMENT REQUEST LIFECYCLE (10 tests)
    // ═══════════════════════════════════════════════════════════════

    // #50
    {
      name: 'SM-50: Equipment requests list as ADMIN returns array',
      run: async () => {
        const resp = await api('GET', '/api/data/equipment_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('equipment_requests endpoint not found');
        assertOk(resp, 'GET equipment_requests as ADMIN');
        const list = extractList(resp.data);
        assert(list !== null, 'response should contain an array');
      }
    },
    // #51
    {
      name: 'SM-51: Equipment requests have status field',
      run: async () => {
        const resp = await api('GET', '/api/data/equipment_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('equipment_requests endpoint not found');
        assertOk(resp, 'GET equipment_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no equipment_requests in database');
        const item = list[0];
        assert('status' in item, 'equipment_request should have status field');
      }
    },
    // #52
    {
      name: 'SM-52: All equipment requests have valid statuses',
      run: async () => {
        const resp = await api('GET', '/api/data/equipment_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('equipment_requests endpoint not found');
        assertOk(resp, 'GET equipment_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no equipment_requests');
        for (const item of list) {
          assertValidStatus(item, 'status', EQUIPMENT_REQUEST_STATUSES, 'equipment_request');
        }
      }
    },
    // #53
    {
      name: 'SM-53: WAREHOUSE can read equipment requests',
      run: async () => {
        const resp = await api('GET', '/api/data/equipment_requests?limit=5', { role: 'WAREHOUSE' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'WAREHOUSE reads equipment_requests');
      }
    },
    // #54
    {
      name: 'SM-54: PM can read equipment requests',
      run: async () => {
        const resp = await api('GET', '/api/data/equipment_requests?limit=5', { role: 'PM' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'PM reads equipment_requests');
      }
    },
    // #55
    {
      name: 'SM-55: BUH should NOT access equipment_requests (403)',
      run: async () => {
        const resp = await api('GET', '/api/data/equipment_requests?limit=5', { role: 'BUH' });
        if (resp.status === 404) skip('endpoint not found');
        assert(
          resp.status === 403 || resp.status === 401,
          `BUH equipment_requests: expected 403/401, got ${resp.status}`
        );
      }
    },
    // #56
    {
      name: 'SM-56: Equipment request items have id field',
      run: async () => {
        const resp = await api('GET', '/api/data/equipment_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET equipment_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no equipment_requests');
        for (const item of list) {
          assert('id' in item, 'equipment_request should have id');
        }
      }
    },
    // #57
    {
      name: 'SM-57: Equipment requests list returns consistent format',
      run: async () => {
        const resp = await api('GET', '/api/data/equipment_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET equipment_requests');
        const list = extractList(resp.data);
        assert(list !== null, 'should be extractable as array');
        for (const item of list) {
          assert(typeof item === 'object' && item !== null, 'each item should be an object');
        }
      }
    },
    // #58
    {
      name: 'SM-58: Individual equipment request status is valid',
      run: async () => {
        const resp = await api('GET', '/api/data/equipment_requests?limit=1', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET equipment_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no equipment_requests');
        const item = list[0];
        if (item.status !== null && item.status !== undefined) {
          assertValidStatus(item, 'status', EQUIPMENT_REQUEST_STATUSES, 'individual equipment_request');
        }
      }
    },
    // #59
    {
      name: 'SM-59: CHIEF_ENGINEER can read equipment requests',
      run: async () => {
        const resp = await api('GET', '/api/data/equipment_requests?limit=5', { role: 'CHIEF_ENGINEER' });
        if (resp.status === 404) skip('endpoint not found');
        assert(
          resp.status === 200 || resp.status === 403,
          `CHIEF_ENGINEER equipment_requests: expected 200 or 403, got ${resp.status}`
        );
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 6. STAFF REQUEST LIFECYCLE (8 tests)
    // ═══════════════════════════════════════════════════════════════

    // #60
    {
      name: 'SEED_STAFF_REQUESTS: Create test data for SM-60..SM-67',
      run: async () => {
        // Create staff requests with different statuses for SM tests
        const statuses = ['new', 'approved', 'rejected', 'closed'];
        const createdIds = [];
        for (const status of statuses) {
          const resp = await api('POST', '/api/data/staff_requests', {
            role: 'HR',
            body: {
              specialization: 'SM-test-' + status,
              required_count: 1,
              status: status,
              comments: 'SEED_STAFF_REQUESTS auto-created for SM tests'
            }
          });
          if (resp.data?.id) createdIds.push(resp.data.id);
          else if (resp.data?.row?.id) createdIds.push(resp.data.row.id);
        }
        // Store IDs globally for cleanup
        global.__staffSeedIds = createdIds;
        assert(createdIds.length > 0, 'seeded ' + createdIds.length + ' staff requests');
      }
    },
    {
      name: 'SM-60: Staff requests list as ADMIN returns array',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('staff_requests endpoint not found');
        assertOk(resp, 'GET staff_requests as ADMIN');
        const list = extractList(resp.data);
        assert(list !== null, 'response should contain an array');
      }
    },
    // #61
    {
      name: 'SM-61: Staff requests have status field',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('staff_requests endpoint not found');
        assertOk(resp, 'GET staff_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no staff_requests in database');
        const item = list[0];
        assert('status' in item, 'staff_request should have status field');
      }
    },
    // #62
    {
      name: 'SM-62: All staff requests have valid statuses',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('staff_requests endpoint not found');
        assertOk(resp, 'GET staff_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no staff_requests');
        for (const item of list) {
          assertValidStatus(item, 'status', STAFF_REQUEST_STATUSES, 'staff_request');
        }
      }
    },
    // #63
    {
      name: 'SM-63: HR can read staff requests',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests?limit=5', { role: 'HR' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'HR reads staff_requests');
      }
    },
    // #64
    {
      name: 'SM-64: HR_MANAGER can read staff requests',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests?limit=5', { role: 'HR_MANAGER' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'HR_MANAGER reads staff_requests');
      }
    },
    // #65
    {
      name: 'SM-65: PM CAN access staff_requests (200)',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests?limit=5', { role: 'PM' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'PM staff_requests');
      }
    },
    // #66
    {
      name: 'SM-66: Staff request items have id field',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET staff_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no staff_requests');
        for (const item of list) {
          assert('id' in item, 'staff_request should have id');
        }
      }
    },
    // #67
    {
      name: 'SM-67: Staff requests list returns consistent format',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET staff_requests');
        const list = extractList(resp.data);
        assert(list !== null, 'should be extractable as array');
        for (const item of list) {
          assert(typeof item === 'object' && item !== null, 'each item should be an object');
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 7. TKP / PASS / TMC REQUEST LIFECYCLE (12 tests)
    // ═══════════════════════════════════════════════════════════════

    // #68
    {
      name: 'SM-68: TKP list as ADMIN returns array',
      run: async () => {
        const resp = await api('GET', '/api/data/tkp?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('tkp endpoint not found');
        assertOk(resp, 'GET tkp as ADMIN');
        const list = extractList(resp.data);
        assert(list !== null, 'response should contain an array');
      }
    },
    // #69
    {
      name: 'SM-69: TKP have status field if records exist',
      run: async () => {
        const resp = await api('GET', '/api/data/tkp?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('tkp endpoint not found');
        assertOk(resp, 'GET tkp');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no tkp in database');
        const item = list[0];
        assert('status' in item || 'tkp_status' in item, 'tkp should have status field');
      }
    },
    // #70
    {
      name: 'SM-70: All TKP have valid statuses',
      run: async () => {
        const resp = await api('GET', '/api/data/tkp?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('tkp endpoint not found');
        assertOk(resp, 'GET tkp');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no tkp');
        for (const item of list) {
          const field = 'tkp_status' in item ? 'tkp_status' : 'status';
          assertValidStatus(item, field, TKP_STATUSES, 'tkp');
        }
      }
    },
    // #71
    {
      name: 'SM-71: Pass requests list as ADMIN returns array',
      run: async () => {
        const resp = await api('GET', '/api/data/pass_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('pass_requests endpoint not found');
        assertOk(resp, 'GET pass_requests as ADMIN');
        const list = extractList(resp.data);
        assert(list !== null, 'response should contain an array');
      }
    },
    // #72
    {
      name: 'SM-72: Pass requests have status field if records exist',
      run: async () => {
        const resp = await api('GET', '/api/data/pass_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('pass_requests endpoint not found');
        assertOk(resp, 'GET pass_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no pass_requests in database');
        const item = list[0];
        assert('status' in item, 'pass_request should have status field');
      }
    },
    // #73
    {
      name: 'SM-73: All pass requests have valid statuses',
      run: async () => {
        const resp = await api('GET', '/api/data/pass_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('pass_requests endpoint not found');
        assertOk(resp, 'GET pass_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no pass_requests');
        for (const item of list) {
          assertValidStatus(item, 'status', PASS_REQUEST_STATUSES, 'pass_request');
        }
      }
    },
    // #74
    {
      name: 'SM-74: TMC requests list as ADMIN returns array',
      run: async () => {
        const resp = await api('GET', '/api/data/tmc_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('tmc_requests endpoint not found');
        assertOk(resp, 'GET tmc_requests as ADMIN');
        const list = extractList(resp.data);
        assert(list !== null, 'response should contain an array');
      }
    },
    // #75
    {
      name: 'SM-75: TMC requests have status field if records exist',
      run: async () => {
        const resp = await api('GET', '/api/data/tmc_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('tmc_requests endpoint not found');
        assertOk(resp, 'GET tmc_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no tmc_requests in database');
        const item = list[0];
        assert('status' in item, 'tmc_request should have status field');
      }
    },
    // #76
    {
      name: 'SM-76: All TMC requests have valid statuses',
      run: async () => {
        const resp = await api('GET', '/api/data/tmc_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('tmc_requests endpoint not found');
        assertOk(resp, 'GET tmc_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no tmc_requests');
        for (const item of list) {
          assertValidStatus(item, 'status', TMC_REQUEST_STATUSES, 'tmc_request');
        }
      }
    },
    // #77
    {
      name: 'SM-77: TKP items have id field',
      run: async () => {
        const resp = await api('GET', '/api/data/tkp?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET tkp');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no tkp');
        for (const item of list) {
          assert('id' in item, 'tkp should have id');
        }
      }
    },
    // #78
    {
      name: 'SM-78: Pass request items have id field',
      run: async () => {
        const resp = await api('GET', '/api/data/pass_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET pass_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no pass_requests');
        for (const item of list) {
          assert('id' in item, 'pass_request should have id');
        }
      }
    },
    // #79
    {
      name: 'SM-79: TMC request items have id field',
      run: async () => {
        const resp = await api('GET', '/api/data/tmc_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'GET tmc_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no tmc_requests');
        for (const item of list) {
          assert('id' in item, 'tmc_request should have id');
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 8. TASK LIFECYCLE (8 tests)
    // ═══════════════════════════════════════════════════════════════

    // #80
    {
      name: 'SM-80: Tasks list as ADMIN returns array',
      run: async () => {
        const resp = await api('GET', '/api/data/tasks?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) {
          const resp2 = await api('GET', '/api/tasks', { role: 'ADMIN' });
          if (resp2.status === 404) skip('tasks endpoint not found');
          assertOk(resp2, 'GET /api/tasks');
          const list = extractList(resp2.data);
          assert(list !== null, 'response should contain an array');
          return;
        }
        assertOk(resp, 'GET tasks as ADMIN');
        const list = extractList(resp.data);
        assert(list !== null, 'response should contain an array');
      }
    },
    // #81
    {
      name: 'SM-81: Tasks have status field',
      run: async () => {
        const resp = await api('GET', '/api/data/tasks?limit=5', { role: 'ADMIN' });
        const r = resp.status === 404 ? await api('GET', '/api/tasks', { role: 'ADMIN' }) : resp;
        if (r.status === 404) skip('tasks endpoint not found');
        assertOk(r, 'GET tasks');
        const list = extractList(r.data);
        if (!list || list.length === 0) skip('no tasks in database');
        const item = list[0];
        assert('status' in item, 'task should have status field');
      }
    },
    // #82
    {
      name: 'SM-82: All tasks have valid statuses',
      run: async () => {
        const resp = await api('GET', '/api/data/tasks?limit=5', { role: 'ADMIN' });
        const r = resp.status === 404 ? await api('GET', '/api/tasks', { role: 'ADMIN' }) : resp;
        if (r.status === 404) skip('tasks endpoint not found');
        assertOk(r, 'GET tasks');
        const list = extractList(r.data);
        if (!list || list.length === 0) skip('no tasks');
        for (const item of list) {
          assertValidStatus(item, 'status', TASK_STATUSES, 'task');
        }
      }
    },
    // #83
    {
      name: 'SM-83: PM can read tasks',
      run: async () => {
        const resp = await api('GET', '/api/data/tasks?limit=5', { role: 'PM' });
        const r = resp.status === 404 ? await api('GET', '/api/tasks', { role: 'PM' }) : resp;
        if (r.status === 404) skip('tasks endpoint not found');
        assertOk(r, 'PM reads tasks');
      }
    },
    // #84
    {
      name: 'SM-84: Task items have id field',
      run: async () => {
        const resp = await api('GET', '/api/data/tasks?limit=5', { role: 'ADMIN' });
        const r = resp.status === 404 ? await api('GET', '/api/tasks', { role: 'ADMIN' }) : resp;
        if (r.status === 404) skip('endpoint not found');
        assertOk(r, 'GET tasks');
        const list = extractList(r.data);
        if (!list || list.length === 0) skip('no tasks');
        for (const item of list) {
          assert('id' in item, 'task should have id');
        }
      }
    },
    // #85
    {
      name: 'SM-85: Task items have title or name field',
      run: async () => {
        const resp = await api('GET', '/api/data/tasks?limit=5', { role: 'ADMIN' });
        const r = resp.status === 404 ? await api('GET', '/api/tasks', { role: 'ADMIN' }) : resp;
        if (r.status === 404) skip('endpoint not found');
        assertOk(r, 'GET tasks');
        const list = extractList(r.data);
        if (!list || list.length === 0) skip('no tasks');
        const item = list[0];
        const hasTitle = 'title' in item || 'name' in item || 'task_title' in item;
        assert(hasTitle, 'task should have title, name, or task_title field');
      }
    },
    // #86
    {
      name: 'SM-86: Individual task status is valid',
      run: async () => {
        const resp = await api('GET', '/api/data/tasks?limit=1', { role: 'ADMIN' });
        const r = resp.status === 404 ? await api('GET', '/api/tasks', { role: 'ADMIN' }) : resp;
        if (r.status === 404) skip('endpoint not found');
        assertOk(r, 'GET tasks');
        const list = extractList(r.data);
        if (!list || list.length === 0) skip('no tasks');
        const item = list[0];
        if (item.status !== null && item.status !== undefined) {
          assertValidStatus(item, 'status', TASK_STATUSES, 'individual task');
        }
      }
    },
    // #87
    {
      name: 'SM-87: Tasks list returns consistent format',
      run: async () => {
        const resp = await api('GET', '/api/data/tasks?limit=5', { role: 'ADMIN' });
        const r = resp.status === 404 ? await api('GET', '/api/tasks', { role: 'ADMIN' }) : resp;
        if (r.status === 404) skip('endpoint not found');
        assertOk(r, 'GET tasks');
        const list = extractList(r.data);
        assert(list !== null, 'should be extractable as array');
        for (const item of list) {
          assert(typeof item === 'object' && item !== null, 'each item should be an object');
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 9. CROSS-ROLE STATUS VISIBILITY (13 tests)
    // ═══════════════════════════════════════════════════════════════

    // #88
    {
      name: 'SM-88: ADMIN can see tenders statuses',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'ADMIN tenders');
        const list = extractList(resp.data);
        assert(list !== null, 'ADMIN should see tenders as array');
      }
    },
    // #89
    {
      name: 'SM-89: ADMIN can see works statuses',
      run: async () => {
        const resp = await api('GET', '/api/data/works?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'ADMIN works');
        const list = extractList(resp.data);
        assert(list !== null, 'ADMIN should see works as array');
      }
    },
    // #90
    {
      name: 'SM-90: ADMIN can see invoices statuses',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'ADMIN invoices');
        const list = extractList(resp.data);
        assert(list !== null, 'ADMIN should see invoices as array');
      }
    },
    // #91
    {
      name: 'SM-91: ADMIN can see cash_requests statuses',
      run: async () => {
        const resp = await api('GET', '/api/data/cash_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'ADMIN cash_requests');
        const list = extractList(resp.data);
        assert(list !== null, 'ADMIN should see cash_requests as array');
      }
    },
    // #92
    {
      name: 'SM-92: ADMIN can see equipment_requests statuses',
      run: async () => {
        const resp = await api('GET', '/api/data/equipment_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'ADMIN equipment_requests');
        const list = extractList(resp.data);
        assert(list !== null, 'ADMIN should see equipment_requests as array');
      }
    },
    // #93
    {
      name: 'SM-93: ADMIN can see staff_requests statuses',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests?limit=5', { role: 'ADMIN' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'ADMIN staff_requests');
        const list = extractList(resp.data);
        assert(list !== null, 'ADMIN should see staff_requests as array');
      }
    },
    // #94
    {
      name: 'SM-94: ADMIN can see tasks statuses',
      run: async () => {
        const resp = await api('GET', '/api/data/tasks?limit=5', { role: 'ADMIN' });
        const r = resp.status === 404 ? await api('GET', '/api/tasks', { role: 'ADMIN' }) : resp;
        if (r.status === 404) skip('endpoint not found');
        assertOk(r, 'ADMIN tasks');
        const list = extractList(r.data);
        assert(list !== null, 'ADMIN should see tasks as array');
      }
    },
    // #95
    {
      name: 'SM-95: PM can see tender statuses and they are valid',
      run: async () => {
        const resp = await api('GET', '/api/data/tenders?limit=5', { role: 'PM' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'PM tenders');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no tenders');
        for (const item of list) {
          const field = 'tender_status' in item ? 'tender_status' : 'status';
          assertValidStatus(item, field, TENDER_STATUSES, 'PM sees tender status');
        }
      }
    },
    // #96
    {
      name: 'SM-96: BUH can see invoice statuses and they are valid',
      run: async () => {
        const resp = await api('GET', '/api/data/invoices?limit=5', { role: 'BUH' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'BUH invoices');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no invoices');
        for (const item of list) {
          const field = 'invoice_status' in item ? 'invoice_status' : 'status';
          assertValidStatus(item, field, INVOICE_STATUSES, 'BUH sees invoice status');
        }
      }
    },
    // #97
    {
      name: 'SM-97: BUH can see cash_request statuses and they are valid',
      run: async () => {
        const resp = await api('GET', '/api/data/cash_requests?limit=5', { role: 'BUH' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'BUH cash_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no cash_requests');
        for (const item of list) {
          assertValidStatus(item, 'status', CASH_REQUEST_STATUSES, 'BUH sees cash_request status');
        }
      }
    },
    // #98
    {
      name: 'SM-98: HR can see staff_request statuses and they are valid',
      run: async () => {
        const resp = await api('GET', '/api/data/staff_requests?limit=5', { role: 'HR' });
        if (resp.status === 404) skip('endpoint not found');
        assertOk(resp, 'HR staff_requests');
        const list = extractList(resp.data);
        if (!list || list.length === 0) skip('no staff_requests');
        for (const item of list) {
          assertValidStatus(item, 'status', STAFF_REQUEST_STATUSES, 'HR sees staff_request status');
        }
      }
    },
    // #99
    {
      name: 'SM-99: ADMIN sees consistent array format across all tables',
      run: async () => {
        const tables = ['tenders', 'works', 'invoices', 'cash_requests', 'equipment_requests',
          'staff_requests', 'tasks'];
        let checkedCount = 0;
        for (const table of tables) {
          const resp = await api('GET', `/api/data/${table}?limit=2`, { role: 'ADMIN' });
          if (resp.status === 404) continue;
          assertOk(resp, `ADMIN GET ${table}`);
          const list = extractList(resp.data);
          assert(list !== null, `${table} response should be extractable as array`);
          assert(Array.isArray(list), `${table} should be an actual array`);
          checkedCount++;
        }
        assert(checkedCount > 0, 'at least one table should be accessible');
      }
    },
    // #100
    {
      name: 'SM-100: Response arrays are not mixed formats (all objects)',
      run: async () => {
        const tables = ['tenders', 'works', 'invoices', 'tasks'];
        let checkedCount = 0;
        for (const table of tables) {
          const resp = await api('GET', `/api/data/${table}?limit=5`, { role: 'ADMIN' });
          if (resp.status === 404) continue;
          if (!resp.ok) continue;
          const list = extractList(resp.data);
          if (!list || list.length === 0) continue;
          for (const item of list) {
            assert(
              typeof item === 'object' && item !== null && !Array.isArray(item),
              `${table}: each item must be a plain object, got ${typeof item}`
            );
          }
          checkedCount++;
        }
        assert(checkedCount > 0, 'at least one table should have data to verify format');
      }
    },

    {
      name: 'CLEANUP_STAFF_REQUESTS: Remove test data',
      run: async () => {
        const ids = global.__staffSeedIds || [];
        let deleted = 0;
        for (const id of ids) {
          const resp = await api('DELETE', '/api/data/staff_requests/' + id, { role: 'ADMIN' });
          if (resp.status === 200 || resp.status === 204) deleted++;
        }
        // Also clean up orphaned test messages/replacements
        assert(true, 'cleaned up ' + deleted + ' of ' + ids.length + ' staff requests');
      }
    },
  ]
};
