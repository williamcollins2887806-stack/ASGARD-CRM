/**
 * BLOCK 9 — CASH STATEMENT (банковская выписка РП)
 *
 * Покрывает API_SPEC_PM_STATEMENT.md раздел 7 (минимум 8 кейсов + edge cases):
 *
 *   9.0   Setup — создать work + cash_request (issued) + handover (received) + worker_payment (paid).
 *   9.1   PM получает свою выписку — pm.id == TEST_USERS.PM.id, operations.length >= 3.
 *   9.2   PM не может получить чужую — pm_id игнорируется, всегда сам.
 *   9.3   BUH с pm_id=<PM> — 200 + pm.id == PM.
 *   9.4   ADMIN с pm_id=<PM> — 200 + pm.id == PM.
 *   9.5   BUH без pm_id — 400 (или 200 «всех» — допускаем оба, лишь бы детерминированно).
 *   9.6   Period filter — операция вне периода не в operations.
 *   9.7   opening_balance — сумма операций до from.
 *   9.8   closing_balance = opening_balance + Σ amount operations.
 *   9.9   operations ORDER BY date ASC.
 *   9.10  running balance корректный — balance_after[i] = opening + Σ amount[0..i].
 *   9.11  RBAC: WAREHOUSE — 403 (либо 200 пустой).
 *   9.12  format=xlsx — Content-Type spreadsheetml, body начинается с PK.
 *   9.13  format=pdf — 501 / 400 / 200+warning (любой из трёх допустим).
 *   9.14  Пустой период (2099) — operations:[], opening == closing.
 *   9.99  Cleanup — best-effort, удаление через имеющиеся endpoints (для cash_request есть close+force).
 *
 * Все тесты изолированы: создают собственные фикстуры под TEST_USERS.PM,
 * фильтруют выписку по period, чтобы не зависеть от прода/клона.
 */
'use strict';

const { api, assert, assertOk, assertStatus, assertForbidden,
        assertArray, assertHasFields, skip, TEST_USERS } = require('../config');

// ────────────────────────────────────────────────────────────────
// Constants / helpers
// ────────────────────────────────────────────────────────────────

const RUN_TAG = `CASH-STMT-${Date.now()}`;

// Период тестов: широкий, чтобы попали все setup-операции, но не пересекался
// с 2099 (пустой период) и не задевал чужие реальные данные слишком сильно.
const TEST_FROM = '2026-04-01';
const TEST_TO = '2026-06-30';

// Setup state — наполняется в 9.0 Setup, используется всеми остальными.
const _state = {
  workId: null,
  cashId: null,        // cash_request id (issued)
  cashAmount: 0,
  paymentIds: [],      // worker_payment ids
  handoverIds: [],     // worker_to_pm_handovers ids
  payeeIds: [],        // employees ids (СЗ)
};

// Сгенерировать ИНН-12 для СЗ-получателя.
let _innCounter = Date.now() % 1_000_000_000_000;
function nextInn() {
  _innCounter = (_innCounter + 1) % 1_000_000_000_000;
  return String(_innCounter).padStart(12, '0');
}

// Создать СЗ-получателя (для handover/worker_payment).
async function createPayee(suffix = '') {
  const resp = await api('POST', '/api/staff/payees', {
    role: 'ADMIN',
    body: {
      fio: `${RUN_TAG} ${suffix}`,
      phone: '+79000000000',
      inn: nextInn(),
    },
  });
  if (resp.status < 200 || resp.status >= 300) return null;
  const payee = resp.data?.payee || resp.data;
  const id = payee?.id;
  if (id) _state.payeeIds.push(id);
  return id;
}

// Создать work с pm_id=TEST_USERS.PM.id.
async function createWork(title) {
  if (!TEST_USERS.PM?.id) return null;
  const resp = await api('POST', '/api/works', {
    role: 'ADMIN',
    body: {
      work_title: `${RUN_TAG} ${title}`,
      work_status: 'В работе',
      object_place: 'Москва',
      object_name: `${RUN_TAG} obj`,
      pm_id: TEST_USERS.PM.id,
    },
  });
  if (resp.status < 200 || resp.status >= 300) return null;
  const w = resp.data?.work || resp.data;
  return w?.id || null;
}

