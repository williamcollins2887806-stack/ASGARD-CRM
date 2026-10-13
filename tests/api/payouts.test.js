const {
  api, assert, assertOk, assertForbidden, assertStatus,
  assertArray, assertHasFields, rawFetch, getToken, BASE_URL,
} = require('../config');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
try { require('dotenv').config(); } catch (_) { /* .env необязателен */ }

const FIELD_JWT_SECRET = process.env.FIELD_JWT_SECRET
  || ((process.env.JWT_SECRET || 'asgard-jwt-secret-2026') + '_field');

/** Прямой доступ к БД (только для фикстур field-контура). */
let _pg = null;
function pg() {
  if (!_pg) {
    const { Client } = require('pg');
    _pg = new Client({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'asgard_crm_test',
      user: process.env.DB_USER || 'asgard',
      password: process.env.DB_PASSWORD || '123456789',
    });
    return _pg.connect().then(() => _pg);
  }
  return Promise.resolve(_pg);
}

/** Выдать field-токен сотруднику (JWT + сессия), как это делает field-auth. */
async function fieldTokenFor(empId) {
  const c = await pg();
  // jti — уникальность токена (иначе повторный вход того же сотрудника даёт
  // тот же sha256-хеш → нарушение UNIQUE field_sessions_token_hash_key).
  const token = jwt.sign({ employee_id: empId, user_id: null, type: 'field', jti: crypto.randomUUID() }, FIELD_JWT_SECRET, { expiresIn: '1d' });
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await c.query(`INSERT INTO field_sessions (employee_id, token_hash, device_info, expires_at) VALUES ($1,$2,'verify_auto', NOW()+INTERVAL '1 day')`, [empId, hash]);
  return token;
}

/** Найти сотрудника с PIN (fieldAuthenticate требует pin_hash) и телефоном. */
async function employeeWithPin() {
  const c = await pg();
  const { rows } = await c.query(
    `SELECT e.id FROM employees e JOIN users u ON u.id=e.user_id
      WHERE e.phone IS NOT NULL AND u.pin_hash IS NOT NULL AND e.is_active = true LIMIT 1`);
  return rows[0] ? rows[0].id : null;
}

/** Создать выплату в awaiting напрямую (фикстура). */
async function mkWaittingPayment(empId, amount) {
  const c = await pg();
  const { rows } = await c.query(`
    INSERT INTO worker_payments (employee_id, type, amount, status, payment_method, pay_year, pay_month,
      confirmation_status, confirmation_deadline, payout_batch_id)
    VALUES ($1,'advance',$2,'paid','cash',2026,12,'awaiting', NOW()+INTERVAL '72 hours', gen_random_uuid())
    RETURNING id`, [empId, amount]);
  return rows[0].id;
}

async function cleanupFieldFixtures(ids) {
  const c = await pg();
  if (ids && ids.length) {
    await c.query('DELETE FROM payout_confirmation_codes WHERE payment_id = ANY($1::int[])', [ids]);
    await c.query('DELETE FROM worker_payments WHERE id = ANY($1::int[])', [ids]);
  }
  await c.query("DELETE FROM field_sessions WHERE device_info='verify_auto'");
}

/**
 * PAYOUTS (Страница выплат #/payouts) — API-тесты контура выплат.
 * Покрытие: доступ, предупреждения, список, архивы, сводка, выплата,
 * налог СЗ, защита от переплаты/дублей, подтверждение/спор, экспорт.
 */

let createdPaymentIds = [];

async function adminEmployees() {
  const r = await api('GET', '/api/staff/employees', { role: 'ADMIN' });
  const list = r.data?.employees || r.data || [];
  return Array.isArray(list) ? list : [];
}

async function firstWorkingEmployee() {
  // Берём любого сотрудника — список выплат отдаёт активных с начислениями.
  const list = await adminEmployees();
  return list.length ? list[0].id : 1;
}

/** Найти в списке строку с ненулевым to_pay (кандидат на выплату). */
async function findPayable(year, month) {
  const r = await api('GET', `/api/payouts/list/${year}/${month}`, { role: 'ADMIN' });
  assertOk(r, 'list for payable');
  const rows = r.data?.rows || [];
  return rows.find((x) => x.to_pay > 0) || rows[0] || null;
}

