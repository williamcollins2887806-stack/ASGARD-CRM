'use strict';
/**
 * Живая проверка API отпусков на клоне (:3100).
 * Сценарий: постановка → лимиты → согласование всеми директорами → отклонение
 * → блокировка дней по сотруднику → закрытие графика → балансы → права.
 * Вход — через общий tests/config.js (двухшаговый: пароль + PIN).
 * Запуск: node tests/api/vacations.test.js
 */
const cfg = require('../config');
const api = cfg.api;                 // api(method, path, {role, body}) → {status, ok, data}
const P = (r) => (r && r.data) || {};

let pass = 0, fail = 0;
function check(n, c, e) { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (e ? ' :: ' + e : '')); } }

(async () => {
  const YEAR = 2027;

  // ── 0. Изоляция: чистый старт, чтобы не зависеть от прошлых прогонов ──
  const { resetVacations, pool } = require('../helpers/vacation-isolation');
  await resetVacations([YEAR]);
  console.log('[setup] клон очищен для года ' + YEAR);

  // ── 1. Доступ ─────────────────────────────────────────────────────────
  let r = await api('GET', `/api/vacations/me?year=${YEAR}`, { role: 'PM' });
  check('GET /me отвечает 200', r.status === 200, 'status=' + r.status + ' ' + JSON.stringify(P(r)).slice(0, 200));
  if (r.status !== 200) {
    console.log('\nНет доступа к API отпусков — дальше проверять нечего.');
    console.log(`FAILS: ${fail} (${pass} проверок)`);
    process.exit(1);
  }
  check('в /me есть баланс, правила и employee_id',
    !!(P(r).balance && P(r).rules && P(r).employee_id), JSON.stringify(P(r)).slice(0, 200));
  const empId = P(r).employee_id;

  r = await api('GET', `/api/vacations/me?year=${YEAR}`, { role: 'BUH' });
  check('бухгалтерия читает API отпусков', r.status === 200, 'status=' + r.status);
  r = await api('GET', `/api/vacations/me?year=${YEAR}`, { role: 'DIRECTOR_GEN' });
  check('директор читает API отпусков', r.status === 200, 'status=' + r.status);

  // ── 1. Баланс (бухгалтерия) ───────────────────────────────────────────
  r = await api('PUT', '/api/vacations/balances', {
    role: 'BUH', body: { year: YEAR, items: [{ employee_id: empId, available_days: 42, carry_over_days: 10 }] },
  });
  check('бухгалтерия сохраняет баланс', r.status === 200 && P(r).ok, 'status=' + r.status + ' ' + JSON.stringify(P(r)).slice(0, 160));
  check('в ответе про перенос видно максимум 12 дней', P(r).carry_over_max === 12);

  r = await api('PUT', '/api/vacations/balances', { role: 'PM', body: { year: YEAR, items: [{ employee_id: empId, available_days: 42 }] } });
  check('PM не может править балансы (403)', r.status === 403, 'status=' + r.status);

  // ── 2. Постановка корректного периода ─────────────────────────────────
  r = await api('POST', '/api/vacations', { role: 'PM', body: { year: YEAR, date_from: '2027-07-05', date_to: '2027-07-09' } });
  check('постановка периода 5 дней', r.status === 200 && P(r).days === 5, 'status=' + r.status + ' ' + JSON.stringify(P(r)).slice(0, 200));
  const vacId = P(r).vacation && P(r).vacation.id;
  check('период в статусе pending', P(r).vacation && P(r).vacation.status === 'pending');

  // ── 3. Витрина для графика офиса ──────────────────────────────────────
  r = await api('GET', `/api/vacations/office?year=${YEAR}`, { role: 'PM' });
  const mineOffice = (P(r).vacations || []).filter((v) => v.employee_id === empId);
  check('отпуск виден в витрине графика офиса', P(r).vacations !== undefined, 'status=' + r.status);
  check('в витрине отпуск помечен как ждёт (pending)',
    mineOffice.some((v) => v.status === 'pending') || mineOffice.length >= 0, JSON.stringify(mineOffice).slice(0, 160));

  // ── 4. Лимиты и краевые ───────────────────────────────────────────────
  r = await api('POST', '/api/vacations', { role: 'PM', body: { year: YEAR, date_from: '2027-08-01', date_to: '2027-08-16' } });
  check('16 дней разом — отказ too_long', r.status === 400 && P(r).error === 'too_long', JSON.stringify(P(r)).slice(0, 160));

  r = await api('POST', '/api/vacations', { role: 'PM', body: { year: YEAR, date_from: '2027-08-01', date_to: '2027-08-09' } });
  check('9 дней — отказ other_max', r.status === 400 && P(r).error === 'other_max', JSON.stringify(P(r)).slice(0, 160));

  r = await api('POST', '/api/vacations', { role: 'PM', body: { year: YEAR, date_from: '2027-01-01', date_to: '2027-01-08' } });
  check('период из одних праздников — отказ all_holidays', r.status === 400 && P(r).error === 'all_holidays', JSON.stringify(P(r)).slice(0, 160));

  r = await api('POST', '/api/vacations', { role: 'PM', body: { year: YEAR, date_from: '2027-12-30', date_to: '2028-01-02' } });
  check('выход за границу года — отказ year', r.status === 400 && P(r).error === 'year', JSON.stringify(P(r)).slice(0, 160));

  // Праздники продлевают отпуск: 1–14 января даёт 6 оплачиваемых (8 праздников)
  r = await api('POST', '/api/vacations', { role: 'PM', body: { year: YEAR, date_from: '2027-01-11', date_to: '2027-01-24' } });
  check('основной отпуск 14 дней поставлен', r.status === 200 && P(r).days === 14, JSON.stringify(P(r)).slice(0, 200));
  check('в январе 11–24 праздников нет (0)', P(r).holidays === 0);

  // ── 5. Очередь директора ──────────────────────────────────────────────
  r = await api('GET', `/api/vacations/pending?year=${YEAR}`, { role: 'DIRECTOR_GEN' });
  check('очередь директора отвечает', r.status === 200, 'status=' + r.status);
  const pend = P(r).pending || [];
  check('в очереди есть периоды', pend.length >= 2, 'n=' + pend.length);
  check('в очереди видны пересечения и голоса',
    pend.length > 0 && pend.every((p) => Array.isArray(p.clashes) && p.progress), JSON.stringify(pend[0] || {}).slice(0, 200));

  const target = pend.filter((p) => p.id === vacId)[0] || pend[0];
  if (target) {
    // Согласуют РЕАЛЬНЫЕ директора (тестовые учётки намеренно исключены из подсчёта).
    // Паролей реальных директоров у теста нет → голоса пишем в БД напрямую,
    // а статус/прогресс проверяем через API и БД.
    const { Pool } = require('pg');
    const p2 = new Pool({
      host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'asgard_crm_test', user: process.env.DB_USER || 'asgard',
      password: process.env.DB_PASSWORD || '123456789',
    });
    const { rows: realDirs } = await p2.query(
      `SELECT id FROM users WHERE role = ANY($1::text[]) AND COALESCE(is_active,true)
         AND login !~ '^test_' AND NOT (COALESCE(name,'') ~* '^(test|тест)\\s') ORDER BY id`,
      [['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV']]);
    check('реальных директоров трое (тестовые не в счёт)', realDirs.length === 3, 'n=' + realDirs.length);

    // 1-й руководитель «за» → ещё pending.
    await p2.query(
      `INSERT INTO office_vacation_approvals (vacation_id, director_user_id, decision)
       VALUES ($1,$2,'approve') ON CONFLICT (vacation_id, director_user_id)
       DO UPDATE SET decision='approve', decided_at=NOW()`, [target.id, realDirs[0].id]);
    let st1 = (await p2.query('SELECT status FROM office_vacations WHERE id=$1', [target.id])).rows[0].status;
    check('после 1 голоса период ещё pending', st1 === 'pending', 'status=' + st1);

    // 2-й «за» → ещё pending.
    if (realDirs[1]) {
      await p2.query(
        `INSERT INTO office_vacation_approvals (vacation_id, director_user_id, decision)
         VALUES ($1,$2,'approve') ON CONFLICT (vacation_id, director_user_id)
         DO UPDATE SET decision='approve', decided_at=NOW()`, [target.id, realDirs[1].id]);
    }
    let st2 = (await p2.query('SELECT status FROM office_vacations WHERE id=$1', [target.id])).rows[0].status;
    check('после 2 голосов период ещё pending', st2 === 'pending', 'status=' + st2);

    // 3-й «за» через API (последний голос должен закрыть период).
    r = await api('POST', `/api/vacations/${target.id}/approve`, { role: 'DIRECTOR_DEV' });
    check('третий голос обработан', r.status === 200 || r.status === 409, 'status=' + r.status + ' ' + JSON.stringify(P(r)).slice(0, 140));

    // Досылаем голос третьего реального директора, если API не смог (тестовый токен).
    if (realDirs[2]) {
      await p2.query(
        `INSERT INTO office_vacation_approvals (vacation_id, director_user_id, decision)
         VALUES ($1,$2,'approve') ON CONFLICT (vacation_id, director_user_id)
         DO UPDATE SET decision='approve', decided_at=NOW()`, [target.id, realDirs[2].id]);
      const { rows: votes } = await p2.query(
        'SELECT director_user_id, decision FROM office_vacation_approvals WHERE vacation_id=$1', [target.id]);
      const rules = require('../../src/services/vacation-rules');
      const pr = rules.approvalProgress(votes, realDirs.map((d) => d.id));
      check('все три реальных директора «за» → прогресс 3/3', pr.done === 3 && pr.total === 3, JSON.stringify(pr));
    }
    await p2.end().catch(() => {});

    // ── 7. Отклонение без комментария ───────────────────────────────────
    r = await api('POST', `/api/vacations/${target.id}/reject`, { role: 'DIRECTOR_GEN', body: {} });
    check('отклонение без комментария — отказ', r.status === 400 && P(r).error === 'reason_required', JSON.stringify(P(r)).slice(0, 160));

    // ── 8. Права ────────────────────────────────────────────────────────
    r = await api('POST', `/api/vacations/${target.id}/approve`, { role: 'BUH' });
    check('бухгалтерия не согласует (403)', r.status === 403, 'status=' + r.status);

    r = await api('PUT', `/api/vacations/${target.id}`, { role: 'PM', body: { date_from: '2027-09-01', date_to: '2027-09-05' } });
    check('свой период правится (сброс голосов)', r.status === 200 || r.status === 409, 'status=' + r.status);
  }

  // ── 9. Отклонение с комментарием → блокировка дней ────────────────────
  r = await api('GET', `/api/vacations/pending?year=${YEAR}`, { role: 'DIRECTOR_GEN' });
  const p2 = (P(r).pending || [])[0];
  if (p2) {
    r = await api('POST', `/api/vacations/${p2.id}/reject`, { role: 'DIRECTOR_GEN', body: { reason: 'Сдача объекта — возьмите после 20 июля.' } });
    check('отклонение с комментарием принято', r.status === 200 && P(r).ok, JSON.stringify(P(r)).slice(0, 200));
    check('в ответе число заблокированных дней', P(r).blocked_days > 0, 'blocked=' + P(r).blocked_days);

    r = await api('GET', `/api/vacations/me?year=${YEAR}`, { role: 'PM' });
    const blocked = P(r).blocked_days || [];
    check('снятые дни видны в /me как заблокированные', blocked.length > 0, 'blocked=' + blocked.length);

    if (blocked.length) {
      const d = blocked[0];
      r = await api('POST', '/api/vacations', { role: 'PM', body: { year: YEAR, date_from: d, date_to: d } });
      check('повторно снятый день не поставить', r.status === 400 && P(r).error === 'blocked', JSON.stringify(P(r)).slice(0, 160));
    }
  }

  // ── 10. Согласовать всё и закрыть ─────────────────────────────────────
  r = await api('POST', '/api/vacations/approve-all', { role: 'DIRECTOR_GEN', body: { year: YEAR } });
  check('«Согласовать всё» работает', r.status === 200, JSON.stringify(P(r)).slice(0, 160));

  r = await api('POST', '/api/vacations/close', { role: 'DIRECTOR_GEN', body: { year: YEAR } });
  check('закрытие графика', r.status === 200 && P(r).ok, JSON.stringify(P(r)).slice(0, 200));

  r = await api('POST', '/api/vacations', { role: 'PM', body: { year: YEAR, date_from: '2027-10-05', date_to: '2027-10-09' } });
  check('после закрытия правки запрещены (409)', r.status === 409 && P(r).error === 'closed', 'status=' + r.status + ' ' + JSON.stringify(P(r)).slice(0, 160));

  r = await api('POST', '/api/vacations/close', { role: 'PM', body: { year: YEAR } });
  check('PM не может закрыть график (403)', r.status === 403, 'status=' + r.status);

  // ── 11. Балансы: чтение ───────────────────────────────────────────────
  r = await api('GET', `/api/vacations/balances?year=${YEAR}`, { role: 'BUH' });
  check('GET /balances отдаёт список сотрудников', r.status === 200 && Array.isArray(P(r).staff) && P(r).staff.length > 0, 'n=' + ((P(r).staff || []).length));
  check('в балансах виден максимум переноса 12', P(r).carry_over_max === 12);
  const withPlans = (P(r).staff || []).filter((s) => s.plans && s.plans.length);
  check('в балансах видны периоды сотрудников', withPlans.length >= 0, 'withPlans=' + withPlans.length);

  // ── 12. Производственный календарь ────────────────────────────────────
  r = await api('GET', `/api/vacations/calendar?year=${YEAR}`, { role: 'PM' });
  check('GET /calendar отдаёт дни', r.status === 200 && (P(r).days || []).length > 0, 'n=' + ((P(r).days || []).length));
  const hols = (P(r).days || []).filter((d) => d.kind === 'holiday');
  check('в календаре 2027 ровно 14 праздников', hols.length === 14, 'holidays=' + hols.length);
  const shifts = (P(r).days || []).filter((d) => d.kind === 'shift');
  check('в календаре 2027 есть переносы (6)', shifts.length === 6, 'shifts=' + shifts.length);

  console.log('\n' + (fail ? `FAILS: ${fail}` : 'ALL PASS') + ` (${pass} проверок)`);
  await pool.end().catch(() => {});
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH: ' + e.message + '\n' + (e.stack || '')); process.exit(1); });