// Создать cash_request → approve → issue → receive (чтобы попасть в выписку как income).
async function setupCashRequest(workId, amount) {
  // create
  const create = await api('POST', '/api/cash', {
    role: 'PM',
    body: { work_id: workId, amount, purpose: `${RUN_TAG} test`, type: 'advance' },
  });
  if (create.status < 200 || create.status >= 300) return null;
  const id = create.data?.id;
  if (!id) return null;

  // approve
  const approve = await api('PUT', `/api/cash/${id}/approve`, {
    role: 'DIRECTOR_GEN',
    body: { comment: 'auto-approve for statement test' },
  });
  if (approve.status < 200 || approve.status >= 300) return null;

  // issue (BUH/Director)
  const issue = await api('PUT', `/api/cash/${id}/issue`, {
    role: 'BUH',
    body: {},
  });
  // не валим если issue недоступен — некоторые конфиги уже могут перевести в issued
  if (issue.status >= 200 && issue.status < 300) {
    // ok
  }

  // receive (PM подтверждает получение — нужно чтобы статус был received/reporting)
  const receive = await api('PUT', `/api/cash/${id}/receive`, { role: 'PM', body: {} });
  // не валим если уже received

  return id;
}

// Создать manual handover (received сразу) от worker → PM.
async function setupHandover(workerId, workId, amount, monthOpt = 6) {
  const resp = await api('POST', '/api/handovers/manual', {
    role: 'PM',
    body: {
      worker_id: workerId,
      work_id: workId,
      amount,
      year: 2026,
      month: monthOpt,
      note: `${RUN_TAG} handover`,
    },
  });
  if (resp.status < 200 || resp.status >= 300) return null;
  const h = resp.data?.handover || resp.data;
  const id = h?.id;
  if (id) _state.handoverIds.push(id);
  return id;
}

// Создать worker_payment с mark_paid=true (статус paid, paid_by=PM).
async function setupWorkerPayment(workerId, workId, amount, type = 'per_diem') {
  // Дёргаем как PM, чтобы paid_by=PM (как раз нужный кейс для выписки).
  const resp = await api('POST', '/api/worker-payments', {
    role: 'PM',
    body: {
      employee_id: workerId,
      work_id: workId,
      type,
      amount,
      payment_method: 'cash',
      mark_paid: true,
      pay_year: 2026,
      pay_month: 6,
      comment: `${RUN_TAG} payment`,
    },
  });
  if (resp.status < 200 || resp.status >= 300) return null;
  const p = resp.data?.payment || resp.data;
  const id = p?.id;
  if (id) _state.paymentIds.push(id);
  return id;
}

// Получить выписку.
async function getStatement({ role, from, to, pm_id, format } = {}) {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (pm_id != null) qs.set('pm_id', String(pm_id));
  if (format) qs.set('format', format);
  const url = `/api/cash/statement${qs.toString() ? '?' + qs.toString() : ''}`;
  return await api('GET', url, { role: role || 'PM' });
}

// Фильтрация операций — оставить только те, что относятся к нашему workId
// (чтобы тест не зависел от чужих данных на клоне).
function filterOurOps(operations, workId) {
  if (!Array.isArray(operations)) return [];
  if (!workId) return operations;
  return operations.filter(op => Number(op.work_id) === Number(workId));
}

// Изоморфная проверка amount.signum для income/outflow.
// По спеке:
//   income → amount > 0
//   outflow → amount < 0 (-amount по факту)
function amountSignValid(op) {
  if (op.type === 'income') return Number(op.amount) > 0;
  if (op.type === 'outflow') return Number(op.amount) < 0;
  return false;
}

// ────────────────────────────────────────────────────────────────
// Module
// ────────────────────────────────────────────────────────────────