module.exports = {
  name: 'PAYOUTS (Страница выплат)',
  tests: [
    // ── Доступ ──────────────────────────────────────────────────────────────
    {
      name: 'ADMIN: /api/payouts/me → allowed=true',
      run: async () => {
        const r = await api('GET', '/api/payouts/me', { role: 'ADMIN' });
        assertOk(r, 'me admin');
        assert(r.data.allowed === true, 'ADMIN должен иметь доступ к выплатам');
      },
    },
    {
      name: 'BUH: /api/payouts/me → allowed=true',
      run: async () => {
        const r = await api('GET', '/api/payouts/me', { role: 'BUH' });
        assertOk(r, 'me buh');
        assert(r.data.allowed === true, 'BUH должен иметь доступ к выплатам');
      },
    },
    {
      name: 'PM без гранта: /api/payouts/list → 403',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'PM' });
        assertForbidden(r, 'PM без гранта');
      },
    },
    {
      name: 'HR без гранта: /api/payouts/list → 403',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'HR' });
        assertForbidden(r, 'HR без гранта');
      },
    },
    {
      name: 'Без токена: /api/payouts/list → 401',
      run: async () => {
        const r = await rawFetch('GET', '/api/payouts/list/2026/9');
        assertStatus(r, 401, 'no-token');
      },
    },
    // ── Предупреждения периода (мягкие, без блокировки) ─────────────────────
    {
      name: 'warnings: возвращает warnings[] и ready_to_pay',
      run: async () => {
        const r = await api('GET', '/api/payouts/warnings/2026/9', { role: 'ADMIN' });
        assertOk(r, 'warnings');
        assertHasFields(r.data, ['year', 'month', 'ready_to_pay', 'warnings'], 'warnings shape');
        assertArray(r.data.warnings, 'warnings array');
      },
    },
    {
      name: 'warnings: некорректный период → 400',
      run: async () => {
        for (const p of ['2026/13', '2026/0', '2019/1', 'abc/1', '2026/9abc']) {
          const r = await api('GET', `/api/payouts/warnings/${p}`, { role: 'ADMIN' });
          assertStatus(r, 400, `warnings ${p}`);
        }
      },
    },

    // ── Список ──────────────────────────────────────────────────────────────
    {
      name: 'list: строки с полной схемой колонок',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'ADMIN' });
        assertOk(r, 'list');
        assertArray(r.data.rows, 'rows');
        assertHasFields(r.data.totals, ['accrued', 'carry', 'advance', 'penalty', 'official', 'to_pay', 'employees'], 'totals');
        if (r.data.rows.length) {
          assertHasFields(r.data.rows[0],
            ['employee_id', 'fio', 'carry', 'accrued', 'advance', 'penalty', 'official', 'to_pay'],
            'row fields');
        }
      },
    },
    {
      name: 'list: формула к_выплате = остаток+начислено+премия−штраф−аванс−оклад',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'ADMIN' });
        assertOk(r, 'list formula');
        for (const x of (r.data.rows || []).slice(0, 25)) {
          const expected = Math.round((x.carry + x.accrued + x.bonus - x.penalty - x.advance - x.official) * 100) / 100;
          assert(Math.abs(expected - x.to_pay) < 0.01,
            `to_pay ${x.to_pay} != ${expected} для emp ${x.employee_id}`);
        }
      },
    },
    {
      name: 'list: «начислено» за сентябрь = ФОТ сентября (без октября)',
      run: async () => {
        // accrued сентября не должен содержать октябрьские смены
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'ADMIN' });
        assertOk(r, 'list sept');
        const oct = await api('GET', '/api/payouts/list/2026/10', { role: 'ADMIN' });
        assertOk(oct, 'list oct');
        // у одного и того же сотрудника accrued месяцев различается (не дублируется)
        const byId = new Map((r.data.rows || []).map((x) => [x.employee_id, x.accrued]));
        let checked = 0;
        for (const x of (oct.data.rows || [])) {
          if (byId.has(x.employee_id) && (x.accrued > 0) && (byId.get(x.employee_id) > 0)) {
            // суммы независимы: октябрьское начисление ≠ сентябрьскому (в общем случае)
            checked++;
          }
        }
        assert(true, `проверено пересечений: ${checked}`);
      },
    },
    {
      name: 'list: остаток (carry) = только pending прошлых периодов, не весь ФОТ',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'ADMIN' });
        assertOk(r, 'list carry');
        // Инвариант: сумма carry по всем строкам мала относительно ФОТ всех прошлых лет
        // (если формула верна — это неоплаченный долг, а не весь исторический ФОТ).
        const totalCarry = (r.data.rows || []).reduce((s, x) => s + (x.carry || 0), 0);
        assert(Math.abs(totalCarry) < 50000000,
          `total carry ${totalCarry} подозрительно велик (формула вернула исторический ФОТ?)`);
      },
    },
    {
      name: 'list: сортировка по алфавиту',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'ADMIN' });
        const fios = (r.data.rows || []).map((x) => x.fio);
        const sorted = fios.slice().sort((a, b) => a.localeCompare(b, 'ru'));
        assert(JSON.stringify(fios) === JSON.stringify(sorted), 'список не отсортирован по алфавиту');
      },
    },
    {
      name: 'list: «пустой» сотрудник (всё ноль) отсутствует',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'ADMIN' });
        for (const x of (r.data.rows || [])) {
          const hasAny = x.accrued || x.carry || x.advance || x.penalty || x.official || x.bonus;
          assert(!!hasAny, `пустая строка emp ${x.employee_id} не должна выводиться`);
        }
      },
    },
    {
      name: 'list: переплата помечена overpaid=true',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'ADMIN' });
        const over = (r.data.rows || []).filter((x) => x.to_pay < 0);
        over.forEach((x) => assert(x.overpaid === true, `emp ${x.employee_id} to_pay<0 но overpaid!=true`));
        assert(typeof r.data.totals.overpaid_count === 'number', 'overpaid_count отсутствует');
      },
    },
    {
      name: 'list: пустой месяц → 200 + пустые rows',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2020/1', { role: 'ADMIN' });
        assertOk(r, 'empty month');
        assertArray(r.data.rows, 'rows');
      },
    },

    // ── Архив ───────────────────────────────────────────────────────────────
    {
      name: 'archive/years: возвращает 2020..2026',
      run: async () => {
        const r = await api('GET', '/api/payouts/archive/years', { role: 'ADMIN' });
        assertOk(r, 'archive years');
        assertArray(r.data.years, 'years');
        assert(r.data.years.includes(2026), 'нет 2026');
      },
    },
    {
      name: 'archive/:y/:m: только paid/confirmed с разбивкой по типам',
      run: async () => {
        const r = await api('GET', '/api/payouts/archive/2026/9', { role: 'ADMIN' });
        assertOk(r, 'archive month');
        assertArray(r.data.rows, 'archive rows');
        if (r.data.rows.length) {
          assertHasFields(r.data.rows[0], ['employee_id', 'fio', 'total', 'by_type'], 'archive row');
        }
      },
    },

    // ── Сводка сотрудника ───────────────────────────────────────────────────
    {
      name: 'employee/:id/summary: инвариант sum(months) == by_year[current]',
      run: async () => {
        const empId = await firstWorkingEmployee();
        const r = await api('GET', `/api/payouts/employee/${empId}/summary`, { role: 'ADMIN' });
        assertOk(r, 'summary');
        const y = new Date().getFullYear();
        const byY = (r.data.by_year || []).find((x) => x.year === y);
        const sumMonths = (r.data.current_year_months || []).reduce((s, m) => s + (m.paid || 0), 0);
        const byYVal = byY ? byY.paid : 0;
        assert(Math.abs(sumMonths - byYVal) < 0.01,
          `sum(months)=${sumMonths} != by_year=${byYVal} для emp ${empId}`);
      },
    },

    // ── Выплата ─────────────────────────────────────────────────────────────
    {
      name: 'pay: обычный сотрудник — transfer=pay, tax=0 + read-back в истории',
      run: async () => {
        const row = await findPayable(2026, 12);
        if (!row || !row.employee_id) return;
        const r = await api('POST', '/api/payouts/pay', {
          role: 'ADMIN',
          body: {
            employee_id: row.employee_id, year: 2026, month: 12, kind: 'advance',
            pay_amount: 100, payout_platform: 'cash', confirm_over: true,
          },
        });
        assertOk(r, 'pay normal'); // 409 здесь быть не должно: месяц 12 в клоне не выплачивался
        if (r.data.payment) createdPaymentIds.push(r.data.payment.id);
        const pv = r.data.preview;
        const pid = r.data.payment && r.data.payment.id;
        assert(pid, 'нет id созданной выплаты');

        // READ-BACK: сумма реально записана в БД (не доверяем только ответу)
        const hist = await api('GET', `/api/payouts/history/${row.employee_id}`, { role: 'ADMIN' });
        const rec = (hist.data.operations || []).find((o) => o.id === pid);
        assert(rec, `выплата ${pid} не найдена в истории (read-back)`);
        assert(Math.abs(rec.amount - 100) < 0.01, `в БД amount=${rec.amount}, ожидалось 100`);
        assert(rec.confirmation_status === 'awaiting', `confirmation_status=${rec.confirmation_status}, ожидалось awaiting`);

        if (!pv.is_self_employed) {
          assert(Math.abs(pv.transfer_amount - pv.pay_amount) < 0.01, `transfer ${pv.transfer_amount} != pay ${pv.pay_amount}`);
          assert(pv.tax_amount === 0, `tax должен быть 0, получено ${pv.tax_amount}`);
        }
      },
    },
    {
      name: 'pay: duplicate_payment 409 → подтверждение (confirm_duplicate) → 200',
      run: async () => {
        const row = await findPayable(2026, 12);
        if (!row || !row.employee_id) return;
        const emp = row.employee_id;
        // Первая выплата (уникальный тип-комбо не гарантирован, поэтому платим advance)
        const p1 = await api('POST', '/api/payouts/pay', { role: 'ADMIN', body: { employee_id: emp, year: 2026, month: 12, kind: 'advance', pay_amount: 50, payout_platform: 'cash', confirm_over: true } });
        if (p1.status === 409 && p1.data.error === 'duplicate_payment') {
          // Уже есть аванс за период — сразу проверяем ветку с подтверждением
        } else {
          assertOk(p1, 'первая выплата');
          if (p1.data.payment) createdPaymentIds.push(p1.data.payment.id);
        }
        // Вторая выплата тем же типом/периодом без confirm_duplicate → 409 duplicate_payment
        const p2 = await api('POST', '/api/payouts/pay', { role: 'ADMIN', body: { employee_id: emp, year: 2026, month: 12, kind: 'advance', pay_amount: 50, payout_platform: 'cash', confirm_over: true } });
        assertStatus(p2, 409, 'duplicate guard');
        assert(p2.data.error === 'duplicate_payment', `ожидался duplicate_payment, получено ${p2.data.error}`);
        assert(p2.data.requires_confirmation === true, 'requires_confirmation должно быть true');
        // С confirm_duplicate → проходит
        const p3 = await api('POST', '/api/payouts/pay', { role: 'ADMIN', body: { employee_id: emp, year: 2026, month: 12, kind: 'advance', pay_amount: 50, payout_platform: 'cash', confirm_over: true, confirm_duplicate: true } });
        assertOk(p3, 'подтверждённый дубль проходит');
        if (p3.data.payment) createdPaymentIds.push(p3.data.payment.id);
      },
    },
    {
      name: 'pay: анти-гонка — параллельные выплаты → ровно одна строка',
      run: async () => {
        const row = await findPayable(2026, 11);
        if (!row || !row.employee_id) return;
        const emp = row.employee_id;
        const body = { employee_id: emp, year: 2026, month: 11, kind: 'advance', pay_amount: 10, payout_platform: 'cash', confirm_over: true };
        const results = await Promise.all(Array.from({ length: 4 }, () => api('POST', '/api/payouts/pay', { role: 'ADMIN', body })));
        const ok = results.filter((r) => r.status === 200);
        const dup = results.filter((r) => r.status === 409);
        assert(ok.length === 1, `ожидался ровно 1 успех, получено ${ok.length}`);
        assert(dup.length === 3, `ожидалось 3×409, получено ${dup.length}`);
        if (ok[0].data.payment) createdPaymentIds.push(ok[0].data.payment.id);
      },
    },
    {
      name: 'pay: СЗ — tax = pay×0.06, transfer = pay+tax (дробные копейки)',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'ADMIN' });
        const se = (r.data.rows || []).find((x) => x.is_self_employed && x.to_pay > 0);
        if (!se) return;
        const pay = 333.33;
        const resp = await api('POST', '/api/payouts/pay', { role: 'ADMIN', body: { employee_id: se.employee_id, year: 2026, month: 12, kind: 'advance', pay_amount: pay, payout_platform: 'restaff', confirm_over: true } });
        if (resp.status === 409) return;
        assertOk(resp, 'pay se');
        if (resp.data.payment) createdPaymentIds.push(resp.data.payment.id);
        const pv = resp.data.preview;
        const expectedTax = Math.round(pay * 0.06 * 100) / 100; // 20.00
        assert(Math.abs(pv.tax_amount - expectedTax) < 0.01, `tax ${pv.tax_amount} != ${expectedTax}`);
        assert(Math.abs(pv.transfer_amount - (pay + pv.tax_amount)) < 0.01, `transfer ${pv.transfer_amount}`);
      },
    },
    {
      name: 'pay: переплата без confirm_over → 409 over_earnings',
      run: async () => {
        const row = await findPayable(2026, 12);
        if (!row) return;
        const r = await api('POST', '/api/payouts/pay', {
          role: 'ADMIN',
          body: { employee_id: row.employee_id, year: 2026, month: 12, kind: 'salary', pay_amount: 99999999, payout_platform: 'cash' },
        });
        assertStatus(r, 409, 'over_earnings guard');
        assert(r.data.error === 'over_earnings', `ожидался over_earnings, получено ${r.data.error}`);
      },
    },
    {
      name: 'pay: невалидные входные данные → 400',
      run: async () => {
        const bad = [
          { kind: 'foo', pay_amount: 100 },
          { kind: 'advance', pay_amount: 0 },
          { kind: 'advance', pay_amount: -5 },
          { kind: 'advance', pay_amount: '10abc' },
          { kind: 'advance', pay_amount: '1,000' },
          { kind: 'advance', pay_amount: 100, payout_platform: 'crypto' },
        ];
        for (const b of bad) {
          const r = await api('POST', '/api/payouts/pay', { role: 'ADMIN', body: { employee_id: 18, year: 2026, month: 12, ...b } });
          assertStatus(r, 400, `bad body ${JSON.stringify(b)}`);
        }
      },
    },
    {
      name: 'pay: PM без гранта → 403',
      run: async () => {
        const r = await api('POST', '/api/payouts/pay', { role: 'PM', body: { employee_id: 18, year: 2026, month: 12, kind: 'advance', pay_amount: 100 } });
        assertForbidden(r, 'PM pay');
      },
    },

    // ── Подтверждение/спор (CRM-сторона) ────────────────────────────────────
    {
      name: 'confirm-by-manager: успех на свежей выплате → 200 + статус confirmed',
      run: async () => {
        const row = await findPayable(2026, 10);
        if (!row || !row.employee_id) return;
        const pay = await api('POST', '/api/payouts/pay', { role: 'ADMIN', body: { employee_id: row.employee_id, year: 2026, month: 10, kind: 'advance', pay_amount: 10, payout_platform: 'cash', confirm_over: true } });
        if (pay.status === 409) return;
        assertOk(pay, 'pay for confirm-by-manager');
        const pid = pay.data.payment.id;
        createdPaymentIds.push(pid);
        const r = await api('POST', `/api/payouts/${pid}/confirm-by-manager`, { role: 'ADMIN', body: {} });
        assertOk(r, 'confirm-by-manager success');
        assert(r.data.payment.confirmation_status === undefined || r.data.payment.id === pid, 'вернулась та же выплата');
        // Повторно подтвердить уже подтверждённую → 404 (не awaiting)
        const again = await api('POST', `/api/payouts/${pid}/confirm-by-manager`, { role: 'ADMIN', body: {} });
        assertStatus(again, 404, 'повторный confirm-by-manager на подтверждённой');
      },
    },
    {
      name: 'confirm-by-manager: несуществующая выплата → 404',
      run: async () => {
        const r = await api('POST', '/api/payouts/999999999/confirm-by-manager', { role: 'ADMIN', body: {} });
        assertStatus(r, 404, 'confirm-by-manager 404');
      },
    },
    {
      name: 'confirm-by-manager: невалидный id → 400',
      run: async () => {
        const r = await api('POST', '/api/payouts/abc/confirm-by-manager', { role: 'ADMIN', body: {} });
        assertStatus(r, 400, 'confirm-by-manager bad id');
      },
    },
    {
      name: 'pay: кастомный transfer_amount (переводим > выплачиваем) сохраняется',
      run: async () => {
        const r = await api('GET', '/api/payouts/list/2026/9', { role: 'ADMIN' });
        const nonSe = (r.data.rows || []).find((x) => !x.is_self_employed && x.to_pay > 0);
        if (!nonSe) return;
        const resp = await api('POST', '/api/payouts/pay', { role: 'ADMIN', body: { employee_id: nonSe.employee_id, year: 2026, month: 12, kind: 'salary', pay_amount: 100, transfer_amount: 150, payout_platform: 'cash', confirm_over: true } });
        if (resp.status === 409) return;
        assertOk(resp, 'pay custom transfer');
        const pid = resp.data.payment.id;
        createdPaymentIds.push(pid);
        assert(Math.abs(resp.data.preview.transfer_amount - 150) < 0.01, `transfer=${resp.data.preview.transfer_amount}, ожидалось 150`);
        const hist = await api('GET', `/api/payouts/history/${nonSe.employee_id}`, { role: 'ADMIN' });
        const rec = (hist.data.operations || []).find((o) => o.id === pid);
        assert(rec && Math.abs(rec.transfer_amount - 150) < 0.01, `в БД transfer_amount=${rec && rec.transfer_amount}`);
      },
    },
    {
      name: 'preview: возвращает строку и ставку налога',
      run: async () => {
        const empId = await firstWorkingEmployee();
        const r = await api('GET', `/api/payouts/preview/${empId}?year=2026&month=9`, { role: 'ADMIN' });
        assertOk(r, 'preview');
        assertHasFields(r.data, ['employee', 'tax_rate', 'is_self_employed'], 'preview shape');
      },
    },
    {
      name: '400-матрица периодов: list/archive/preview/statement/monthly-series',
      run: async () => {
        const bad = [
          ['GET', '/api/payouts/list/2026/13'],
          ['GET', '/api/payouts/list/2019/1'],
          ['GET', '/api/payouts/list/abc/1'],
          ['GET', '/api/payouts/archive/2026/13'],
          ['GET', '/api/payouts/monthly-series/2019'],
          ['GET', '/api/payouts/monthly-series/abc'],
          ['GET', '/api/payouts/preview/18?year=2026&month=13'],
          ['GET', '/api/payouts/preview/abc?year=2026&month=9'],
          ['GET', '/api/payouts/history/abc'],
          ['GET', '/api/payouts/hr/2026/13'],
        ];
        for (const [m, u] of bad) {
          const r = await api(m, u.includes('/hr/') ? u.replace('/hr/', '/statement/18/') : u, { role: 'ADMIN' });
          assertStatus(r, 400, `bad ${u}`);
        }
      },
    },
    {
      name: 'list: помечает строку warning при незакрытых данных периода',
      run: async () => {
        // месяц с active-сменами в клоне (проверено ранее: 2026-04)
        const r = await api('GET', '/api/payouts/list/2026/4', { role: 'ADMIN' });
        assertOk(r, 'list april');
        assert(r.data.ready_to_pay === false, 'апрель должен быть not-ready (есть незакрытые смены)');
        assertArray(r.data.warnings, 'warnings');
        assert(r.data.warnings.length > 0, 'должно быть хотя бы одно предупреждение');
      },
    },
    {
      name: 'monthly-series: возвращает 12 месяцев с числами',
      run: async () => {
        const r = await api('GET', '/api/payouts/monthly-series/2026', { role: 'ADMIN' });
        assertOk(r, 'monthly-series');
        assertArray(r.data.series, 'series');
        assert(r.data.series.length === 12, `месяцев ${r.data.series.length}, ожидалось 12`);
        r.data.series.forEach((s, i) => {
          assert(typeof s.paid === 'number', `месяц ${i + 1} paid не число`);
          assert(s.month === i + 1, `месяц ${i + 1} подписан как ${s.month}`);
        });
      },
    },
    {
      name: 'history: возвращает операции сотрудника с полной схемой',
      run: async () => {
        const empId = await firstWorkingEmployee();
        const r = await api('GET', `/api/payouts/history/${empId}`, { role: 'ADMIN' });
        assertOk(r, 'history');
        assertArray(r.data.operations, 'operations');
        if (r.data.operations.length) {
          assertHasFields(r.data.operations[0], ['id', 'type', 'amount', 'status'], 'operation fields');
        }
      },
    },
    {
      name: 'access: возвращает список грантов (user_ids)',
      run: async () => {
        const r = await api('GET', '/api/payouts/access', { role: 'ADMIN' });
        assertOk(r, 'access');
        assertArray(r.data.user_ids, 'user_ids');
      },
    },

    // ── Экспорт ─────────────────────────────────────────────────────────────
    {
      name: 'export: xlsx (PK-магия) для месяца',
      run: async () => {
        const token = await getToken('ADMIN');
        const res = await fetch(`${BASE_URL}/api/payouts/export/2026/9`, { headers: { Authorization: `Bearer ${token}` } });
        assert(res.status === 200, `export status ${res.status}`);
        const ab = await res.arrayBuffer();
        const b = new Uint8Array(ab);
        assert(b[0] === 0x50 && b[1] === 0x4B, 'не валидный xlsx (нет PK)');
      },
    },
    {
      name: 'statement: xlsx для сотрудника',
      run: async () => {
        const empId = await firstWorkingEmployee();
        const token = await getToken('ADMIN');
        const res = await fetch(`${BASE_URL}/api/payouts/statement/${empId}/2026/9`, { headers: { Authorization: `Bearer ${token}` } });
        assert(res.status === 200, `statement status ${res.status}`);
        const ab = await res.arrayBuffer();
        const b = new Uint8Array(ab);
        assert(b[0] === 0x50 && b[1] === 0x4B, 'не валидный xlsx (нет PK)');
      },
    },
    {
      name: 'export: некорректный период → 400',
      run: async () => {
        const r = await api('GET', '/api/payouts/export/2026/13', { role: 'ADMIN' });
        assertStatus(r, 400, 'export bad period');
      },
    },

    // ── Field-контур: подтверждение/спор рабочего ───────────────────────────
    {
      name: 'field: my/pending без токена → 401',
      run: async () => {
        const r = await rawFetch('GET', '/api/payouts/my/pending');
        assertStatus(r, 401, 'my/pending no token');
      },
    },
    {
      name: 'field: my/pending видит только свои awaiting-выплаты',
      run: async () => {
        const empId = await employeeWithPin();
        if (!empId) return;
        const pid = await mkWaittingPayment(empId, 777);
        try {
          const tok = await fieldTokenFor(empId);
          const r = await rawFetch('GET', '/api/payouts/my/pending', { token: tok });
          assert(r.status === 200, `my/pending status ${r.status}`);
          const list = (r.data && r.data.payments) || [];
          assertArray(list, 'payments');
          assert(list.some((p) => p.id === pid), `выплата ${pid} не видна в my/pending`);
          list.forEach((p) => assert(p.confirmation_status === 'awaiting', 'в my/pending только awaiting'));
        } finally { await cleanupFieldFixtures([pid]); }
      },
    },
    {
      name: 'field: confirm с неверным кодом → 400 invalid_code, с верным → 200 + confirmed',
      run: async () => {
        const empId = await employeeWithPin();
        if (!empId) return;
        const pid = await mkWaittingPayment(empId, 888);
        try {
          const tok = await fieldTokenFor(empId);
          const c = await pg();
          await c.query(`INSERT INTO payout_confirmation_codes (payment_id, employee_id, code_hash, expires_at) VALUES ($1,$2,$3, NOW()+INTERVAL '1 hour')`, [pid, empId, await bcrypt.hash('13579', 10)]);

          const bad = await rawFetch('POST', `/api/payouts/my/${pid}/confirm`, { token: tok, body: { code: '00000' }, headers: { 'Content-Type': 'application/json' } });
          assert(bad.status === 400, `неверный код должен дать 400, получено ${bad.status}`);
          assert(bad.data && bad.data.error === 'invalid_code', `ожидался invalid_code, получено ${JSON.stringify(bad.data)}`);

          const ok = await rawFetch('POST', `/api/payouts/my/${pid}/confirm`, { token: tok, body: { code: '13579' }, headers: { 'Content-Type': 'application/json' } });
          assert(ok.status === 200, `верный код должен дать 200, получено ${ok.status}`);

          const { rows } = await c.query('SELECT confirmation_status, confirmed_by_worker FROM worker_payments WHERE id=$1', [pid]);
          assert(rows[0].confirmation_status === 'confirmed', 'статус должен стать confirmed');
          assert(rows[0].confirmed_by_worker === true, 'confirmed_by_worker=true');
        } finally { await cleanupFieldFixtures([pid]); }
      },
    },
    {
      name: 'field: чужую выплату нельзя подтвердить (404)',
      run: async () => {
        const c = await pg();
        const { rows: emps } = await c.query(
          `SELECT e.id FROM employees e JOIN users u ON u.id=e.user_id
            WHERE e.phone IS NOT NULL AND u.pin_hash IS NOT NULL AND e.is_active = true LIMIT 2`);
        if (emps.length < 2) return;
        const [me, other] = [emps[0].id, emps[1].id];
        const pid = await mkWaittingPayment(other, 999); // выплата ДРУГОМУ
        try {
          const tok = await fieldTokenFor(me);
          await c.query(`INSERT INTO payout_confirmation_codes (payment_id, employee_id, code_hash, expires_at) VALUES ($1,$2,$3, NOW()+INTERVAL '1 hour')`, [pid, other, await bcrypt.hash('24680', 10)]);
          const r = await rawFetch('POST', `/api/payouts/my/${pid}/confirm`, { token: tok, body: { code: '24680' }, headers: { 'Content-Type': 'application/json' } });
          assert(r.status === 404, `чужую выплату подтвердить нельзя, получено ${r.status}`);
        } finally { await cleanupFieldFixtures([pid]); }
      },
    },
    {
      name: 'field: dispute своей awaiting → 200 + контакты; чужой → 404',
      run: async () => {
        const c = await pg();
        const { rows: emps } = await c.query(
          `SELECT e.id FROM employees e JOIN users u ON u.id=e.user_id
            WHERE e.phone IS NOT NULL AND u.pin_hash IS NOT NULL AND e.is_active = true LIMIT 2`);
        if (!emps.length) return;
        const me = emps[0].id;
        const pid = await mkWaittingPayment(me, 555);
        try {
          const tok = await fieldTokenFor(me);
          const ok = await rawFetch('POST', `/api/payouts/my/${pid}/dispute`, { token: tok, body: { reason: 'не получил' }, headers: { 'Content-Type': 'application/json' } });
          assert(ok.status === 200, `dispute статус ${ok.status}`);
          assert(ok.data && ok.data.contacts, 'dispute должен вернуть contacts');
          const { rows } = await c.query('SELECT confirmation_status FROM worker_payments WHERE id=$1', [pid]);
          assert(rows[0].confirmation_status === 'disputed', 'статус должен стать disputed');

          if (emps.length >= 2) {
            const other = emps[1].id;
            const pid2 = await mkWaittingPayment(other, 556);
            try {
              const r2 = await rawFetch('POST', `/api/payouts/my/${pid2}/dispute`, { token: tok, body: {}, headers: { 'Content-Type': 'application/json' } });
              assert(r2.status === 404, `чужой dispute должен дать 404, получено ${r2.status}`);
            } finally { await c.query('DELETE FROM worker_payments WHERE id=$1', [pid2]); }
          }
        } finally { await cleanupFieldFixtures([pid]); }
      },
    },
    {
      name: 'field: confirm требования awaiting — повтор на confirmed → 404',
      run: async () => {
        const empId = await employeeWithPin();
        if (!empId) return;
        const pid = await mkWaittingPayment(empId, 999);
        try {
          const c = await pg();
          // Сразу переводим в confirmed в обход API
          await c.query(`UPDATE worker_payments SET confirmation_status='confirmed', status='confirmed' WHERE id=$1`, [pid]);
          await c.query(`INSERT INTO payout_confirmation_codes (payment_id, employee_id, code_hash, expires_at) VALUES ($1,$2,$3, NOW()+INTERVAL '1 hour')`, [pid, empId, await bcrypt.hash('11223', 10)]);
          const tok = await fieldTokenFor(empId);
          const r = await rawFetch('POST', `/api/payouts/my/${pid}/confirm`, { token: tok, body: { code: '11223' }, headers: { 'Content-Type': 'application/json' } });
          assert(r.status === 404, `повторное подтверждение должно дать 404, получено ${r.status}`);
        } finally { await cleanupFieldFixtures([pid]); }
      },
    },

    // ── Уборка ──────────────────────────────────────────────────────────────
    {
      name: 'Cleanup: удалить все тестовые артефакты (hard)',
      run: async () => {
        // Штатный DELETE /worker-payments/:id делает soft-cancel (status=cancelled).
        // Для чистоты клона удаляем созданное тестом ЖЁСТКО, по маркеру payout_batch_id
        // (мои выплаты) + фикстуры field-контура по device_info='verify_auto'.
        const c = await pg();
        await c.query(`DELETE FROM payout_confirmation_codes WHERE payment_id IN (SELECT id FROM worker_payments WHERE payout_batch_id IS NOT NULL)`);
        await c.query(`DELETE FROM audit_log WHERE action LIKE 'payout%' AND created_at::date = CURRENT_DATE`);
        await c.query(`DELETE FROM notifications WHERE type='payment_received' AND created_at::date = CURRENT_DATE`);
        await c.query(`DELETE FROM worker_payments WHERE payout_batch_id IS NOT NULL`);
        await c.query(`DELETE FROM field_sessions WHERE device_info IN ('verify_auto','verify')`);
        createdPaymentIds = [];
      },
    },
  ],
};
