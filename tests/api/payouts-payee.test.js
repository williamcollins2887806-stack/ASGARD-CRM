/**
 * API-тесты: получатель НПД (payee) + смена режима найма (наличка↔СЗ).
 * ═══════════════════════════════════════════════════════════════════════════
 * Баг 15.10.2026: карточка «дружины» при выбранном получателе НПД гасила
 * is_self_employed — рабочий «оставался наличным» в выплатах, а контур payee
 * терялся (se-limits/payroll-dashboard учитывают payee только при СЗ=true).
 * Здесь фиксируем контракт, чтобы регресс не вернулся.
 *
 * Состояние восстанавливаем — база остаётся эталонной.
 */
const { api, assert, assertOk, assertStatus } = require('../config');

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

/** Находит рабочего с получателем; на клоне их 3 (89, 104, 214). */
async function findPayeeWorker(c) {
  const { rows } = await c.query(
    `SELECT id, fio, is_self_employed, se_payee_id FROM employees
      WHERE se_payee_id IS NOT NULL ORDER BY id LIMIT 1`);
  return rows[0] || null;
}

module.exports = {
  name: 'PAYEE + смена режима найма (дружина → выплаты)',
  tests: [
    {
      name: '01. /preview отдаёт получателя НПД (id, ФИО, телефон)',
      run: async () => {
        const c = await pg();
        const w = await findPayeeWorker(c);
        if (!w) return; // нет данных — нечего проверять
        const r = await api('GET', `/api/payouts/preview/${w.id}?year=2026&month=9`);
        assertOk(r, 'preview');
        const e = r.data.employee || {};
        assert(e.se_payee_id, 'preview.employee.se_payee_id должен быть заполнен');
        assert(Number(e.se_payee_id) === Number(w.se_payee_id), 'payee id совпадает с БД');
        assert(e.se_payee_fio, 'preview отдаёт ФИО получателя');
      },
    },
    {
      name: '02. Получатель НПД + СЗ сосуществуют (не сбрасываются)',
      run: async () => {
        const c = await pg();
        const w = await findPayeeWorker(c);
        if (!w) return;
        const orig = { se: w.is_self_employed, payee: w.se_payee_id };

        // Пишем оба поля одновременно (как карточка дружины)
        const put = await api('PUT', `/api/staff/employees/${w.id}`, {
          role: 'ADMIN',
          body: { is_self_employed: true, se_payee_id: orig.payee },
        });
        assertOk(put, 'PUT payee + СЗ');

        const { rows } = await c.query('SELECT is_self_employed, se_payee_id FROM employees WHERE id=$1', [w.id]);
        assert(rows[0].is_self_employed === true,
          'is_self_employed должен остаться true (баг: сбрасывался в false при payee)');
        assert(Number(rows[0].se_payee_id) === Number(orig.payee), 'se_payee_id сохранён');

        // Восстановление
        await c.query('UPDATE employees SET is_self_employed=$2, se_payee_id=$3 WHERE id=$1',
          [w.id, orig.se, orig.payee]);
      },
    },
    {
      name: '03. Смена наличка→СЗ видна в /preview и /list сразу',
      run: async () => {
        const c = await pg();
        // Берём не-СЗ рабочего с данными за сентябрь
        const { rows } = await c.query(
          `SELECT e.id, e.is_self_employed FROM employees e
            WHERE e.is_self_employed = false AND e.is_se_payee = false
              AND EXISTS (SELECT 1 FROM field_checkins fc WHERE fc.employee_id = e.id
                          AND fc.status='completed' AND fc.date BETWEEN '2026-09-01' AND '2026-09-30')
            LIMIT 1`);
        if (!rows.length) return;
        const emp = rows[0];

        await api('PUT', `/api/staff/employees/${emp.id}`, { role: 'ADMIN', body: { is_self_employed: true } });

        const pv = await api('GET', `/api/payouts/preview/${emp.id}?year=2026&month=9`);
        assert(pv.data.is_self_employed === true,
          'preview ДОЛЖЕН сразу показать СЗ (иначе модалка остаётся «наличной»)');

        const list = await api('GET', '/api/payouts/list/2026/9');
        const row = (list.data.rows || []).find((x) => x.employee_id === emp.id);
        assert(row && row.is_self_employed === true, 'list тоже сразу показывает СЗ');

        await c.query('UPDATE employees SET is_self_employed=false WHERE id=$1', [emp.id]);
      },
    },
    {
      name: '04. /preview отдаёт коэффициенты формулы СЗ (фронт не дублирует формулы)',
      run: async () => {
        const c = await pg();
        const w = await findPayeeWorker(c);
        const id = w ? w.id : 128;
        const r = await api('GET', `/api/payouts/preview/${id}?year=2026&month=9`);
        assertOk(r, 'preview');
        assert(r.data.calc, 'нет блока calc');
        assert(Math.abs(r.data.calc.se_info_coef - 1.064) < 1e-9, 'se_info_coef');
        assert(Math.abs(r.data.calc.se_transfer_coef - (1.064 / 0.96) * 1.22) < 1e-6, 'se_transfer_coef');
        assert(Math.abs(r.data.calc.official_markup_rate - 0.15) < 1e-9, 'official_markup_rate');
      },
    },
    {
      name: '05. Все рабочие с получателем остаются СЗ (консистентность данных)',
      run: async () => {
        const c = await pg();
        const { rows } = await c.query(
          `SELECT count(*) FILTER (WHERE se_payee_id IS NOT NULL)::int AS with_payee,
                  count(*) FILTER (WHERE se_payee_id IS NOT NULL AND is_self_employed)::int AS payee_and_se
             FROM employees`);
        const { with_payee, payee_and_se } = rows[0];
        assert(with_payee === payee_and_se,
          `рабочих с получателем ${with_payee}, из них СЗ ${payee_and_se} — payee без СЗ ломает контур выплат`);
      },
    },
  ],
};