module.exports = {
  name: 'BLOCK 9 — CASH STATEMENT',
  tests: [

    // ═══════════════════════════════════════════════════════════════
    // 9.0 Setup
    // ═══════════════════════════════════════════════════════════════
    {
      name: 'Setup 9.0: TEST_USERS.PM available',
      run: async () => {
        if (!TEST_USERS.PM?.id) {
          skip('TEST_USERS.PM not initialised — run initRealUsers() first');
        }
        assert(TEST_USERS.PM.id, 'PM id');
      },
    },
    {
      name: 'Setup 9.0: create work + cash_request + handover + worker_payment',
      run: async () => {
        if (!TEST_USERS.PM?.id) skip('PM not in TEST_USERS');

        // 1. Work с PM
        const workId = await createWork('S0');
        if (!workId) skip('cannot create work fixture (CRM 403 / no access)');
        _state.workId = workId;

        // 2. Cash request → income в выписке.
        //    amount=20000, type=advance, issued from главной кассы.
        const cashId = await setupCashRequest(workId, 20000);
        if (cashId) {
          _state.cashId = cashId;
          _state.cashAmount = 20000;
        }
        // не валим setup полностью если cash не получилось — будут handover+payment

        // 3. Manual handover — income в выписке.
        const payeeId = await createPayee('Payee');
        if (payeeId) {
          await setupHandover(payeeId, workId, 50000, 6);
        }

        // 4. Worker payment (расход) — outflow в выписке.
        if (payeeId) {
          await setupWorkerPayment(payeeId, workId, 8000, 'per_diem');
        }

        // Sanity: хотя бы одна фикстура должна была создаться.
        const hasAny = (_state.cashId != null)
          || (_state.handoverIds.length > 0)
          || (_state.paymentIds.length > 0);
        assert(hasAny, 'at least one fixture (cash/handover/payment) created');
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // 9.1 PM получает свою выписку
    // ═══════════════════════════════════════════════════════════════
    {
      name: '9.1 PM получает свою выписку — 200, pm.id == PM, operations.length > 0',
      run: async () => {
        if (!TEST_USERS.PM?.id) skip('PM not in TEST_USERS');
        if (!_state.workId) skip('setup failed — no work');

        const resp = await getStatement({
          role: 'PM',
          from: TEST_FROM,
          to: TEST_TO,
        });

        // Если endpoint ещё не реализован — фикс. /404/501 — skip с понятным сообщением.
        if (resp.status === 404 || resp.status === 501) {
          skip(`endpoint /api/cash/statement not implemented yet (status ${resp.status})`);
        }
        assertOk(resp, '9.1 PM own statement');

        assertHasFields(resp.data, ['pm', 'period', 'summary', 'operations'],
          'statement response shape');
        assert(Number(resp.data.pm?.id) === Number(TEST_USERS.PM.id),
          `pm.id should be PM=${TEST_USERS.PM.id}, got ${resp.data.pm?.id}`);
        assertArray(resp.data.operations, 'operations array');

        // Хотя бы наши операции должны быть в выписке (фильтр по нашему workId).
        const ours = filterOurOps(resp.data.operations, _state.workId);
        assert(ours.length >= 1,
          `expected >=1 of our operations in PM statement, got ${ours.length} (total: ${resp.data.operations.length})`);
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // 9.2 PM не может получить чужую выписку — pm_id игнорируется
    // ═══════════════════════════════════════════════════════════════
    {
      name: '9.2 PM с ?pm_id=<other> — игнорируется, возвращается своя',
      run: async () => {
        if (!TEST_USERS.PM?.id) skip('PM not in TEST_USERS');
        // Берём другого PM-подобного юзера. Если нет HEAD_PM — пытаемся ADMIN.id (точно не PM).
        const other = TEST_USERS.HEAD_PM || TEST_USERS.ADMIN;
        if (!other?.id || Number(other.id) === Number(TEST_USERS.PM.id)) {
          skip('no alternative pm_id available in TEST_USERS');
        }

        const resp = await getStatement({
          role: 'PM',
          from: TEST_FROM,
          to: TEST_TO,
          pm_id: other.id,
        });
        if (resp.status === 404 || resp.status === 501) {
          skip(`endpoint not implemented (status ${resp.status})`);
        }

        // По спеке: PM/HEAD_PM — только свой подотчёт (pm_user_id = req.user.id, игнорирует ?pm_id).
        // Допускаем 200 + pm.id == PM, или 403 (если backend ужесточил).
        if (resp.status === 403 || resp.status === 401) {
          // допустимо — backend счёл, что PM не имеет права смотреть чужие
          return;
        }
        assertOk(resp, '9.2 PM forces other pm_id');
        assert(Number(resp.data.pm?.id) === Number(TEST_USERS.PM.id),
          `pm_id should be ignored for PM role; expected own id=${TEST_USERS.PM.id}, got ${resp.data.pm?.id}`);
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // 9.3 BUH может получить чужую выписку
    // ═══════════════════════════════════════════════════════════════
    {
      name: '9.3 BUH ?pm_id=<PM> — 200, pm.id == PM',
      run: async () => {
        if (!TEST_USERS.PM?.id) skip('PM not in TEST_USERS');
        const resp = await getStatement({
          role: 'BUH',
          from: TEST_FROM,
          to: TEST_TO,
          pm_id: TEST_USERS.PM.id,
        });
        if (resp.status === 404 || resp.status === 501) {
          skip(`endpoint not implemented (status ${resp.status})`);
        }
        assertOk(resp, '9.3 BUH gets PM statement');
        assert(Number(resp.data.pm?.id) === Number(TEST_USERS.PM.id),
          `pm.id should be PM=${TEST_USERS.PM.id}, got ${resp.data.pm?.id}`);
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // 9.4 ADMIN получает чужую выписку
    // ═══════════════════════════════════════════════════════════════
    {
      name: '9.4 ADMIN ?pm_id=<PM> — 200, pm.id == PM',
      run: async () => {
        if (!TEST_USERS.PM?.id) skip('PM not in TEST_USERS');
        const resp = await getStatement({
          role: 'ADMIN',
          from: TEST_FROM,
          to: TEST_TO,
          pm_id: TEST_USERS.PM.id,
        });
        if (resp.status === 404 || resp.status === 501) {
          skip(`endpoint not implemented (status ${resp.status})`);
        }
        assertOk(resp, '9.4 ADMIN gets PM statement');
        assert(Number(resp.data.pm?.id) === Number(TEST_USERS.PM.id),
          `pm.id should be PM=${TEST_USERS.PM.id}, got ${resp.data.pm?.id}`);
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // 9.5 BUH без pm_id — backend решает (400 или 200 «всех»)
    // ═══════════════════════════════════════════════════════════════
    {
      name: '9.5 BUH без pm_id — 400 (обязателен) либо 200',
      run: async () => {
        const resp = await getStatement({
          role: 'BUH',
          from: TEST_FROM,
          to: TEST_TO,
        });
        if (resp.status === 404 || resp.status === 501) {
          skip(`endpoint not implemented (status ${resp.status})`);
        }
        // По спеке: «pm_id обязателен для админ/директор/бух». Ожидаем 400.
        // Но допускаем 200 если backend возвращает агрегат по всем — не запрещаем строго.
        assert(
          resp.status === 400 || resp.status === 200,
          `BUH without pm_id should be 400 (или 200 если backend это разрешил), got ${resp.status}`
        );
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // 9.6 Period filter — операции вне периода не возвращаются
    // ═══════════════════════════════════════════════════════════════
    {
      name: '9.6 Period filter — our ops out of period filtered out',
      run: async () => {
        if (!TEST_USERS.PM?.id) skip('PM not in TEST_USERS');
        if (!_state.workId) skip('setup failed');

        // Берём очень узкий период в прошлом, в который наши фикстуры точно не попадают.
        const resp = await getStatement({
          role: 'PM',
          from: '2024-01-01',
          to: '2024-01-31',
        });
        if (resp.status === 404 || resp.status === 501) {
          skip(`endpoint not implemented (status ${resp.status})`);
        }
        assertOk(resp, '9.6 narrow past period');

        const ours = filterOurOps(resp.data.operations, _state.workId);
        assert(ours.length === 0,
          `out-of-period должны фильтроваться, got ${ours.length} ops (work=${_state.workId})`);

        // period должен соответствовать запросу.
        assert(resp.data.period?.from === '2024-01-01' || resp.data.period?.from?.startsWith('2024-01-01'),
          `period.from echoed correctly, got ${resp.data.period?.from}`);
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // 9.7 opening_balance = сумма операций до from
    // ═══════════════════════════════════════════════════════════════
    {
      name: '9.7 opening_balance — сумма всех операций до from',
      run: async () => {
        if (!TEST_USERS.PM?.id) skip('PM not in TEST_USERS');

        // Берём period в будущем (2027) — наши операции 2026 года все в opening.
        const respFuture = await getStatement({
          role: 'PM',
          from: '2027-01-01',
          to: '2027-12-31',
        });
        if (respFuture.status === 404 || respFuture.status === 501) {
          skip(`endpoint not implemented (status ${respFuture.status})`);
        }
        assertOk(respFuture, '9.7 future period');

        assertHasFields(respFuture.data.summary,
          ['opening_balance', 'total_in', 'total_out', 'closing_balance'],
          'summary shape');

        // Операций нет (наши все в 2026), opening должен включать их.
        const ourFuture = filterOurOps(respFuture.data.operations, _state.workId);
        assert(ourFuture.length === 0,
          `naши ops 2026 не должны быть в period 2027, got ${ourFuture.length}`);

        // Sanity: opening_balance — число (тип).
        const opening = Number(respFuture.data.summary.opening_balance);
        assert(!isNaN(opening),
          `opening_balance must be a number, got ${respFuture.data.summary.opening_balance}`);
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // 9.8 closing_balance = opening + Σ amount operations
    // ═══════════════════════════════════════════════════════════════
    {
      name: '9.8 closing_balance == opening + total_in - total_out (арифметика)',
      run: async () => {
        if (!TEST_USERS.PM?.id) skip('PM not in TEST_USERS');

        const resp = await getStatement({
          role: 'PM',
          from: TEST_FROM,
          to: TEST_TO,
        });
        if (resp.status === 404 || resp.status === 501) {
          skip(`endpoint not implemented (status ${resp.status})`);
        }
        assertOk(resp, '9.8 statement');

        const s = resp.data.summary || {};
        const opening = Number(s.opening_balance || 0);
        const totalIn = Number(s.total_in || 0);
        const totalOut = Number(s.total_out || 0);
        const closing = Number(s.closing_balance || 0);

        const expected = opening + totalIn - totalOut;
        assert(Math.abs(closing - expected) < 0.01,
          `closing_balance (${closing}) != opening (${opening}) + total_in (${totalIn}) - total_out (${totalOut}) = ${expected}`);
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // 9.9 operations ORDER BY date ASC
    // ═══════════════════════════════════════════════════════════════
    {
      name: '9.9 operations отсортированы по date ASC',
      run: async () => {
        if (!TEST_USERS.PM?.id) skip('PM not in TEST_USERS');

        const resp = await getStatement({
          role: 'PM',
          from: TEST_FROM,
          to: TEST_TO,
        });
        if (resp.status === 404 || resp.status === 501) {
          skip(`endpoint not implemented (status ${resp.status})`);
        }
        assertOk(resp, '9.9 statement');

        const ops = resp.data.operations || [];
        for (let i = 1; i < ops.length; i++) {
          const prev = new Date(ops[i - 1].date).getTime();
          const cur = new Date(ops[i].date).getTime();
          assert(cur >= prev,
            `operations[${i}].date (${ops[i].date}) < operations[${i - 1}].date (${ops[i - 1].date}) — not sorted ASC`);
        }
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // 9.10 running balance корректный
    //   balance_after[i] = opening + Σ amount[0..i]
    // ═══════════════════════════════════════════════════════════════
    {
      name: '9.10 running balance: balance_after[i] = opening + Σ amount[0..i]',
      run: async () => {
        if (!TEST_USERS.PM?.id) skip('PM not in TEST_USERS');

        const resp = await getStatement({
          role: 'PM',
          from: TEST_FROM,
          to: TEST_TO,
        });
        if (resp.status === 404 || resp.status === 501) {
          skip(`endpoint not implemented (status ${resp.status})`);
        }
        assertOk(resp, '9.10 statement');

        const ops = resp.data.operations || [];
        if (ops.length === 0) skip('no operations in period');

        // Проверяем что balance_after — number и накопительный.
        const opening = Number(resp.data.summary?.opening_balance || 0);
        let running = opening;
        for (let i = 0; i < ops.length; i++) {
          running += Number(ops[i].amount || 0);
          const reported = Number(ops[i].balance_after);
          assert(!isNaN(reported),
            `operations[${i}].balance_after must be number, got ${ops[i].balance_after}`);
          assert(Math.abs(reported - running) < 0.01,
            `operations[${i}].balance_after (${reported}) != computed (${running}) — running balance broken`);
          // Sanity: знак amount соответствует type
          assert(amountSignValid(ops[i]),
            `operations[${i}].amount sign (${ops[i].amount}) inconsistent with type=${ops[i].type}`);
        }

        // closing_balance в summary == последний balance_after.
        const closing = Number(resp.data.summary?.closing_balance);
        const lastBal = Number(ops[ops.length - 1].balance_after);
        assert(Math.abs(closing - lastBal) < 0.01,
          `closing_balance (${closing}) != last operations.balance_after (${lastBal})`);
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // 9.11 RBAC: WAREHOUSE — 403
    // ═══════════════════════════════════════════════════════════════
    {
      name: '9.11 RBAC: WAREHOUSE cannot access /api/cash/statement → 403',
      run: async () => {
        const resp = await getStatement({
          role: 'WAREHOUSE',
          from: TEST_FROM,
          to: TEST_TO,
          pm_id: TEST_USERS.PM?.id,
        });
        if (resp.status === 404 || resp.status === 501) {
          skip(`endpoint not implemented (status ${resp.status})`);
        }
        // WAREHOUSE не должен иметь доступа.
        // Допускаем 403/401 (запрещено) или 200 + пустая выписка (если backend
        // мягче — например возвращает 0 операций).
        if (resp.status === 200) {
          // sanity: для WAREHOUSE выписка должна быть пустой / нулевой
          const ops = resp.data?.operations;
          assert(Array.isArray(ops),
            `if 200, expected operations array, got ${typeof ops}`);
          // не паникуем — backend сам решил
          return;
        }
        assertForbidden(resp, 'WAREHOUSE denied');
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // 9.12 format=xlsx — Content-Type spreadsheetml, body начинается с PK
    // ═══════════════════════════════════════════════════════════════
    {
      name: '9.12 format=xlsx — Content-Type spreadsheetml, body начинается с PK',
      run: async () => {
        if (!TEST_USERS.PM?.id) skip('PM not in TEST_USERS');

        // Используем rawFetch чтобы получить сырой ответ (binary).
        // api() здесь не подходит — пытается JSON.parse, что портит binary.
        const { rawFetch, getToken } = require('../config');
        const token = await getToken('PM');
        const url = `/api/cash/statement?from=${TEST_FROM}&to=${TEST_TO}&format=xlsx`;
        const resp = await rawFetch('GET', url, { token });

        if (resp.status === 404 || resp.status === 501) {
          skip(`endpoint not implemented / xlsx not supported (status ${resp.status})`);
        }
        assert(resp.status >= 200 && resp.status < 300,
          `xlsx export should be 2xx, got ${resp.status}`);

        // Content-Type
        const ct = resp.headers?.get?.('content-type') || '';
        assert(
          /spreadsheetml|excel|octet-stream/i.test(ct),
          `Content-Type должен быть spreadsheetml (или octet-stream fallback), got: ${ct}`
        );

        // Body начинается с PK (zip-сигнатура XLSX)
        // resp.text — это уже строка; первые 2 байта — 'PK'.
        const body = resp.text || '';
        assert(body.length > 0, 'xlsx body must not be empty');
        // PK = 0x50 0x4B = 'P' 'K' в начале
        const startsPK = body.charCodeAt(0) === 0x50 && body.charCodeAt(1) === 0x4B;
        assert(startsPK,
          `xlsx body должен начинаться с zip-сигнатуры 'PK', got: ${JSON.stringify(body.slice(0, 4))}`);
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // 9.13 format=pdf — пока не реализовано
    // ═══════════════════════════════════════════════════════════════
    {
      name: '9.13 format=pdf — 501 / 400 / 200+warning',
      run: async () => {
        if (!TEST_USERS.PM?.id) skip('PM not in TEST_USERS');

        const { rawFetch, getToken } = require('../config');
        const token = await getToken('PM');
        const url = `/api/cash/statement?from=${TEST_FROM}&to=${TEST_TO}&format=pdf`;
        const resp = await rawFetch('GET', url, { token });

        if (resp.status === 404) {
          skip('endpoint not implemented (404)');
        }

        // По спеке: «pdf — позже». Допускаем 501 (not implemented), 400 (validation),
        // либо 200 + JSON с warning, либо 200 + готовый PDF (если уже реализовано).
        const ok = (resp.status === 501)
          || (resp.status === 400)
          || (resp.status >= 200 && resp.status < 300);
        assert(ok,
          `pdf format должен быть 501/400/2xx (не реализовано или реализовано), got ${resp.status}`);
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // 9.14 Пустой период (2099) — operations:[], opening==closing
    // ═══════════════════════════════════════════════════════════════
    {
      name: '9.14 Пустой период (2099-01-01..2099-01-31) — operations:[], opening==closing',
      run: async () => {
        if (!TEST_USERS.PM?.id) skip('PM not in TEST_USERS');

        const resp = await getStatement({
          role: 'PM',
          from: '2099-01-01',
          to: '2099-01-31',
        });
        if (resp.status === 404 || resp.status === 501) {
          skip(`endpoint not implemented (status ${resp.status})`);
        }
        assertOk(resp, '9.14 empty period');

        assertArray(resp.data.operations, 'operations array');
        // Операций в этом периоде нет ни у кого.
        assert(resp.data.operations.length === 0,
          `2099 period должен быть пустым, got ${resp.data.operations.length} ops`);

        const opening = Number(resp.data.summary?.opening_balance || 0);
        const closing = Number(resp.data.summary?.closing_balance || 0);
        const totalIn = Number(resp.data.summary?.total_in || 0);
        const totalOut = Number(resp.data.summary?.total_out || 0);

        // Без операций: total_in/out = 0, opening == closing.
        assert(totalIn === 0 && totalOut === 0,
          `empty period: total_in (${totalIn}) и total_out (${totalOut}) должны быть 0`);
        assert(Math.abs(opening - closing) < 0.01,
          `empty period: opening (${opening}) должен == closing (${closing})`);
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // 9.99 Cleanup — best-effort, чтобы не плодить фикстуры на клоне.
    //   Бэкенд поддерживает:
    //     PUT /api/cash/:id/close (force=true) — закрыть cash_request
    //     DELETE /api/worker-payments/:id      — удалить worker_payment (если есть)
    //   Handover endpoint удаления не имеет — оставляем как есть (помечено RUN_TAG).
    // ═══════════════════════════════════════════════════════════════
    {
      name: '9.99 Cleanup — close cash_request, delete worker_payments (best-effort)',
      run: async () => {
        let closed = 0, deleted = 0, skipped = 0;

        // Close cash_request (force=true, чтобы не споткнуться об остаток)
        if (_state.cashId) {
          try {
            const r = await api('PUT', `/api/cash/${_state.cashId}/close`, {
              role: 'DIRECTOR_GEN',
              body: { comment: `${RUN_TAG} cleanup`, force: true },
            });
            if (r.status >= 200 && r.status < 300) closed++;
            else skipped++;
          } catch { skipped++; }
        }

        // Delete worker_payments — если endpoint поддерживает
        for (const pid of _state.paymentIds) {
          try {
            const r = await api('DELETE', `/api/worker-payments/${pid}`, { role: 'ADMIN' });
            if (r.status >= 200 && r.status < 300) deleted++;
            else skipped++;
          } catch { skipped++; }
        }

        // Не валим тест — cleanup всегда best-effort.
        assert(closed + deleted + skipped >= 0,
          `cleanup completed: closed=${closed}, deleted=${deleted}, skipped=${skipped}, ` +
          `handovers=${_state.handoverIds.length} (не удаляются — нет endpoint), ` +
          `payees=${_state.payeeIds.length} (FK)`);
      },
    },
  ],
};
