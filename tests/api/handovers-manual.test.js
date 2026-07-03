/**
 * BLOCK 8 — MANUAL HANDOVER (PM-кнопка «Получил нал от СЗ»)
 *
 * Покрывает API_SPEC_BULK_SE.md раздел 8, сценарии 17-21:
 *   17 — manual handover создаёт received сразу
 *   18 — без work_id — успешно
 *   19 — warning если pending существует
 *   20 — amount=0 → 400
 *   21 — worker не СЗ → 400
 *
 * Плюс RBAC/edge cases для POST /api/handovers/manual.
 *
 * Каждый тест изолирован: создаёт собственного СЗ-получателя (payee)
 * и работу с pm_id=test_pm. Проверка state БД через GET /api/handovers
 * и (для warning) через GET /api/payroll-dashboard/se-transfers.
 */
'use strict';

const { api, assert, assertOk, assertStatus, assertForbidden,
        assertArray, assertHasFields, skip, TEST_USERS } = require('../config');

const YEAR = 2026;
const MONTH = 7;
const RUN_TAG = `MANUAL-${Date.now()}`;

let _innCounter = (Date.now() + 1) % 1_000_000_000_000;
function nextInn() {
  _innCounter = (_innCounter + 1) % 1_000_000_000_000;
  return String(_innCounter).padStart(12, '0');
}

async function createSePayee(suffix) {
  const resp = await api('POST', '/api/staff/payees', {
    role: 'ADMIN',
    body: {
      fio: `${RUN_TAG} СЗ ${suffix}`,
      phone: '+79000000010',
      inn: nextInn()
    }
  });
  assertOk(resp, `create payee ${suffix}`);
  const id = (resp.data?.payee || resp.data)?.id;
  assert(id, `payee id (${suffix})`);
  return id;
}

async function createNonSeEmployee(suffix) {
  // POST /api/staff/employees: создаёт работника без is_self_employed=true
  let resp = await api('POST', '/api/staff/employees', {
    role: 'ADMIN',
    body: {
      fio: `${RUN_TAG} NotSE ${suffix}`,
      phone: '+79000000011',
      is_self_employed: false,
      is_officially_employed: false
    }
  });
  if (resp.status < 200 || resp.status >= 300) {
    resp = await api('POST', '/api/data/employees', {
      role: 'ADMIN',
      body: {
        fio: `${RUN_TAG} NotSE ${suffix}`,
        phone: '+79000000011',
        is_self_employed: false,
        is_officially_employed: false
      }
    });
    if (resp.status < 200 || resp.status >= 300) return null;
  }
  const emp = resp.data?.employee || resp.data;
  return emp?.id;
}

async function createWork(suffix, { withPm = true } = {}) {
  const body = {
    work_title: `${RUN_TAG} ${suffix}`,
    work_status: 'В работе',
    object_place: 'Москва',
    object_name: `${RUN_TAG} object`
  };
  if (withPm && TEST_USERS.PM?.id) body.pm_id = TEST_USERS.PM.id;
  if (!withPm) body.pm_id = null;
  const resp = await api('POST', '/api/works', { role: 'ADMIN', body });
  assertOk(resp, `create work ${suffix}`);
  const w = resp.data?.work || resp.data;
  return w?.id;
}

async function findHandovers({ worker_id, role = 'PM' }) {
  const resp = await api('GET',
    `/api/handovers?year=${YEAR}&month=${MONTH}&worker_id=${worker_id}`,
    { role }
  );
  assertOk(resp, `list handovers worker=${worker_id}`);
  return resp.data?.handovers || [];
}

