/**
 * API-тесты выплат (v2, 14.10.2026): формула СЗ, галка «официально»,
 * фикс архива после аванса, премия/удержание.
 * ═══════════════════════════════════════════════════════════════════════════
 * Всё создаём и УДАЛЯЕМ за собой (клон БД не должен меняться).
 * Целевой период намеренно «пустой» (июль 2027) — чтобы не задеть реальные
 * данные и не конфликтовать с baseline-проверками других тестов.
 */
const { api, assert, assertOk, assertStatus, getToken } = require('../config');

const PERIOD = { year: 2027, month: 7 };
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

let _adminId = null;
async function adminId(c) {
  if (_adminId) return _adminId;
  const r = await c.query("SELECT id FROM users WHERE role='ADMIN' AND is_active IS NOT false ORDER BY id LIMIT 1");
  _adminId = r.rows[0].id;
  return _adminId;
}

/** Рабочий-СЗ и не-СЗ для тестов (id фиксированы в клоне: 9869 СЗ, 128 не-СЗ). */
const SE_EMP = 9869;
const CASH_EMP = 128;

const setSetting = (c, key, val) =>
  c.query(`UPDATE settings SET value_json=$2, updated_at=NOW() WHERE key=$1`, [key, val]);

module.exports = {
  name: 'PAYOUTS v2 (формула СЗ / официально / архив / премия-удержание)',
  tests: [
    {
      name: '01. Настройки формулы присутствуют и корректны',
      run: async () => {
        const c = await pg();
        const { rows } = await c.query(
          `SELECT key, value_json FROM settings WHERE key IN
            ('payout_se_info_coef','payout_se_transfer_coef','payout_official_markup_rate')`);
        const map = Object.fromEntries(rows.map(r => [r.key, String(r.value_json)]));
        assert(map.payout_se_info_coef === '1.064', `se_info_coef = ${map.payout_se_info_coef}`);
        assert(Math.abs(parseFloat(map.payout_se_transfer_coef) - (1.064 / 0.96) * 1.22) < 1e-6,
          `se_transfer_coef = ${map.payout_se_transfer_coef}`);
        assert(map.payout_official_markup_rate === '0.15', `official_markup_rate = ${map.payout_official_markup_rate}`);
      },
    },
    {
      name: '02. GET /preview отдаёт коэффициенты (calc) для фронта',
      run: async () => {
        const r = await api('GET', `/api/payouts/preview/${SE_EMP}?year=${PERIOD.year}&month=${PERIOD.month}`);
        assertOk(r, 'preview');
        assert(r.data.calc, 'нет блока calc');
        assert(Math.abs(r.data.calc.se_info_coef - 1.064) < 1e-9, 'se_info_coef');
        assert(Math.abs(r.data.calc.se_transfer_coef - (1.064 / 0.96) * 1.22) < 1e-6, 'se_transfer_coef');
        assert(Math.abs(r.data.calc.official_markup_rate - 0.15) < 1e-9, 'official_markup_rate');
      },
    },
    {
      name: '03. СЗ: переводим = (1.064/0.96)*1.22, рабочему = ×1.064',
      run: async () => {
        const c = await pg();
        const uid = await adminId(c);
        // Чистим период заранее
        await c.query(`DELETE FROM worker_payments WHERE pay_year=$1 AND pay_month=$2 AND created_by=$3`,
          [PERIOD.year, PERIOD.month, uid]);

        const pay = 100000;
        const r = await api('POST', '/api/payouts/pay', {
          role: 'ADMIN',
          body: { employee_id: SE_EMP, year: PERIOD.year, month: PERIOD.month, kind: 'advance',
            pay_amount: pay, confirm_over: true, confirm_duplicate: true, payout_platform: 'restaff' },
        });
        assertOk(r, 'pay СЗ');
        const expTransfer = Math.round(pay * (1.064 / 0.96) * 1.22 * 100) / 100;
        const expInfo = Math.round(pay * 1.064 * 100) / 100;
        assert(Math.abs(Number(r.data.preview.transfer_amount) - expTransfer) < 0.02,
          `transfer=${r.data.preview.transfer_amount}, ожидалось ${expTransfer}`);
        assert(r.data.preview.is_self_employed === true, 'должен быть СЗ');

        const { rows } = await c.query('SELECT transfer_amount, info_amount, tax_amount, official_transfer, payout_platform FROM worker_payments WHERE id=$1', [r.data.payment.id]);
        assert(Math.abs(Number(rows[0].transfer_amount) - expTransfer) < 0.02, 'transfer в БД');
        assert(Math.abs(Number(rows[0].info_amount) - expInfo) < 0.02, `info_amount=${rows[0].info_amount}, ожидалось ${expInfo}`);
        assert(Math.abs(Number(rows[0].tax_amount) - (expTransfer - pay)) < 0.02, 'tax_amount = transfer − выплата');
        assert(rows[0].official_transfer === false, 'official_transfer должен быть false');
        assert(rows[0].payout_platform === 'restaff', 'платформа restaff');
      },
    },
    {
      name: '04. Наличка + галка «официально»: переводим = ×1.15',
      run: async () => {
        const c = await pg();
        const uid = await adminId(c);
        await c.query(`DELETE FROM worker_payments WHERE pay_year=$1 AND pay_month=$2 AND created_by=$3`,
          [PERIOD.year, PERIOD.month, uid]);

        const pay = 100000;
        const r = await api('POST', '/api/payouts/pay', {
          role: 'ADMIN',
          body: { employee_id: CASH_EMP, year: PERIOD.year, month: PERIOD.month, kind: 'advance',
            pay_amount: pay, official_transfer: true, confirm_over: true, confirm_duplicate: true },
        });
        assertOk(r, 'pay официально');
        assert(Math.abs(Number(r.data.preview.transfer_amount) - 115000) < 0.02,
          `transfer=${r.data.preview.transfer_amount}, ожидалось 115000`);
        assert(r.data.preview.official_transfer === true, 'official_transfer должен быть true');
        assert(r.data.preview.payout_platform === 'bank', 'канал должен быть bank');

        const { rows } = await c.query('SELECT official_transfer, payout_platform, payment_method FROM worker_payments WHERE id=$1', [r.data.payment.id]);
        assert(rows[0].official_transfer === true, 'flag в БД');
        assert(rows[0].payout_platform === 'bank', 'платформа bank в БД');
        assert(rows[0].payment_method === 'bank', 'payment_method bank');
      },
    },
    {
      name: '05. Наличка без галки: 1:1',
      run: async () => {
        const c = await pg();
        const uid = await adminId(c);
        await c.query(`DELETE FROM worker_payments WHERE pay_year=$1 AND pay_month=$2 AND created_by=$3`,
          [PERIOD.year, PERIOD.month, uid]);

        const r = await api('POST', '/api/payouts/pay', {
          role: 'ADMIN',
          body: { employee_id: CASH_EMP, year: PERIOD.year, month: PERIOD.month, kind: 'advance',
            pay_amount: 50000, confirm_over: true, confirm_duplicate: true },
        });
        assertOk(r, 'pay наличка');
        assert(Math.abs(Number(r.data.preview.transfer_amount) - 50000) < 0.02, 'перевод должен быть 1:1');
        assert(r.data.preview.official_transfer !== true, 'official_transfer = false');
      },
    },
    {
      name: '06. ФИКС АРХИВА: аванс не уводит строку вниз, пока есть что платить',
      run: async () => {
        const c = await pg();
        const uid = await adminId(c);
        await c.query(`DELETE FROM worker_payments WHERE pay_year=$1 AND pay_month=$2 AND created_by=$3`,
          [PERIOD.year, PERIOD.month, uid]);

        // Рабочий с начислением за период (реальные смены у 9869 есть только в сентябре).
        // Поэтому проверяем на сентябре 2026: создаём аванс и смотрим строку списка.
        const SEASON = { year: 2026, month: 9 };
        const tag = 'PAYOUT-TEST-ARCHIVE';
        await c.query(`DELETE FROM worker_payments WHERE comment=$1`, [tag]);
        await c.query(`INSERT INTO worker_payments (employee_id, type, amount, status, payment_method, paid_by, paid_by_role,
            pay_year, pay_month, comment, created_at, confirmation_status)
          VALUES ($1,'advance',30000,'paid','self',$2,'buh',$3,$4,$5,NOW(),'awaiting')`,
          [SE_EMP, uid, SEASON.year, SEASON.month, tag]);

        const list = await api('GET', `/api/payouts/list/${SEASON.year}/${SEASON.month}`);
        assertOk(list, 'list');
        const row = (list.data.rows || []).find(x => x.employee_id === SE_EMP);
        assert(row, 'строка рабочего не найдена');
        assert(row.paid_this_period === false,
          'аванс не должен помечать строку выплаченной (баг «упал в архив»)');
        assert(row.has_payment_this_period === true, 'факт выплаты должен быть виден');
        assert(row.to_pay > 0, `к выплате должно быть > 0, получено ${row.to_pay}`);

        await c.query(`DELETE FROM worker_payments WHERE comment=$1`, [tag]);
      },
    },
    {
      name: '07. Отрицательный остаток уходит в колонку «Аванс», не в «Остаток»',
      run: async () => {
        const c = await pg();
        const uid = await adminId(c);
        const SEASON = { year: 2026, month: 9 };
        const tag = 'PAYOUT-TEST-CARRY';
        await c.query(`DELETE FROM worker_payments WHERE comment=$1`, [tag]);
        // Переплата-аванс в прошлом периоде (август) → carry < 0
        await c.query(`INSERT INTO worker_payments (employee_id, type, amount, status, payment_method, paid_by, paid_by_role,
            pay_year, pay_month, comment, created_at)
          VALUES ($1,'penalty',12345,'pending','adjustment',$2,'buh',2026,8,$3,NOW())`, [SE_EMP, uid, tag]);

        const list = await api('GET', `/api/payouts/list/${SEASON.year}/${SEASON.month}`);
        assertOk(list, 'list');
        const row = (list.data.rows || []).find(x => x.employee_id === SE_EMP);
        assert(row, 'строка не найдена');
        assert(Number(row.carry_advance) >= 12345, `carry_advance=${row.carry_advance}, ожидалось ≥12345`);
        assert(Number(row.carry_debt) === 0, `carry_debt=${row.carry_debt}, ожидалось 0`);
        const invariants = Math.abs((Number(row.carry_debt) - Number(row.carry_advance)) - Number(row.carry)) < 0.02;
        assert(invariants, `carry = debt − advance нарушено: ${row.carry} ≠ ${row.carry_debt} − ${row.carry_advance}`);

        await c.query(`DELETE FROM worker_payments WHERE comment=$1`, [tag]);
      },
    },
    {
      name: '08. Премия: требует комментарий, увеличивает «к выплате»',
      run: async () => {
        const c = await pg();
        const uid = await adminId(c);
        const SEASON = { year: 2026, month: 9 };
        const tag = 'PAYOUT-TEST-BONUS';
        await c.query(`DELETE FROM worker_payments WHERE comment LIKE $1`, ['PAYOUT-TEST-BONUS%']);

        // Без комментария — 400
        const bad = await api('POST', '/api/payouts/adjustment', {
          role: 'ADMIN',
          body: { employee_id: SE_EMP, year: SEASON.year, month: SEASON.month, type: 'bonus', amount: 50000 },
        });
        assertStatus(bad, 400, 'премия без комментария должна отклоняться');
        assert(bad.data.error === 'comment_required', `error=${bad.data.error}`);

        const before = await api('GET', `/api/payouts/list/${SEASON.year}/${SEASON.month}`);
        const rowBefore = (before.data.rows || []).find(x => x.employee_id === SE_EMP);
        const toPayBefore = rowBefore ? Number(rowBefore.to_pay) : 0;
        const bonusBefore = rowBefore ? Number(rowBefore.bonus) : 0;

        // С комментарием — 200
        const ok = await api('POST', '/api/payouts/adjustment', {
          role: 'ADMIN',
          body: { employee_id: SE_EMP, year: SEASON.year, month: SEASON.month, type: 'bonus',
            amount: 50000, comment: tag + ': согласовал директор за переработку' },
        });
        assertOk(ok, 'премия с комментарием');
        assert(ok.data.adjustment && ok.data.adjustment.type === 'bonus', 'тип bonus');

        const after = await api('GET', `/api/payouts/list/${SEASON.year}/${SEASON.month}`);
        const rowAfter = (after.data.rows || []).find(x => x.employee_id === SE_EMP);
        assert(rowAfter, 'строка после премии');
        assert(Math.abs(Number(rowAfter.bonus) - (bonusBefore + 50000)) < 0.02,
          `bonus=${rowAfter.bonus}, ожидалось ${bonusBefore + 50000}`);
        assert(Math.abs(Number(rowAfter.to_pay) - (toPayBefore + 50000)) < 0.02,
          `to_pay=${rowAfter.to_pay}, ожидалось ${toPayBefore + 50000}`);

        await c.query(`DELETE FROM worker_payments WHERE comment LIKE $1`, ['PAYOUT-TEST-BONUS%']);
      },
    },
    {
      name: '09. Удержание: уменьшает «к выплате»',
      run: async () => {
        const c = await pg();
        const SEASON = { year: 2026, month: 9 };
        await c.query(`DELETE FROM worker_payments WHERE comment LIKE $1`, ['PAYOUT-TEST-PENALTY%']);

        const before = await api('GET', `/api/payouts/list/${SEASON.year}/${SEASON.month}`);
        const rowBefore = (before.data.rows || []).find(x => x.employee_id === SE_EMP);
        const toPayBefore = rowBefore ? Number(rowBefore.to_pay) : 0;

        const ok = await api('POST', '/api/payouts/adjustment', {
          role: 'ADMIN',
          body: { employee_id: SE_EMP, year: SEASON.year, month: SEASON.month, type: 'penalty',
            amount: 10000, comment: 'PAYOUT-TEST-PENALTY: порча инструмента' },
        });
        assertOk(ok, 'удержание');
        assert(ok.data.adjustment.type === 'penalty', 'тип penalty');

        const after = await api('GET', `/api/payouts/list/${SEASON.year}/${SEASON.month}`);
        const rowAfter = (after.data.rows || []).find(x => x.employee_id === SE_EMP);
        assert(Math.abs(Number(rowAfter.penalty) - (Number(rowBefore.penalty) + 10000)) < 0.02,
          `penalty=${rowAfter.penalty}`);
        assert(Math.abs(Number(rowAfter.to_pay) - (toPayBefore - 10000)) < 0.02,
          `to_pay=${rowAfter.to_pay}, ожидалось ${toPayBefore - 10000}`);

        await c.query(`DELETE FROM worker_payments WHERE comment LIKE $1`, ['PAYOUT-TEST-PENALTY%']);
      },
    },
    {
      name: '10. Пример ТЗ: начислено + премия − удержание (математика)',
      run: async () => {
        const c = await pg();
        const SEASON = { year: 2026, month: 9 };
        await c.query(`DELETE FROM worker_payments WHERE comment LIKE $1`, ['PAYOUT-TEST-MATH%']);

        const before = await api('GET', `/api/payouts/list/${SEASON.year}/${SEASON.month}`);
        const rowBefore = (before.data.rows || []).find(x => x.employee_id === SE_EMP);
        const base = Number(rowBefore.to_pay);

        await api('POST', '/api/payouts/adjustment', { role: 'ADMIN', body: {
          employee_id: SE_EMP, year: SEASON.year, month: SEASON.month, type: 'bonus', amount: 50000,
          comment: 'PAYOUT-TEST-MATH: премия' } });
        await api('POST', '/api/payouts/adjustment', { role: 'ADMIN', body: {
          employee_id: SE_EMP, year: SEASON.year, month: SEASON.month, type: 'penalty', amount: 10000,
          comment: 'PAYOUT-TEST-MATH: удержание' } });

        const after = await api('GET', `/api/payouts/list/${SEASON.year}/${SEASON.month}`);
        const rowAfter = (after.data.rows || []).find(x => x.employee_id === SE_EMP);
        assert(Math.abs(Number(rowAfter.to_pay) - (base + 50000 - 10000)) < 0.02,
          `to_pay=${rowAfter.to_pay}, ожидалось ${base + 40000}`);

        // evidence: табель видит премию/удержание за период
        const ts = await api('GET', `/api/timesheet-v2?year=${SEASON.year}&month=${SEASON.month}`);
        if (ts.ok && ts.data) {
          const emp = (ts.data.employees || []).find(e => e.id === SE_EMP)
                   || (ts.data.data && (ts.data.data.employees || []).find(e => e.id === SE_EMP));
          if (emp) {
            assert(Number(emp.bonus) >= 50000 || Number(emp.earned) > base,
              `табель не увидел премию: bonus=${emp.bonus}, earned=${emp.earned}`);
          }
        }

        await c.query(`DELETE FROM worker_payments WHERE comment LIKE $1`, ['PAYOUT-TEST-MATH%']);
      },
    },
    {
      name: '11. Гейт: доступ без прав → 403',
      run: async () => {
        const r = await api('POST', '/api/payouts/adjustment', {
          role: 'PM',
          body: { employee_id: SE_EMP, year: 2026, month: 9, type: 'bonus', amount: 1, comment: 'x' },
        });
        assertStatus(r, 403, 'PM не должен иметь доступ к корректировкам');
      },
    },
    {
      name: '12. Уборка: база вернулась к базовому состоянию (август/сентябрь по тегам)',
      run: async () => {
        const c = await pg();
        await c.query(`DELETE FROM worker_payments WHERE comment LIKE 'PAYOUT-TEST-%'`);
        const { rows } = await c.query(
          `SELECT count(*)::int n FROM worker_payments WHERE comment LIKE 'PAYOUT-TEST-%'`);
        assert(rows[0].n === 0, `осталось тестовых записей по тегу: ${rows[0].n}`);
        // Тестовый период 2027-07 — служебный, реальных данных там быть не может:
        // вычищаем все выплаты и связанные коды, чтобы база осталась эталонной.
        await c.query(`DELETE FROM payout_confirmation_codes WHERE payment_id IN
          (SELECT id FROM worker_payments WHERE pay_year=2027 AND pay_month=7)`);
        await c.query(`DELETE FROM worker_payments WHERE pay_year=2027 AND pay_month=7`);
        const b = await c.query(
          `SELECT count(*)::int n FROM worker_payments WHERE pay_year=2027 AND pay_month=7`);
        assert(b.rows[0].n === 0, `осталось выплат в тестовом периоде 2027-07: ${b.rows[0].n}`);
        // Контроль эталона: база не распухла от тестов
        const total = (await c.query('SELECT count(*)::int c FROM worker_payments')).rows[0].c;
        assert(total === 3026, `baseline сломан: worker_payments=${total}, ожидалось 3026`);
      },
    },
  ],
};
