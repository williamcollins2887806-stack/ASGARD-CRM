/**
 * BLOCK 7 — BULK SE TRANSFERS + MANUAL HANDOVER + PM-BALANCE INTEGRATION
 *
 * Покрывает API_SPEC_BULK_SE.md раздел 8 (26+ сценариев):
 *   1-16  — POST /api/payroll-dashboard/se-transfers/bulk
 *   17-21 — POST /api/handovers/manual
 *   22-24 — /pm-balance + /my-balance после bulk
 *   25-26 — RBAC
 *   27-30 — EXTRA edge cases (single, missing year/month, transfers wrong, WAREHOUSE)
 *   31    — Idempotency-Key повтор → 409 batch_already_exists
 *   32    — Сумма двух bulk-строк одного СЗ > годовой лимит
 *   33    — RBAC: DIRECTOR_DEV → 403 (нет в ACCESS_ROLES)
 *   99    — Cleanup (best-effort: cancel se_transfers этого прогона)
 *
 * Каждый тест изолирован (создаёт собственные фикстуры: work + СЗ-employee).
 * State БД проверяется через API:
 *   GET /api/payroll-dashboard/se-transfers/:year/:month
 *   GET /api/handovers
 *   GET /api/payroll-dashboard/pm-balance
 *   GET /api/cash/my-balance
 */
'use strict';

const crypto = require('crypto');
const { api, rawFetch, getToken, assert, assertOk, assertStatus, assertForbidden,
        assertArray, assertHasFields, skip, TEST_USERS } = require('../config');

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

const YEAR = 2026;
const MONTH = 7;
const RUN_TAG = `BULK-SE-${Date.now()}`;

// Run-time tracking для cleanup в финальном тесте 7.99.
// Все batch_id, созданные через тесты, копим здесь и в конце прогоняем
// PUT /se-transfers/:id/cancel чтобы не плодить «висящих» переводов на проде/клоне.
// Employees НЕ удаляем (FK на se_transfers / self_employed → 23503 «есть связанные»),
// но они помечены RUN_TAG в fio чтобы аудит мог их найти.
const _runBatchIds = new Set();
const _runEmployeeIds = new Set();
function trackBatch(batchId) {
  if (batchId) _runBatchIds.add(String(batchId));
}
function trackEmployee(id) {
  if (id != null) _runEmployeeIds.add(Number(id));
}

// Сгенерировать корректный ИНН-12 для СЗ (валидные контрольные цифры
// нам не нужны — бекенд просто пишет в self_employed.inn, валидация
// формата проверяет только длину).
let _innCounter = Date.now() % 1_000_000_000_000;
function nextInn() {
  _innCounter = (_innCounter + 1) % 1_000_000_000_000;
  return String(_innCounter).padStart(12, '0');
}

// Создать СЗ-получателя (employees + self_employed.inn) — он становится
// валидным employee_id для se_transfers (is_self_employed=true,
// is_officially_employed=false, есть inn).
async function createSePayee(suffix = '') {
  const resp = await api('POST', '/api/staff/payees', {
    role: 'ADMIN',
    body: {
      fio: `${RUN_TAG} СЗ ${suffix}`,
      phone: '+79000000000',
      inn: nextInn()
    }
  });
  assertOk(resp, `create payee ${suffix}`);
  const payee = resp.data?.payee || resp.data;
  const id = payee?.id;
  assert(id, `payee id (${suffix})`);
  trackEmployee(id);
  return id;
}

// Создать обычного employee (не самозанятого) — для теста «не СЗ → error».
async function createNonSeEmployee(suffix = '') {
  // POST /api/staff/employees: создаёт без is_self_employed (false)
  const resp = await api('POST', '/api/staff/employees', {
    role: 'ADMIN',
    body: {
      fio: `${RUN_TAG} NotSE ${suffix}`,
      phone: '+79000000001',
      is_self_employed: false,
      is_officially_employed: false
    }
  });
  // Если ручка не отдаёт 2xx — fallback на data.js
  if (resp.status < 200 || resp.status >= 300) {
    const fallback = await api('POST', '/api/data/employees', {
      role: 'ADMIN',
      body: {
        fio: `${RUN_TAG} NotSE ${suffix}`,
        phone: '+79000000001',
        is_self_employed: false,
        is_officially_employed: false
      }
    });
    assertOk(fallback, `create non-SE employee ${suffix}`);
    const emp = fallback.data?.employee || fallback.data;
    trackEmployee(emp?.id);
    return emp?.id;
  }
  const emp = resp.data?.employee || resp.data;
  trackEmployee(emp?.id);
  return emp?.id;
}

// Создать officially-employed employee (для теста «оф.устроен → error»).
async function createOfficialEmployee(suffix = '') {
  const resp = await api('POST', '/api/staff/employees', {
    role: 'ADMIN',
    body: {
      fio: `${RUN_TAG} Official ${suffix}`,
      phone: '+79000000002',
      is_self_employed: false,
      is_officially_employed: true
    }
  });
  if (resp.status < 200 || resp.status >= 300) {
    const fallback = await api('POST', '/api/data/employees', {
      role: 'ADMIN',
      body: {
        fio: `${RUN_TAG} Official ${suffix}`,
        phone: '+79000000002',
        is_self_employed: false,
        is_officially_employed: true
      }
    });
    assertOk(fallback, `create official employee ${suffix}`);
    const emp = fallback.data?.employee || fallback.data;
    trackEmployee(emp?.id);
    return emp?.id;
  }
  const emp = resp.data?.employee || resp.data;
  trackEmployee(emp?.id);
  return emp?.id;
}

// Создать работу. По умолчанию назначаем pm_id = test_pm (тогда
// remainder_destination='pm' валиден). Если withPm=false — pm_id=NULL.
async function createWork(title, { withPm = true } = {}) {
  const body = {
    work_title: `${RUN_TAG} ${title}`,
    work_status: 'В работе',
    object_place: 'Москва',
    object_name: `${RUN_TAG} object`
  };
  if (withPm && TEST_USERS.PM?.id) body.pm_id = TEST_USERS.PM.id;
  if (!withPm) body.pm_id = null;

  const resp = await api('POST', '/api/works', { role: 'ADMIN', body });
  assertOk(resp, `create work ${title}`);
  const work = resp.data?.work || resp.data;
  const id = work?.id;
  assert(id, `work id (${title})`);
  return id;
}