module.exports = {
  name: 'BLOCK 8 — MANUAL HANDOVER (PM «Получил от СЗ»)',
  tests: [

    // ═══════════════════════════════════════════════════════════════
    // SETUP
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'Setup 8.0: TEST_USERS.PM available',
      run: async () => {
        if (!TEST_USERS.PM?.id) skip('TEST_USERS.PM not initialised — run initRealUsers() first');
        assert(TEST_USERS.PM.id, 'PM id');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 17 — manual handover создаёт received сразу
    // ═══════════════════════════════════════════════════════════════
    {
      name: '8.17 PM manual handover → received immediately',
      run: async () => {
        const empId = await createSePayee('M17');
        const workId = await createWork('M17', { withPm: true });

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
        assertHasFields(h,
          ['id', 'status', 'expected_amount', 'received_amount',
           'worker_id', 'pm_user_id', 'year', 'month'],
          'handover row shape');

        // status = received СРАЗУ (не pending)
        assert(h.status === 'received', `status=received, got ${h.status}`);
        assert(Number(h.expected_amount) === 50000,
          `expected=50000, got ${h.expected_amount}`);
        assert(Number(h.received_amount) === 50000,
          `received=50000, got ${h.received_amount}`);
        // source_se_transfer_id=NULL (это ручной handover, не из bulk)
        assert(h.source_se_transfer_id === null,
          `source_se_transfer_id=null (manual), got ${h.source_se_transfer_id}`);
        // pm_user_id = test_pm.id (auto-fill из req.user)
        assert(Number(h.pm_user_id) === Number(TEST_USERS.PM.id),
          `pm_user_id=test_pm.id (${TEST_USERS.PM.id}), got ${h.pm_user_id}`);
        // received_at установлен
        assert(h.received_at, 'received_at is set (NOW())');

        // State: запись в GET /api/handovers
        const list = await findHandovers({ worker_id: empId, role: 'PM' });
        const found = list.find(x => Number(x.id) === Number(h.id));
        assert(found, 'handover в GET /handovers (видна PM)');
        assert(found.status === 'received', 'state status=received');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 18 — без work_id — успешно
    // ═══════════════════════════════════════════════════════════════
    {
      name: '8.18 PM manual without work_id → ok',
      run: async () => {
        const empId = await createSePayee('M18');

        const resp = await api('POST', '/api/handovers/manual', {
          role: 'PM',
          body: {
            worker_id: empId,
            amount: 30000,
            year: YEAR,
            month: MONTH,
            note: 'без работы'
          }
        });
        assertOk(resp, 'manual no-work');
        const h = resp.data?.handover;
        assert(h.work_id === null || h.work_id === undefined,
          `work_id null, got ${h.work_id}`);
        assert(h.status === 'received', 'received');
        assert(Number(h.received_amount) === 30000, 'received=30000');
        // pm_user_id = текущий PM, поскольку не из works
        assert(Number(h.pm_user_id) === Number(TEST_USERS.PM.id),
          `pm_user_id=test_pm.id (${TEST_USERS.PM.id}), got ${h.pm_user_id}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 19 — warning если pending существует
    //   Setup: bulk → pending handover на этого worker (cash_return=80000)
    //   Действие: POST /handovers/manual
    //   Ожидание: 200 + handover + warning, обе записи отдельные.
    //
    //   MEDIUM-fix: warning ДОЛЖЕН содержать реальный ID pending'а
    //   (handovers.js:376 пишет `ID=${p.id} ... ${expected_amount} ₽`),
    //   а не просто слово «pending». Сначала находим реальный ID после
    //   bulk, потом проверяем что warning содержит и ID и сумму.
    // ═══════════════════════════════════════════════════════════════
    {
      name: '8.19 manual handover with pending existing → 200 + warning (ID+amount)',
      run: async () => {
        const empId = await createSePayee('M19');
        const workId = await createWork('M19', { withPm: true });

        // 1. Создаём pending handover через bulk (cash_return = 100000-20000 = 80000)
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
        assertOk(bulk, 'bulk setup');
        assert(bulk.data.summary.handovers === 1, 'pending handover from bulk');

        // 1a. Находим реальный ID этого pending handover (нужен для проверки warning)
        const listBefore = await findHandovers({ worker_id: empId, role: 'PM' });
        const pendingFromBulk = listBefore.find(h =>
          h.status === 'pending' && Number(h.expected_amount) === 80000);
        assert(pendingFromBulk,
          `должен быть pending handover на 80000 после bulk, got: ${JSON.stringify(listBefore.map(h => ({id:h.id, status:h.status, exp:h.expected_amount})))}`);
        const pendingId = Number(pendingFromBulk.id);
        const pendingAmount = Number(pendingFromBulk.expected_amount);

        // 2. PM делает manual для того же worker
        const resp = await api('POST', '/api/handovers/manual', {
          role: 'PM',
          body: {
            worker_id: empId,
            work_id: workId,
            amount: 25000,
            year: YEAR, month: MONTH,
            note: 'отдельно нал'
          }
        });
        assertOk(resp, 'manual with pending');
        assert(resp.data.handover, 'handover created');
        assertHasFields(resp.data, ['warning'], 'response has warning');

        const warning = String(resp.data.warning || '');
        // warning должен содержать слово pending/ожидан (общий маркер)
        assert(/pending|ожидан/i.test(warning),
          `warning должен упоминать pending, got: ${warning}`);
        // warning ДОЛЖЕН содержать РЕАЛЬНЫЙ ID того pending'а (бэкенд пишет 'ID=<id>')
        assert(warning.includes(`ID=${pendingId}`),
          `warning должен содержать 'ID=${pendingId}' (реальный id pending'а), got: ${warning}`);
        // warning ДОЛЖЕН содержать сумму pending'а (бэкенд пишет 'на <amount> ₽')
        assert(warning.includes(String(pendingAmount)),
          `warning должен содержать сумму ${pendingAmount} pending'а, got: ${warning}`);

        // Manual — отдельная запись (status=received, source_se_transfer_id=null)
        const manualH = resp.data.handover;
        assert(manualH.status === 'received', 'manual=received');
        assert(manualH.source_se_transfer_id === null,
          'manual has no source_se_transfer_id');
        assert(Number(manualH.id) !== pendingId,
          `manual.id (${manualH.id}) должен отличаться от pending.id (${pendingId}) — это отдельная запись`);

        // State: в БД ДВЕ записи — pending (от bulk) + received (manual)
        const list = await findHandovers({ worker_id: empId, role: 'PM' });
        const pending = list.filter(h => h.status === 'pending');
        const received = list.filter(h =>
          h.status === 'received' && h.source_se_transfer_id === null);
        assert(pending.length >= 1,
          `pending (от bulk) сохранён, got ${pending.length}`);
        assert(received.length >= 1,
          `manual (received) добавлен отдельно, got ${received.length}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 20 — amount=0 → 400
    // ═══════════════════════════════════════════════════════════════
    {
      name: '8.20 amount=0 → 400',
      run: async () => {
        const empId = await createSePayee('M20');
        const resp = await api('POST', '/api/handovers/manual', {
          role: 'PM',
          body: {
            worker_id: empId,
            amount: 0,
            year: YEAR, month: MONTH
          }
        });
        assertStatus(resp, 400, 'amount=0');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // 21 — worker не СЗ → 400
    // ═══════════════════════════════════════════════════════════════
    {
      name: '8.21 worker not self-employed → 400',
      run: async () => {
        const empNotSe = await createNonSeEmployee('M21');
        if (!empNotSe) skip('cannot create non-SE employee fixture');

        const resp = await api('POST', '/api/handovers/manual', {
          role: 'PM',
          body: {
            worker_id: empNotSe,
            amount: 10000,
            year: YEAR, month: MONTH
          }
        });
        assertStatus(resp, 400, 'not SE');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // EXTRA: amount отрицательный → 400
    // ═══════════════════════════════════════════════════════════════
    {
      name: '8.22 amount<0 → 400',
      run: async () => {
        const empId = await createSePayee('M22');
        const resp = await api('POST', '/api/handovers/manual', {
          role: 'PM',
          body: {
            worker_id: empId,
            amount: -1000,
            year: YEAR, month: MONTH
          }
        });
        assertStatus(resp, 400, 'amount<0');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // EXTRA: worker_id отсутствует → 400
    // ═══════════════════════════════════════════════════════════════
    {
      name: '8.23 worker_id missing → 400',
      run: async () => {
        const resp = await api('POST', '/api/handovers/manual', {
          role: 'PM',
          body: {
            amount: 10000,
            year: YEAR, month: MONTH
          }
        });
        assertStatus(resp, 400, 'no worker_id');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // EXTRA: worker_id не существует → 400/404
    // ═══════════════════════════════════════════════════════════════
    {
      name: '8.24 worker_id not exists → 400/404',
      run: async () => {
        const resp = await api('POST', '/api/handovers/manual', {
          role: 'PM',
          body: {
            worker_id: 999999999,
            amount: 10000,
            year: YEAR, month: MONTH
          }
        });
        assert(resp.status === 400 || resp.status === 404,
          `worker not found should be 400/404, got ${resp.status}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // EXTRA RBAC: BUH может создать manual handover
    //   pm_user_id из works.pm_id (spec: «pm_user_id из works.pm_id если BUH/DIR»)
    // ═══════════════════════════════════════════════════════════════
    {
      name: '8.25 BUH manual handover → pm_user_id из works.pm_id',
      run: async () => {
        const empId = await createSePayee('M25');
        const workId = await createWork('M25', { withPm: true }); // pm_id=test_pm

        const resp = await api('POST', '/api/handovers/manual', {
          role: 'BUH',
          body: {
            worker_id: empId,
            work_id: workId,
            amount: 15000,
            year: YEAR, month: MONTH,
            note: 'BUH-recorded'
          }
        });
        assertOk(resp, 'BUH manual');
        const h = resp.data?.handover;
        assert(h, 'handover');
        assert(h.status === 'received', 'received');
        // pm_user_id берётся из works.pm_id (это test_pm)
        assert(Number(h.pm_user_id) === Number(TEST_USERS.PM.id),
          `pm_user_id=works.pm_id (test_pm), got ${h.pm_user_id}`);
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // EXTRA RBAC: DIRECTOR_GEN может создать manual handover
    // ═══════════════════════════════════════════════════════════════
    {
      name: '8.26 DIRECTOR_GEN manual handover ok',
      run: async () => {
        const empId = await createSePayee('M26');
        const workId = await createWork('M26', { withPm: true });

        const resp = await api('POST', '/api/handovers/manual', {
          role: 'DIRECTOR_GEN',
          body: {
            worker_id: empId,
            work_id: workId,
            amount: 20000,
            year: YEAR, month: MONTH
          }
        });
        assertOk(resp, 'DIRECTOR_GEN manual');
        assert(resp.data?.handover?.status === 'received', 'received');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // EXTRA RBAC: WAREHOUSE не имеет доступа → 403
    // ═══════════════════════════════════════════════════════════════
    {
      name: '8.27 WAREHOUSE cannot manual handover → 403',
      run: async () => {
        const empId = await createSePayee('M27');
        const resp = await api('POST', '/api/handovers/manual', {
          role: 'WAREHOUSE',
          body: {
            worker_id: empId,
            amount: 1000,
            year: YEAR, month: MONTH
          }
        });
        assertForbidden(resp, 'WAREHOUSE denied');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // EXTRA RBAC: TO не имеет доступа → 403
    // ═══════════════════════════════════════════════════════════════
    {
      name: '8.28 TO cannot manual handover → 403',
      run: async () => {
        const empId = await createSePayee('M28');
        const resp = await api('POST', '/api/handovers/manual', {
          role: 'TO',
          body: {
            worker_id: empId,
            amount: 1000,
            year: YEAR, month: MONTH
          }
        });
        assertForbidden(resp, 'TO denied');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // EXTRA: month вне диапазона 1..12 → 400
    // ═══════════════════════════════════════════════════════════════
    {
      name: '8.29 month out of range (13) → 400',
      run: async () => {
        const empId = await createSePayee('M29');
        const resp = await api('POST', '/api/handovers/manual', {
          role: 'PM',
          body: {
            worker_id: empId,
            amount: 1000,
            year: YEAR, month: 13
          }
        });
        assertStatus(resp, 400, 'month=13');
      }
    },

    // ═══════════════════════════════════════════════════════════════
    // EXTRA: year/month missing → 400
    // ═══════════════════════════════════════════════════════════════
    {
      name: '8.30 year/month missing → 400',
      run: async () => {
        const empId = await createSePayee('M30');
        const resp = await api('POST', '/api/handovers/manual', {
          role: 'PM',
          body: {
            worker_id: empId,
            amount: 1000
            // year/month отсутствуют
          }
        });
        assertStatus(resp, 400, 'no year/month');
      }
    }
  ]
};
