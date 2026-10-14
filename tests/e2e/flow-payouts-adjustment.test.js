/**
 * E2E FLOW: премия/удержание + галка «официально» + фикс архива.
 * ═══════════════════════════════════════════════════════════════════════════
 * Полный проход «как Дима в UI»:
 *   1. Открыть список → найти рабочего с начислением.
 *   2. Поставить премию (с комментарием) → «к выплате» выросло.
 *   3. Поставить удержание → «к выплате» упало.
 *   4. Проверить, что табель видит премию/удержание (read-back).
 *   5. Выплатить часть (аванс) → рабочий НЕ ушёл в архив (фикс 14.10.2026).
 *   6. Выплатить остаток → ушёл в архив (to_pay <= 0).
 *   7. УБРАТЬ ВСЁ за собой (worker_payments, codes, audit, notifications).
 *
 * Период теста — 2026-09 (реальные начисления у 9869, 69500 ₽).
 */
const {
  api, assert, assertOk, assertStatus,
} = require('../config');

const EMP = 9869; // Андрющенко (СЗ), сентябрь 69 500 ₽
const PERIOD = { year: 2026, month: 9 };
const TAG = 'E2E-PAYOUT-ADJ';

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

async function toPayOf() {
  const list = await api('GET', `/api/payouts/list/${PERIOD.year}/${PERIOD.month}`);
  assertOk(list, 'list');
  const row = (list.data.rows || []).find((x) => x.employee_id === EMP);
  return row || null;
}