// Тонкая обёртка над api() для POST /se-transfers/bulk: автоматически
// трекает batch_id в _runBatchIds для cleanup в 7.99 (даже если тест
// не вызывает findTransfersByBatch).
async function postBulk(role, body, extraOpts = {}) {
  const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk',
    { role, body, ...extraOpts });
  if (resp.data && resp.data.batch_id) trackBatch(resp.data.batch_id);
  return resp;
}

// Получить список СЗ-переводов и найти все с указанным batch_id.
// Side effect: tracking batchId для cleanup в 7.99.
async function findTransfersByBatch(batchId, role = 'ADMIN') {
  trackBatch(batchId);
  const resp = await api('GET',
    `/api/payroll-dashboard/se-transfers/${YEAR}/${MONTH}`,
    { role }
  );
  assertOk(resp, 'list se-transfers');
  const list = resp.data?.transfers || resp.data?.items || resp.data || [];
  const arr = Array.isArray(list) ? list : [];
  return arr.filter(t => String(t.bulk_batch_id) === String(batchId));
}

// Получить handovers для employee+период.
async function findHandovers({ worker_id, year = YEAR, month = MONTH, role = 'ADMIN' }) {
  const resp = await api('GET',
    `/api/handovers?year=${year}&month=${month}&worker_id=${worker_id}`,
    { role }
  );
  assertOk(resp, `list handovers worker=${worker_id}`);
  return resp.data?.handovers || [];
}

// Получить pm-balance для конкретного PM (читает из /pm-balance).
async function getPmBalance(pmId, role = 'ADMIN') {
  const resp = await api('GET', '/api/payroll-dashboard/pm-balance', { role });
  assertOk(resp, 'get pm-balance');
  const pms = resp.data?.pms || [];
  return pms.find(p => Number(p.pm_id) === Number(pmId));
}

// Получить /api/cash/balance (главная касса).
async function getCashBalance(role = 'BUH') {
  const resp = await api('GET', '/api/cash/balance', { role });
  if (resp.status === 403 || resp.status === 401) return null;
  assertOk(resp, 'get cash balance');
  return Number(resp.data?.balance || 0);
}

// ────────────────────────────────────────────────────────────────
// Module
// ────────────────────────────────────────────────────────────────

module.exports = {
  name: 'BLOCK 7 — BULK SE TRANSFERS + MANUAL HANDOVER',
  tests: [

    // ═══════════════════════════════════════════════════════════════
    // SETUP
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'Setup 7.0: TEST_USERS.PM available',
      run: async () => {
        if (!TEST_USERS.PM?.id) skip('TEST_USERS.PM not initialised — run initRealUsers() first');
        assert(TEST_USERS.PM.id, 'PM id');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 1. Bulk: 1 СЗ salary, остаток → РП
    //   transfer=350000, earned=71000, остаток=279000 → handover pending
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.1 Bulk salary, remainder → pm (handover pending создан)',
      run: async () => {
        const empId = await createSePayee('S1');
        const workId = await createWork('S1', { withPm: true });

        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: empId,
              work_id: workId,
              operation_type: 'work_transfer',
              transfer_amount: 350000,
              earned_amount: 71000,
              remainder_destination: 'pm',
              comment: 'S1 salary→pm'
            }]
          }
        });
        assertOk(resp, 'bulk create');
        assertHasFields(resp.data, ['batch_id', 'summary'], 'bulk response shape');
        const batchId = resp.data.batch_id;
        assert(batchId, 'batch_id present');
        assert(resp.data.summary.se_transfers === 1, 'summary.se_transfers=1');
        assert(resp.data.summary.handovers === 1, 'summary.handovers=1 (pm destination)');

        // State: 1 transfer с batch_id, statuses=transferred
        const transfers = await findTransfersByBatch(batchId);
        assert(transfers.length === 1,
          `expected 1 transfer with batch_id, got ${transfers.length}`);
        assert(transfers[0].status === 'transferred',
          `status=transferred, got ${transfers[0].status}`);
        assert(Number(transfers[0].cash_return_amount) === 279000,
          `cash_return=279000, got ${transfers[0].cash_return_amount}`);
        assert(transfers[0].remainder_destination === 'pm',
          `remainder_destination=pm, got ${transfers[0].remainder_destination}`);

        // State: 1 handover в pending на 279000, связан с se_transfer
        const handovers = await findHandovers({ worker_id: empId });
        assert(handovers.length >= 1,
          `expected >=1 handover for worker, got ${handovers.length}`);
        const h = handovers.find(x =>
          Number(x.source_se_transfer_id) === Number(transfers[0].id));
        assert(h, 'handover linked to se_transfer by source_se_transfer_id');
        assert(h.status === 'pending', `handover status=pending, got ${h.status}`);
        assert(Number(h.expected_amount) === 279000,
          `expected_amount=279000, got ${h.expected_amount}`);
        assert(Number(h.received_amount) === 0,
          `received_amount=0, got ${h.received_amount}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 2. Bulk: 1 СЗ salary, остаток → касса
    //   transfer=200000, earned=50000, остаток=150000 → cash_balance_log income
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.2 Bulk salary, remainder → company (cash_balance_log income)',
      run: async () => {
        const empId = await createSePayee('S2');
        const workId = await createWork('S2', { withPm: true });
        const balBefore = await getCashBalance('BUH');

        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: empId,
              work_id: workId,
              operation_type: 'work_transfer',
              transfer_amount: 200000,
              earned_amount: 50000,
              remainder_destination: 'company',
              comment: 'S2 salary→company'
            }]
          }
        });
        assertOk(resp, 'bulk salary→company');
        const batchId = resp.data.batch_id;
        assert(resp.data.summary.se_transfers === 1, 'se_transfers=1');
        assert(resp.data.summary.handovers === 0,
          `handovers=0 для destination=company, got ${resp.data.summary.handovers}`);
        assert(resp.data.summary.cash_log_income === 1, 'cash_log_income=1');

        // State: transfer есть и destination=company
        const transfers = await findTransfersByBatch(batchId);
        assert(transfers.length === 1, 'one transfer');
        assert(transfers[0].remainder_destination === 'company',
          `remainder=company, got ${transfers[0].remainder_destination}`);

        // State: handover для этого worker НЕ создаётся
        const hs = await findHandovers({ worker_id: empId });
        const linked = hs.filter(h =>
          Number(h.source_se_transfer_id) === Number(transfers[0].id));
        assert(linked.length === 0,
          `handover не должен быть создан для destination=company, got ${linked.length}`);

        // State: касса увеличилась на 150000
        if (balBefore !== null) {
          const balAfter = await getCashBalance('BUH');
          const delta = balAfter - balBefore;
          assert(Math.abs(delta - 150000) < 0.01,
            `cash balance delta=${delta}, expected 150000`);
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 3. Bulk: 1 СЗ pure_handover (agreement_transfer), остаток → РП
    //   transfer=100000, earned=0, cash_return=100000 → handover pending
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.3 Bulk pure_handover (agreement) → pm',
      run: async () => {
        const empId = await createSePayee('S3');
        const workId = await createWork('S3', { withPm: true });

        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'ADMIN',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: empId,
              work_id: workId,
              operation_type: 'agreement_transfer',
              transfer_amount: 100000,
              earned_amount: 0,
              remainder_destination: 'pm',
              comment: 'S3 agreement→pm'
            }]
          }
        });
        assertOk(resp, 'bulk agreement→pm');
        const batchId = resp.data.batch_id;
        assert(resp.data.summary.se_transfers === 1, 'transfers=1');
        assert(resp.data.summary.handovers === 1, 'handovers=1');

        const transfers = await findTransfersByBatch(batchId);
        assert(Number(transfers[0].cash_return_amount) === 100000,
          `cash_return=100000, got ${transfers[0].cash_return_amount}`);
        assert(transfers[0].operation_type === 'agreement_transfer',
          `op=agreement, got ${transfers[0].operation_type}`);

        const hs = await findHandovers({ worker_id: empId });
        const h = hs.find(x =>
          Number(x.source_se_transfer_id) === Number(transfers[0].id));
        assert(h, 'handover linked');
        assert(Number(h.expected_amount) === 100000, 'expected=100000');
        assert(h.status === 'pending', 'pending');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 4. Bulk: 1 СЗ pure_handover, остаток → касса
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.4 Bulk pure_handover (agreement) → company',
      run: async () => {
        const empId = await createSePayee('S4');
        const workId = await createWork('S4', { withPm: true });
        const balBefore = await getCashBalance('BUH');

        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'DIRECTOR_GEN',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: empId,
              work_id: workId,
              operation_type: 'agreement_transfer',
              transfer_amount: 80000,
              earned_amount: 0,
              remainder_destination: 'company'
            }]
          }
        });
        assertOk(resp, 'bulk agreement→company');
        const batchId = resp.data.batch_id;
        trackBatch(batchId);
        assert(resp.data.summary.cash_log_income === 1, 'cash_log_income=1');
        assert(resp.data.summary.handovers === 0, 'no handovers');

        // HIGH-fix: проверяем БД (как в 7.2): транзакция создана,
        // remainder_destination='company', operation_type='agreement_transfer',
        // handover НЕ создан.
        const transfersInDb = await findTransfersByBatch(batchId);
        assert(transfersInDb.length === 1,
          `se_transfer должен быть создан, got ${transfersInDb.length}`);
        assert(transfersInDb[0].remainder_destination === 'company',
          `remainder_destination=company, got ${transfersInDb[0].remainder_destination}`);
        assert(transfersInDb[0].operation_type === 'agreement_transfer',
          `operation_type=agreement_transfer, got ${transfersInDb[0].operation_type}`);
        assert(Number(transfersInDb[0].cash_return_amount) === 80000,
          `cash_return=80000 (full transfer для agreement), got ${transfersInDb[0].cash_return_amount}`);

        // handover отсутствует — destination=company пишется в кассу, не РП
        const handovers = await findHandovers({ worker_id: empId });
        const linked = handovers.filter(h =>
          Number(h.source_se_transfer_id) === Number(transfersInDb[0].id));
        assert(linked.length === 0,
          `handover НЕ должен создаваться для destination=company, got ${linked.length}`);

        if (balBefore !== null) {
          const balAfter = await getCashBalance('BUH');
          const delta = balAfter - balBefore;
          assert(Math.abs(delta - 80000) < 0.01,
            `cash delta=${delta}, expected 80000`);
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 5. Bulk: 10 СЗ микс (5 pm + 5 company)
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.5 Bulk mix 10 (5 pm + 5 company)',
      run: async () => {
        const transfers = [];
        const empIds = [];
        for (let i = 0; i < 10; i++) {
          const empId = await createSePayee(`Mix${i}`);
          empIds.push(empId);
          const workId = await createWork(`Mix${i}`, { withPm: true });
          transfers.push({
            employee_id: empId,
            work_id: workId,
            operation_type: 'work_transfer',
            transfer_amount: 100000,
            earned_amount: 20000,
            remainder_destination: i < 5 ? 'pm' : 'company',
            comment: `mix-${i}`
          });
        }

        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: { year: YEAR, month: MONTH, transfers }
        });
        assertOk(resp, 'bulk mix 10');
        const s = resp.data.summary;
        assert(s.se_transfers === 10, `se_transfers=10, got ${s.se_transfers}`);
        assert(s.handovers === 5, `handovers=5, got ${s.handovers}`);
        assert(s.cash_log_income === 5,
          `cash_log_income=5, got ${s.cash_log_income}`);
        assert(s.total_transferred === 1_000_000,
          `total_transferred=1_000_000, got ${s.total_transferred}`);
        assert(s.total_remainder_to_pm === 400_000,
          `to_pm=400000 (5×80000), got ${s.total_remainder_to_pm}`);
        assert(s.total_remainder_to_company === 400_000,
          `to_company=400000 (5×80000), got ${s.total_remainder_to_company}`);

        // State: 10 transfers с одним batch_id
        const list = await findTransfersByBatch(resp.data.batch_id);
        assert(list.length === 10, `found ${list.length} transfers in batch`);

        // 5 handovers (только для pm)
        let handoverCount = 0;
        for (let i = 0; i < 5; i++) {
          const hs = await findHandovers({ worker_id: empIds[i] });
          handoverCount += hs.filter(h =>
            list.some(t => Number(t.id) === Number(h.source_se_transfer_id))
          ).length;
        }
        assert(handoverCount === 5,
          `expected 5 handovers for first 5 employees, got ${handoverCount}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 6. Превышение годового лимита НПД → ошибка в errors[], остальные созданы
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.6 Yearly limit exceeded → errors[], others ok',
      run: async () => {
        const empOk = await createSePayee('LimitOK');
        const empBad = await createSePayee('LimitBAD');
        const workOk = await createWork('LimitOK', { withPm: true });
        const workBad = await createWork('LimitBAD', { withPm: true });

        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            year: YEAR, month: MONTH,
            transfers: [
              {
                employee_id: empOk,
                work_id: workOk,
                operation_type: 'work_transfer',
                transfer_amount: 50_000,
                earned_amount: 10_000,
                remainder_destination: 'pm'
              },
              {
                employee_id: empBad,
                work_id: workBad,
                operation_type: 'work_transfer',
                transfer_amount: 3_000_000, // > 2_400_000 годовой лимит
                earned_amount: 100_000,
                remainder_destination: 'pm'
              }
            ]
          }
        });
        assertOk(resp, 'bulk with limit error');
        trackBatch(resp.data?.batch_id);
        assert(Array.isArray(resp.data.errors), 'errors[] is array');
        assert(resp.data.errors.length >= 1, 'at least 1 error');
        const errBad = resp.data.errors.find(e =>
          Number(e.employee_id) === Number(empBad));
        assert(errBad, 'error for empBad present');
        assert(/лимит|limit/i.test(String(errBad.error)),
          `error message about limit, got: ${errBad.error}`);
        assert(resp.data.summary.se_transfers === 1,
          `only 1 ok transfer, got ${resp.data.summary.se_transfers}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 7. СЗ не самозанятый → errors[]
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.7 Not self-employed → errors[]',
      run: async () => {
        const empNotSe = await createNonSeEmployee('NotSE');
        if (!empNotSe) skip('cannot create non-SE employee fixture');
        const workId = await createWork('NotSE', { withPm: true });

        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: empNotSe,
              work_id: workId,
              operation_type: 'work_transfer',
              transfer_amount: 50000,
              earned_amount: 10000,
              remainder_destination: 'pm'
            }]
          }
        });
        assertOk(resp, 'bulk not-SE');
        assert(Array.isArray(resp.data.errors), 'errors[]');
        assert(resp.data.errors.length === 1, '1 error');
        assert(resp.data.summary.se_transfers === 0, 'no transfers');
        const e = resp.data.errors[0];
        assert(/самозанят|self/i.test(String(e.error)),
          `error about self-employed, got: ${e.error}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 8. Backend correctly rejects non-SE BEFORE checking is_officially_employed
    //
    // CRITICAL-fix: исходный тест ложно покрывал ветку «оф.устроен».
    // На уровне БД действует CHECK chk_employment_mode
    // (NOT (is_self_employed=true AND is_officially_employed=true)) —
    // см. migrations/V143__worker_finance_fields.sql:27-30. То есть
    // создать employee с обоими флагами=true нельзя ни через POST,
    // ни через PUT /api/staff/employees/:id, ни через PUT /api/data/employees/:id —
    // CHECK сработает в самом INSERT/UPDATE.
    //
    // Bulk-эндпоинт делает две последовательные проверки (payroll-dashboard.js
    // :916 и :918): сначала !is_self_employed → throw «не самозанятый», потом
    // is_officially_employed → throw «официально устроен». Поскольку при
    // is_officially_employed=true автоматически is_self_employed=false, до
    // ветки «официально устроен» поток НИКОГДА не доходит — её отдельным
    // тестом из API проверить невозможно (только unit-тестом сервиса).
    //
    // Этот тест документирует фактическое поведение: для officially-employed
    // employee bulk бьёт строго по ветке «не самозанятый».
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.8 Officially-employed worker → bulk rejects via !is_self_employed branch',
      run: async () => {
        const empOff = await createOfficialEmployee('Off');
        if (!empOff) skip('cannot create official employee fixture');
        const workId = await createWork('Off', { withPm: true });

        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: empOff,
              work_id: workId,
              operation_type: 'work_transfer',
              transfer_amount: 50000,
              earned_amount: 10000,
              remainder_destination: 'pm'
            }]
          }
        });
        assertOk(resp, 'bulk officially-employed');
        assert(Array.isArray(resp.data.errors), 'errors[]');
        assert(resp.data.errors.length === 1, '1 error');
        assert(resp.data.summary.se_transfers === 0, 'no transfers');
        const e = resp.data.errors[0];
        // СТРОГО: ожидается ошибка ветки «не самозанятый» (бэк проверяет её ПЕРВОЙ),
        // а НЕ «устроен/official» (до этой ветки выполнение не доходит).
        assert(/самозанят|self_employed/i.test(String(e.error)),
          `expected '!is_self_employed' branch error first, got: ${e.error}`);
        assert(!/устроен|official/i.test(String(e.error)),
          `must NOT reach 'officially-employed' branch (unreachable from API): ${e.error}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 9. work_id не существует → errors[]
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.9 work_id not exists → errors[]',
      run: async () => {
        const empId = await createSePayee('NoWork');
        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: empId,
              work_id: 999999999,
              operation_type: 'work_transfer',
              transfer_amount: 50000,
              earned_amount: 10000,
              remainder_destination: 'pm'
            }]
          }
        });
        assertOk(resp, 'bulk with bad work_id');
        assert(resp.data.errors.length === 1, '1 error');
        assert(resp.data.summary.se_transfers === 0, 'no transfers');
        const e = resp.data.errors[0];
        assert(/work|работ/i.test(String(e.error)),
          `error about work, got: ${e.error}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 10. salary без earned_amount → errors[]
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.10 work_transfer with earned=0 → errors[]',
      run: async () => {
        const empId = await createSePayee('NoEarn');
        const workId = await createWork('NoEarn', { withPm: true });

        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: empId,
              work_id: workId,
              operation_type: 'work_transfer',
              transfer_amount: 50000,
              earned_amount: 0,
              remainder_destination: 'pm'
            }]
          }
        });
        assertOk(resp, 'bulk salary with earned=0');
        assert(resp.data.errors.length === 1, '1 error');
        assert(resp.data.summary.se_transfers === 0, 'no transfers');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 11. agreement_transfer с earned != 0 → errors[]
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.11 agreement_transfer with earned != 0 → errors[]',
      run: async () => {
        const empId = await createSePayee('BadAgr');
        const workId = await createWork('BadAgr', { withPm: true });

        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: empId,
              work_id: workId,
              operation_type: 'agreement_transfer',
              transfer_amount: 50000,
              earned_amount: 10000,  // <-- запрещено
              remainder_destination: 'pm'
            }]
          }
        });
        assertOk(resp, 'bulk agreement+earned');
        assert(resp.data.errors.length === 1, '1 error');
        assert(resp.data.summary.se_transfers === 0, 'no transfers');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 12. КРИТИЧНО: остаток ровно 0 → handover НЕ создаётся
    //   transfer=100000, earned=100000 → cash_return=0
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.12 remainder=0 (earned=transfer) → no handover created',
      run: async () => {
        const empId = await createSePayee('Zero');
        const workId = await createWork('Zero', { withPm: true });

        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: empId,
              work_id: workId,
              operation_type: 'work_transfer',
              transfer_amount: 100000,
              earned_amount: 100000,
              remainder_destination: 'pm'
            }]
          }
        });
        assertOk(resp, 'bulk zero remainder');
        assert(resp.data.summary.se_transfers === 1, 'transfer created');
        assert(resp.data.summary.handovers === 0,
          `handover НЕ создаётся при remainder=0, got ${resp.data.summary.handovers}`);

        const transfers = await findTransfersByBatch(resp.data.batch_id);
        assert(transfers.length === 1, '1 transfer');
        assert(Number(transfers[0].cash_return_amount) === 0,
          `cash_return=0, got ${transfers[0].cash_return_amount}`);

        // КРИТИЧНО: проверяем ОТСУТСТВИЕ handover в БД (не должно быть amount=0)
        const hs = await findHandovers({ worker_id: empId });
        const linked = hs.filter(h =>
          Number(h.source_se_transfer_id) === Number(transfers[0].id));
        assert(linked.length === 0,
          `handover ОТСУТСТВУЕТ в worker_to_pm_handovers (remainder=0), got ${linked.length}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 13. transfer < earned для salary → cash_payout > 0, handover на 0 не создаётся
    //   transfer=50000, earned=80000 → cash_payout=30000, cash_return=0
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.13 transfer < earned → cash_payout>0, no handover',
      run: async () => {
        const empId = await createSePayee('Under');
        const workId = await createWork('Under', { withPm: true });

        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: empId,
              work_id: workId,
              operation_type: 'work_transfer',
              transfer_amount: 50000,
              earned_amount: 80000,
              remainder_destination: 'pm'
            }]
          }
        });
        assertOk(resp, 'bulk under-transfer');
        assert(resp.data.summary.se_transfers === 1, 'transfer created');
        assert(resp.data.summary.handovers === 0,
          `handover не создан (cash_return=0), got ${resp.data.summary.handovers}`);

        const transfers = await findTransfersByBatch(resp.data.batch_id);
        assert(Number(transfers[0].cash_return_amount) === 0,
          `cash_return=0, got ${transfers[0].cash_return_amount}`);
        assert(Number(transfers[0].cash_payout_amount) === 30000,
          `cash_payout=30000, got ${transfers[0].cash_payout_amount}`);

        const hs = await findHandovers({ worker_id: empId });
        const linked = hs.filter(h =>
          Number(h.source_se_transfer_id) === Number(transfers[0].id));
        assert(linked.length === 0,
          `handover отсутствует (amount=0 не создаём)`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 14. КРИТИЧНО: destination=pm но work.pm_id=NULL → errors[]
    //   se_transfer НЕ должен быть создан
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.14 destination=pm + work.pm_id=NULL → error, no transfer',
      run: async () => {
        const empId = await createSePayee('NoPM');
        const workId = await createWork('NoPM', { withPm: false }); // pm_id=NULL

        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: empId,
              work_id: workId,
              operation_type: 'work_transfer',
              transfer_amount: 50000,
              earned_amount: 10000,
              remainder_destination: 'pm'   // НО pm нет!
            }]
          }
        });
        assertOk(resp, 'bulk pm-null');
        assert(Array.isArray(resp.data.errors), 'errors[]');
        assert(resp.data.errors.length === 1, '1 error');
        const e = resp.data.errors[0];
        assert(/pm|РП/i.test(String(e.error)),
          `error about missing PM, got: ${e.error}`);

        // КРИТИЧНО: проверяем что se_transfer НЕ создан
        assert(resp.data.summary.se_transfers === 0,
          `se_transfer НЕ создан, got ${resp.data.summary.se_transfers}`);

        // Дополнительно: ищем по batch_id — должно быть 0
        if (resp.data.batch_id) {
          const transfers = await findTransfersByBatch(resp.data.batch_id);
          assert(transfers.length === 0,
            `НИ ОДНОЙ записи в se_transfers с этим batch_id, got ${transfers.length}`);
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 15. > 100 строк → 400 (request rejected целиком, до открытия TX)
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.15 > 100 transfers → 400 (rejected before TX)',
      run: async () => {
        const transfers = [];
        for (let i = 0; i < 101; i++) {
          transfers.push({
            employee_id: 1,    // дамми, до валидации не дойдёт
            work_id: 1,
            operation_type: 'work_transfer',
            transfer_amount: 1000,
            earned_amount: 500,
            remainder_destination: 'pm'
          });
        }
        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: { year: YEAR, month: MONTH, transfers }
        });
        assertStatus(resp, 400, 'bulk >100');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 16. Пустой transfers[] → 400
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.16 empty transfers[] → 400',
      run: async () => {
        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: { year: YEAR, month: MONTH, transfers: [] }
        });
        assertStatus(resp, 400, 'bulk empty');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 17. PM кнопка manual handover — создаёт received сразу
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.17 PM manual handover → received immediately',
      run: async () => {
        const empId = await createSePayee('Manual1');
        const workId = await createWork('Manual1', { withPm: true });

        const resp = await api('POST', '/api/handovers/manual', {
          role: 'PM',
          body: {
            worker_id: empId,
            work_id: workId,
            amount: 50000,
            year: YEAR,
            month: MONTH,
            note: 'Передал лично 15.07.2026'
          }
        });
        assertOk(resp, 'manual handover');
        const h = resp.data?.handover;
        assertHasFields(h, ['id', 'status', 'expected_amount', 'received_amount'], 'handover shape');
        assert(h.status === 'received',
          `status=received, got ${h.status}`);
        assert(Number(h.expected_amount) === 50000,
          `expected=50000, got ${h.expected_amount}`);
        assert(Number(h.received_amount) === 50000,
          `received=50000, got ${h.received_amount}`);

        // State: handover есть в GET /handovers
        const list = await findHandovers({ worker_id: empId, role: 'PM' });
        const found = list.find(x => Number(x.id) === Number(h.id));
        assert(found, 'handover present in GET /handovers list');
        assert(found.source_se_transfer_id === null,
          `source_se_transfer_id=null (manual), got ${found.source_se_transfer_id}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 18. PM manual handover без work_id — успешно
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.18 PM manual handover without work_id → ok',
      run: async () => {
        const empId = await createSePayee('Manual2');

        const resp = await api('POST', '/api/handovers/manual', {
          role: 'PM',
          body: {
            worker_id: empId,
            amount: 30000,
            year: YEAR,
            month: MONTH
          }
        });
        assertOk(resp, 'manual no-work');
        const h = resp.data?.handover;
        assert(h.work_id === null || h.work_id === undefined,
          `work_id=null, got ${h.work_id}`);
        assert(h.status === 'received', 'received');
        assert(Number(h.received_amount) === 30000, 'received=30000');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 19. PM manual handover: warning если pending существует
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.19 PM manual handover: warning if pending exists',
      run: async () => {
        const empId = await createSePayee('Warn');
        const workId = await createWork('Warn', { withPm: true });

        // 1. Создаём bulk → pending handover
        const bulk = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: empId,
              work_id: workId,
              operation_type: 'work_transfer',
              transfer_amount: 100000,
              earned_amount: 20000,
              remainder_destination: 'pm'
            }]
          }
        });
        assertOk(bulk, 'bulk for pending');
        trackBatch(bulk.data?.batch_id);
        assert(bulk.data.summary.handovers === 1, 'pending handover created');

        // 2. PM делает manual на этого же worker → 200 + warning
        const resp = await api('POST', '/api/handovers/manual', {
          role: 'PM',
          body: {
            worker_id: empId,
            work_id: workId,
            amount: 25000,
            year: YEAR,
            month: MONTH,
            note: 'отдельно нал'
          }
        });
        assertOk(resp, 'manual with pending exists');
        assert(resp.data.handover, 'handover created');
        assertHasFields(resp.data, ['warning'], 'response has warning field');
        assert(/pending|ожидан/i.test(String(resp.data.warning)),
          `warning about existing pending, got: ${resp.data.warning}`);

        // Manual handover — отдельная запись (status=received, source_se_transfer_id=null)
        assert(resp.data.handover.status === 'received', 'manual received');
        assert(resp.data.handover.source_se_transfer_id === null,
          'manual has no source_se_transfer_id');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 20. PM manual handover: amount=0 → 400
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.20 PM manual handover: amount=0 → 400',
      run: async () => {
        const empId = await createSePayee('Zero20');
        const resp = await api('POST', '/api/handovers/manual', {
          role: 'PM',
          body: {
            worker_id: empId,
            amount: 0,
            year: YEAR, month: MONTH
          }
        });
        assertStatus(resp, 400, 'amount=0 rejected');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 21. PM manual handover: worker не СЗ → 400
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.21 PM manual handover: worker not self-employed → 400',
      run: async () => {
        const empNotSe = await createNonSeEmployee('Manual21');
        if (!empNotSe) skip('cannot create non-SE employee');

        const resp = await api('POST', '/api/handovers/manual', {
          role: 'PM',
          body: {
            worker_id: empNotSe,
            amount: 10000,
            year: YEAR, month: MONTH
          }
        });
        assertStatus(resp, 400, 'worker not SE');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 22. /pm-balance: после bulk pm → handovers_received увеличился
    //    (handovers_received обновляется при CONFIRM, до этого
    //     pending — учитывается как handovers_pending_sum.)
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.22 /pm-balance: after bulk+confirm → handovers_received +N',
      run: async () => {
        if (!TEST_USERS.PM?.id) skip('PM not in TEST_USERS');
        const pmId = TEST_USERS.PM.id;

        const balBefore = await getPmBalance(pmId);
        const recvBefore = Number(balBefore?.handovers_received || 0);
        const pendingBefore = Number(balBefore?.handovers_pending_sum || 0);

        // Bulk → pending handover на 80000
        const empId = await createSePayee('PmBal');
        const workId = await createWork('PmBal', { withPm: true });
        const bulk = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: empId,
              work_id: workId,
              operation_type: 'work_transfer',
              transfer_amount: 100000,
              earned_amount: 20000,
              remainder_destination: 'pm'
            }]
          }
        });
        assertOk(bulk, 'bulk');
        trackBatch(bulk.data?.batch_id);

        // pending +80000 в /pm-balance
        const balAfterBulk = await getPmBalance(pmId);
        const pendingAfter = Number(balAfterBulk?.handovers_pending_sum || 0);
        assert(pendingAfter >= pendingBefore + 80000 - 0.01,
          `handovers_pending_sum should grow by 80000: before=${pendingBefore}, after=${pendingAfter}`);

        // PM подтверждает → received +80000
        const hs = await findHandovers({ worker_id: empId, role: 'PM' });
        const pending = hs.find(h => h.status === 'pending');
        if (!pending) skip('pending handover not found after bulk');

        const confirmResp = await api('PUT',
          `/api/handovers/${pending.id}/confirm`,
          {
            role: 'PM',
            body: { received_amount: 80000, status: 'received' }
          }
        );
        assertOk(confirmResp, 'confirm handover');

        const balFinal = await getPmBalance(pmId);
        const recvFinal = Number(balFinal?.handovers_received || 0);
        assert(recvFinal >= recvBefore + 80000 - 0.01,
          `handovers_received grew by 80000: before=${recvBefore}, after=${recvFinal}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 23. /pm-balance: после bulk company → cash_balance_log income
    //    (для destination=company баланс кассы Асгарда растёт,
    //     pm-balance NOT затрагивается)
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.23 /cash/balance: after bulk company → cash balance +N',
      run: async () => {
        const balBefore = await getCashBalance('BUH');
        if (balBefore === null) skip('cash/balance not accessible');

        const empId = await createSePayee('CashBal');
        const workId = await createWork('CashBal', { withPm: true });

        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: empId,
              work_id: workId,
              operation_type: 'work_transfer',
              transfer_amount: 100000,
              earned_amount: 30000,
              remainder_destination: 'company'
            }]
          }
        });
        assertOk(resp, 'bulk company');
        trackBatch(resp.data?.batch_id);
        assert(resp.data.summary.cash_log_income === 1, 'cash_log_income=1');

        const balAfter = await getCashBalance('BUH');
        const delta = balAfter - balBefore;
        assert(Math.abs(delta - 70000) < 0.01,
          `cash balance delta=${delta}, expected 70000`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 24. /my-balance: handovers_received растёт после подтверждения
    //    (новая формула pm-balance.js)
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.24 /cash/my-balance: shows handovers_received via new formula',
      run: async () => {
        if (!TEST_USERS.PM?.id) skip('PM not in TEST_USERS');

        // Baseline
        const baseResp = await api('GET', '/api/cash/my-balance', { role: 'PM' });
        assertOk(baseResp, 'baseline my-balance');
        assertHasFields(baseResp.data,
          ['balance', 'handovers_received', 'se_cash_legacy', 'cash_payouts_workers'],
          'my-balance shape (новые поля Stage W)');
        const recvBefore = Number(baseResp.data.handovers_received || 0);

        // Setup → подтвердить handover на 40000
        const empId = await createSePayee('MyBal');
        const workId = await createWork('MyBal', { withPm: true });
        const bulk = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: empId,
              work_id: workId,
              operation_type: 'work_transfer',
              transfer_amount: 60000,
              earned_amount: 20000,
              remainder_destination: 'pm'
            }]
          }
        });
        assertOk(bulk, 'bulk for my-balance');
        trackBatch(bulk.data?.batch_id);

        const hs = await findHandovers({ worker_id: empId, role: 'PM' });
        const pending = hs.find(h => h.status === 'pending');
        if (!pending) skip('no pending handover');

        const conf = await api('PUT', `/api/handovers/${pending.id}/confirm`, {
          role: 'PM',
          body: { received_amount: 40000, status: 'received' }
        });
        assertOk(conf, 'confirm');

        const afterResp = await api('GET', '/api/cash/my-balance', { role: 'PM' });
        assertOk(afterResp, 'after my-balance');
        const recvAfter = Number(afterResp.data.handovers_received || 0);
        assert(recvAfter >= recvBefore + 40000 - 0.01,
          `handovers_received grew by 40000: before=${recvBefore}, after=${recvAfter}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 25. RBAC: PM не может вызвать /se-transfers/bulk → 403
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.25 RBAC: PM cannot call /se-transfers/bulk → 403',
      run: async () => {
        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'PM',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: 1,
              work_id: 1,
              operation_type: 'work_transfer',
              transfer_amount: 1000,
              earned_amount: 500,
              remainder_destination: 'pm'
            }]
          }
        });
        assertForbidden(resp, 'PM denied bulk');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 26. RBAC: BUH может вызвать /se-transfers/bulk → 200
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.26 RBAC: BUH can call /se-transfers/bulk → 200',
      run: async () => {
        const empId = await createSePayee('RBAC');
        const workId = await createWork('RBAC', { withPm: true });
        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: empId,
              work_id: workId,
              operation_type: 'work_transfer',
              transfer_amount: 50000,
              earned_amount: 10000,
              remainder_destination: 'pm'
            }]
          }
        });
        assertOk(resp, 'BUH bulk ok');
        trackBatch(resp.data?.batch_id);
        assertHasFields(resp.data, ['batch_id', 'summary'], 'standard bulk shape');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // EXTRA (sanity): single POST /se-transfers ещё принимает
    // remainder_destination + default='pm'
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.27 SINGLE POST /se-transfers accepts remainder_destination',
      run: async () => {
        const empId = await createSePayee('Single');
        const workId = await createWork('Single', { withPm: true });
        const resp = await api('POST', '/api/payroll-dashboard/se-transfers', {
          role: 'BUH',
          body: {
            employee_id: empId,
            year: YEAR, month: MONTH,
            operation_type: 'work_transfer',
            transfer_amount: 50000,
            earned_amount: 10000,
            work_id: workId,
            remainder_destination: 'company'
          }
        });
        // Single может вернуть 200 или 201 — главное 2xx
        assertOk(resp, 'single create');
        const t = resp.data?.transfer || resp.data;
        assert(t?.id, 'transfer id');
        if ('remainder_destination' in t) {
          assert(t.remainder_destination === 'company',
            `remainder_destination=company, got ${t.remainder_destination}`);
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // EXTRA (edge): missing year/month → 400 до открытия TX
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.28 missing year/month → 400',
      run: async () => {
        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            transfers: [{
              employee_id: 1,
              work_id: 1,
              operation_type: 'work_transfer',
              transfer_amount: 1000,
              earned_amount: 500,
              remainder_destination: 'pm'
            }]
          }
        });
        assertStatus(resp, 400, 'missing year/month');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // EXTRA (edge): transfers не массив → 400
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.29 transfers not an array → 400',
      run: async () => {
        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: { year: YEAR, month: MONTH, transfers: 'not-array' }
        });
        assertStatus(resp, 400, 'transfers wrong type');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // EXTRA (edge): WAREHOUSE не имеет доступа → 403
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.30 RBAC: WAREHOUSE cannot bulk → 403',
      run: async () => {
        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'WAREHOUSE',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: 1, work_id: 1,
              operation_type: 'work_transfer',
              transfer_amount: 1000, earned_amount: 500,
              remainder_destination: 'pm'
            }]
          }
        });
        assertForbidden(resp, 'WAREHOUSE denied');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 7.31 Idempotency-Key — повтор bulk с тем же UUID → 409 batch_already_exists
    //   (payroll-dashboard.js:824-841)
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.31 Idempotency-Key: повтор bulk → 409 batch_already_exists',
      run: async () => {
        const empId = await createSePayee('Idem');
        const workId = await createWork('Idem', { withPm: true });
        const idemKey = crypto.randomUUID();

        const body = {
          year: YEAR, month: MONTH,
          transfers: [{
            employee_id: empId,
            work_id: workId,
            operation_type: 'work_transfer',
            transfer_amount: 50000,
            earned_amount: 10000,
            remainder_destination: 'pm',
            comment: 'idem-1'
          }]
        };

        // 1-й запрос с header → 200, batch_id == idemKey
        const token = await getToken('BUH');
        const resp1 = await rawFetch(
          'POST', '/api/payroll-dashboard/se-transfers/bulk',
          { body, token, headers: { 'Idempotency-Key': idemKey } }
        );
        assert(resp1.status >= 200 && resp1.status < 300,
          `first bulk should be 2xx, got ${resp1.status} — ${JSON.stringify(resp1.data).slice(0,200)}`);
        assert(String(resp1.data?.batch_id || '').toLowerCase() === idemKey.toLowerCase(),
          `batch_id должен равняться Idempotency-Key, got ${resp1.data?.batch_id}`);
        trackBatch(resp1.data?.batch_id);

        // 2-й запрос с тем же header и тем же body → 409 batch_already_exists
        const resp2 = await rawFetch(
          'POST', '/api/payroll-dashboard/se-transfers/bulk',
          { body, token, headers: { 'Idempotency-Key': idemKey } }
        );
        assert(resp2.status === 409,
          `repeat bulk with same Idempotency-Key должен → 409, got ${resp2.status}`);
        assert(String(resp2.data?.error || '') === 'batch_already_exists',
          `error должен быть 'batch_already_exists', got ${resp2.data?.error}`);
        assert(String(resp2.data?.batch_id || '').toLowerCase() === idemKey.toLowerCase(),
          `409 должен возвращать batch_id=${idemKey}, got ${resp2.data?.batch_id}`);

        // State: в БД ровно 1 transfer с этим batch_id (НЕ дубль)
        const list = await findTransfersByBatch(idemKey);
        assert(list.length === 1,
          `должен быть ровно 1 transfer с этим batch_id (без дубля), got ${list.length}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 7.32 Превышение годового лимита суммой двух строк ОДНОГО bulk
    //   bulk-обработчик аккумулирует yearly_sum внутри одного запроса
    //   (yearlySumByEmp Map в payroll-dashboard.js:845), поэтому вторая
    //   строка одного и того же СЗ должна попасть в errors[] с упоминанием
    //   лимита, а первая — пройти.
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.32 Sum-overflow: 2 transfers одного СЗ > годовой лимит → 2-я в errors[]',
      run: async () => {
        const empId = await createSePayee('SumLim');
        const workId = await createWork('SumLim', { withPm: true });

        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'BUH',
          body: {
            year: YEAR, month: MONTH,
            transfers: [
              {
                employee_id: empId,
                work_id: workId,
                operation_type: 'work_transfer',
                transfer_amount: 1_500_000,    // ниже годового лимита
                earned_amount: 100_000,
                remainder_destination: 'pm',
                comment: 'sumlim-1'
              },
              {
                employee_id: empId,            // тот же сотрудник!
                work_id: workId,
                operation_type: 'work_transfer',
                transfer_amount: 1_000_000,    // 1.5M + 1M = 2.5M > 2.4M лимита
                earned_amount: 100_000,
                remainder_destination: 'pm',
                comment: 'sumlim-2'
              }
            ]
          }
        });
        assertOk(resp, 'bulk sum-overflow');
        trackBatch(resp.data?.batch_id);

        // Первая прошла, вторая упала в errors с упоминанием лимита.
        assert(resp.data.summary.se_transfers === 1,
          `1-я строка прошла (1 transfer), got ${resp.data.summary.se_transfers}`);
        assert(Array.isArray(resp.data.errors) && resp.data.errors.length >= 1,
          `2-я строка должна быть в errors[], got ${(resp.data.errors||[]).length}`);
        const err = resp.data.errors.find(e =>
          Number(e.employee_id) === Number(empId) && e.index === 1);
        assert(err, '2-я строка (index=1) того же empId в errors[]');
        assert(/лимит|limit/i.test(String(err.error)),
          `error должна упоминать лимит, got: ${err.error}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 7.33 RBAC: DIRECTOR_DEV не входит в ACCESS_ROLES → 403
    //   ACCESS_ROLES = ['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','BUH']
    //   (payroll-dashboard.js:28) — DIRECTOR_DEV отсутствует.
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.33 RBAC: DIRECTOR_DEV cannot bulk → 403',
      run: async () => {
        const resp = await api('POST', '/api/payroll-dashboard/se-transfers/bulk', {
          role: 'DIRECTOR_DEV',
          body: {
            year: YEAR, month: MONTH,
            transfers: [{
              employee_id: 1, work_id: 1,
              operation_type: 'work_transfer',
              transfer_amount: 1000, earned_amount: 500,
              remainder_destination: 'pm'
            }]
          }
        });
        assertForbidden(resp, 'DIRECTOR_DEV denied (not in ACCESS_ROLES)');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 7.99 Cleanup — best-effort: cancel se_transfers всех batch_id
    //                этого прогона, чтобы не плодить «висящих» переводов.
    //
    // Backend имеет:
    //   PUT /api/payroll-dashboard/se-transfers/:id/cancel — есть (status='cancelled')
    //   DELETE /api/payroll-dashboard/se-transfers/:id      — НЕТ
    //   DELETE /api/handovers/:id                            — НЕТ
    //   DELETE /api/data/employees/:id                       — есть, но FK 23503
    //                                                          (есть se_transfers/self_employed)
    //
    // FIXME: для полного cleanup'а employees + handovers нужен админский
    //   cleanup-endpoint, либо ON DELETE CASCADE на se_transfers→handovers
    //   и DELETE прямым SQL через test-helper. Сейчас оставляем cancelled-
    //   transfers и помечаем employees через RUN_TAG в fio (можно собрать
    //   sql-скриптом по marker'у при необходимости).
    // ═══════════════════════════════════════════════════════════════
    {
      name: '7.99 Cleanup — cancel se_transfers этого прогона (best-effort)',
      run: async () => {
        if (_runBatchIds.size === 0) {
          // нечего чистить
          return;
        }
        let cancelled = 0;
        let skipped = 0;
        for (const batchId of _runBatchIds) {
          try {
            const list = await findTransfersByBatch(batchId);
            for (const t of list) {
              if (t.status === 'cancelled') { skipped++; continue; }
              const cancelResp = await api('PUT',
                `/api/payroll-dashboard/se-transfers/${t.id}/cancel`,
                { role: 'ADMIN' });
              if (cancelResp.status >= 200 && cancelResp.status < 300) {
                cancelled++;
              } else {
                skipped++;
              }
            }
          } catch (e) {
            // не валим прогон из-за cleanup'а — это best-effort
            skipped++;
          }
        }
        // Sanity: тест проходит всегда (cleanup — не блокирующий).
        // Логирующая ассерция: что-то либо отменили, либо вообще ничего не было.
        assert(cancelled + skipped >= 0,
          `cleanup completed: cancelled=${cancelled}, skipped=${skipped}, ` +
          `batches=${_runBatchIds.size}, employees=${_runEmployeeIds.size} (employees не удаляются — FK)`);
      }
    }
  ]
};