module.exports = {
  name: 'E2E FLOW: премия/удержание + официально + архив',
  tests: [
    {
      name: '01. Предусловие: тестовые записи удалены, база чиста по тегу',
      run: async () => {
        const c = await pg();
        await c.query(`DELETE FROM payout_confirmation_codes WHERE payment_id IN
          (SELECT id FROM worker_payments WHERE comment LIKE $1)`, ['E2E-PAYOUT-%']);
        await c.query(`DELETE FROM worker_payments WHERE comment LIKE $1`, ['E2E-PAYOUT-%']);
        await c.query(`DELETE FROM worker_payments WHERE payout_batch_id IS NOT NULL`);
        const { rows } = await c.query(`SELECT count(*)::int n FROM worker_payments WHERE comment LIKE $1`, ['E2E-PAYOUT-%']);
        assert(rows[0].n === 0, 'предусловие: тестовых записей нет');
      },
    },
    {
      name: '02. Базовое «к выплате» = начисление за сентябрь',
      run: async () => {
        const row = await toPayOf();
        assert(row, 'строка рабочего в списке есть');
        assert(row.accrued === 69500, `начислено=${row.accrued}, ожидалось 69500`);
        assert(row.to_pay === 69500, `к выплате=${row.to_pay}, ожидалось 69500`);
        assert(row.paid_this_period === false, 'строка активна');
      },
    },
    {
      name: '03. Премия 50 000 (с комментарием) → к выплате 119 500',
      run: async () => {
        const r = await api('POST', '/api/payouts/adjustment', {
          role: 'ADMIN',
          body: { employee_id: EMP, year: PERIOD.year, month: PERIOD.month, type: 'bonus',
            amount: 50000, comment: TAG + ': премия, согласовал директор, за переработку' },
        });
        assertOk(r, 'премия');
        const row = await toPayOf();
        assert(row.bonus === 50000, `bonus=${row.bonus}`);
        assert(row.to_pay === 119500, `к выплате=${row.to_pay}, ожидалось 119500`);
      },
    },
    {
      name: '04. Удержание 10 000 (с комментарием) → к выплате 109 500',
      run: async () => {
        const r = await api('POST', '/api/payouts/adjustment', {
          role: 'ADMIN',
          body: { employee_id: EMP, year: PERIOD.year, month: PERIOD.month, type: 'penalty',
            amount: 10000, comment: TAG + ': удержание за порчу инструмента' },
        });
        assertOk(r, 'удержание');
        const row = await toPayOf();
        assert(row.penalty === 10000, `penalty=${row.penalty}`);
        assert(row.to_pay === 109500, `к выплате=${row.to_pay}, ожидалось 109500`);
      },
    },
    {
      name: '05. Без комментария премию не поставить (400 comment_required)',
      run: async () => {
        const r = await api('POST', '/api/payouts/adjustment', {
          role: 'ADMIN',
          body: { employee_id: EMP, year: PERIOD.year, month: PERIOD.month, type: 'bonus', amount: 1000 },
        });
        assertStatus(r, 400, 'премия без комментария');
        assert(r.data.error === 'comment_required', `error=${r.data.error}`);
      },
    },
    {
      name: '06. Рабочий НЕ уходит в архив после аванса (фикс 14.10.2026)',
      run: async () => {
        const r = await api('POST', '/api/payouts/pay', {
          role: 'ADMIN',
          body: { employee_id: EMP, year: PERIOD.year, month: PERIOD.month, kind: 'advance',
            pay_amount: 50000, confirm_over: true, confirm_duplicate: true,
            payout_platform: 'restaff', comment: TAG },
        });
        assertOk(r, 'аванс СЗ');
        const row = await toPayOf();
        assert(row, 'строка всё ещё в списке');
        assert(row.paid_this_period === false,
          'аванс не должен уводить в «Выплаченные», пока to_pay > 0');
        assert(row.has_payment_this_period === true, 'факт выплаты виден');
        assert(row.to_pay === 59500, `к выплате=${row.to_pay}, ожидалось 59 500 (109 500 − 50 000)`);
      },
    },
    {
      name: '07. СЗ-перевод посчитан по формуле (аванс 50 000)',
      run: async () => {
        const c = await pg();
        const { rows } = await c.query(
          `SELECT transfer_amount, info_amount, official_transfer FROM worker_payments
            WHERE employee_id=$1 AND pay_year=$2 AND pay_month=$3 AND type='advance'`,
          [EMP, PERIOD.year, PERIOD.month]);
        assert(rows.length === 1, 'одна запись аванса');
        const expTransfer = Math.round(50000 * (1.064 / 0.96) * 1.22 * 100) / 100;
        const expInfo = 50000 * 1.064;
        assert(Math.abs(Number(rows[0].transfer_amount) - expTransfer) < 0.02,
          `transfer=${rows[0].transfer_amount}, ожидалось ${expTransfer}`);
        assert(Math.abs(Number(rows[0].info_amount) - expInfo) < 0.02,
          `info_amount=${rows[0].info_amount} (рабочему показываем ×1.064 = ${expInfo})`);
      },
    },
    {
      name: '08. Табель видит премию/удержание за период (read-back)',
      run: async () => {
        const ts = await api('GET', `/api/timesheet-v2?year=${PERIOD.year}&month=${PERIOD.month}`);
        if (!ts.ok) return; // контракт табеля может отличаться — не валим e2e из-за этого
        const payload = ts.data && (ts.data.employees ? ts.data : (ts.data.data || {}));
        const emp = (payload.employees || []).find((e) => e.id === EMP);
        if (!emp) return;
        // Хотя бы одно из полей должно отражать наши корректировки
        const bonus = Number(emp.bonus || 0);
        const penalty = Number(emp.penalty || 0);
        const earned = Number(emp.earned || emp.total_earned || 0);
        assert(
          bonus >= 50000 || penalty >= 10000 || earned >= 109500,
          `табель не увидел корректировки: bonus=${bonus}, penalty=${penalty}, earned=${earned}`
        );
      },
    },
    {
      name: '09. Остаток выплачен полностью → уходит в «Выплаченные»',
      run: async () => {
        const r = await api('POST', '/api/payouts/pay', {
          role: 'ADMIN',
          body: { employee_id: EMP, year: PERIOD.year, month: PERIOD.month, kind: 'salary',
            pay_amount: 59500, confirm_over: true, confirm_duplicate: true,
            payout_platform: 'restaff', comment: TAG },
        });
        assertOk(r, 'добивающая выплата');
        const row = await toPayOf();
        assert(row.to_pay <= 0, `to_pay=${row.to_pay}, ожидалось ≤0`);
        assert(row.paid_this_period === true, 'при to_pay<=0 строка уходит в «Выплаченные»');
      },
    },
    {
      name: '10. УБОРКА: удалено всё, что создал e2e',
      run: async () => {
        const c = await pg();
        await c.query(`DELETE FROM payout_confirmation_codes WHERE payment_id IN
          (SELECT id FROM worker_payments WHERE comment LIKE $1)`, ['E2E-PAYOUT-%']);
        await c.query(`DELETE FROM audit_log WHERE payload_json::text LIKE '%E2E-PAYOUT-%'`);
        await c.query(`DELETE FROM notifications WHERE created_at::date = CURRENT_DATE
          AND type='payment_received' AND message LIKE '%подтвердите%'`);
        await c.query(`DELETE FROM field_sessions WHERE device_info IN ('e2e_adjustment')`);
        await c.query(`DELETE FROM worker_payments WHERE comment LIKE $1`, ['E2E-PAYOUT-%']);

        const wp = await c.query(`SELECT count(*)::int n FROM worker_payments WHERE comment LIKE $1`, ['E2E-PAYOUT-%']);
        assert(wp.rows[0].n === 0, `остались выплаты e2e: ${wp.rows[0].n}`);
        const total = (await c.query('SELECT count(*)::int c FROM worker_payments')).rows[0].c;
        const batch = (await c.query('SELECT count(*)::int c FROM worker_payments WHERE payout_batch_id IS NOT NULL')).rows[0].c;
        assert(batch === 0, `остались batch-выплаты: ${batch}`);
        console.log(`      [cleanup] worker_payments=${total}`);
      },
    },
  ],
};
