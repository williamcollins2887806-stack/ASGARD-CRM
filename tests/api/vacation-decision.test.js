'use strict';
/**
 * Проверка ссылок «Да / Нет» из письма директору (публичный роут /vacation-decision/:token).
 * Ключевой сценарий ТЗ: директор нажал кнопку в письме → решение применилось.
 *
 * Запуск: node tests/api/vacation-decision.test.js
 * Требует клон-сервер :3100 и БД asgard_crm_test.
 */
const cfg = require('../config');
const api = cfg.api;

// Токен подписывается секретом из .env (как у сервера). Без этого секрет теста
// и сервера разойдётся, и подпись не сойдётся.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
// Тест работает ТОЛЬКО на клоне — .env указывает на dev-базу, перекрываем.
process.env.DB_NAME = 'asgard_crm_test';

const cron = require('../../src/services/vacation-reminders-cron');
const { Pool } = require('pg');

const BASE = cfg.BASE_URL || 'http://127.0.0.1:3100';
const YEAR = 2027;
let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (e ? ' :: ' + e : '')); } };

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'asgard_crm_test',
  user: process.env.DB_USER || 'asgard',
  password: process.env.DB_PASSWORD || '123456789',
});

async function http(path, opts = {}) {
  const r = await fetch(BASE + path, opts);
  const text = await r.text();
  return { status: r.status, text, headers: r.headers };
}

(async () => {
  // ── Изоляция ───────────────────────────────────────────────────────────
  await pool.query('DELETE FROM office_vacation_blocked_days WHERE vacation_id IN (SELECT id FROM office_vacations WHERE year=$1)', [YEAR]);
  await pool.query('DELETE FROM office_vacation_approvals WHERE vacation_id IN (SELECT id FROM office_vacations WHERE year=$1)', [YEAR]);
  await pool.query('DELETE FROM office_vacation_reminders WHERE vacation_id IN (SELECT id FROM office_vacations WHERE year=$1)', [YEAR]);
  await pool.query('DELETE FROM office_vacation_audit WHERE vacation_id IN (SELECT id FROM office_vacations WHERE year=$1)', [YEAR]);
  await pool.query('DELETE FROM office_vacations WHERE year=$1', [YEAR]);
  await pool.query('DELETE FROM office_vacation_periods WHERE year=$1', [YEAR]);
  await pool.query("DELETE FROM staff_plan WHERE status_code='отп' AND EXTRACT(YEAR FROM date)=$1", [YEAR]);

  // ── Готовим период через API (как сотрудник) ───────────────────────────
  let r = await api('GET', `/api/vacations/me?year=${YEAR}`, { role: 'PM' });
  const empId = (r.data || {}).employee_id;
  check('есть сотрудник для теста', !!empId, 'employee_id=' + empId);

  r = await api('PUT', '/api/vacations/balances', {
    role: 'BUH', body: { year: YEAR, items: [{ employee_id: empId, available_days: 42, carry_over_days: 0 }] },
  });
  check('баланс задан', r.status === 200);

  r = await api('POST', '/api/vacations', { role: 'PM', body: { year: YEAR, date_from: '2027-09-06', date_to: '2027-09-10' } });
  check('период поставлен', r.status === 200, JSON.stringify(r.data).slice(0, 160));
  const vacId = (r.data || {}).vacation && r.data.vacation.id;

  // директор по карте
  const { rows: dirs } = await pool.query(
    `SELECT id, name FROM users WHERE role='DIRECTOR_GEN' AND is_active = true ORDER BY id LIMIT 1`);
  const dirId = dirs[0] && dirs[0].id;
  check('есть активный директор', !!dirId, 'id=' + dirId);

  // ── 1. Токен и GET-страница ─────────────────────────────────────────────
  const yesTok = cron.decisionToken(vacId, dirId, 'approve');
  const noTok = cron.decisionToken(vacId, dirId, 'reject');

  r = await http(`/vacation-decision/${encodeURIComponent(yesTok)}`);
  check('GET страница решения открывается (200)', r.status === 200, 'status=' + r.status);
  check('на странице есть кнопка «Да»', /Да, согласовать/.test(r.text));
  check('на странице есть кнопка «Нет»', /Нет, снять/.test(r.text));
  check('в форме «Нет» есть поле причины', /name="reason"/.test(r.text));
  check('на странице указан сотрудник и период', /сентября/.test(r.text), r.text.slice(0, 120));

  // ── 2. Подделка токена отбивается ──────────────────────────────────────
  r = await http(`/vacation-decision/${encodeURIComponent(yesTok.slice(0, -3) + 'xxx')}`);
  check('подделанный токен отбит (400)', r.status === 400, 'status=' + r.status);

  // ── 3. «Нет» без причины — не применяется ──────────────────────────────
  const form = (action, reason) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(reason ? { action, reason } : { action }).toString(),
    redirect: 'manual',
  });

  r = await http(`/vacation-decision/${encodeURIComponent(noTok)}`, form('reject'));
  check('«Нет» без причины — отбито (400)', r.status === 400, 'status=' + r.status);
  let st = (await pool.query('SELECT status FROM office_vacations WHERE id=$1', [vacId])).rows[0].status;
  check('период остался pending после отказа без причины', st === 'pending', 'status=' + st);

  // ── 4. «Да» одним директором — голос учтён, но не согласовано ──────────
  r = await http(`/vacation-decision/${encodeURIComponent(yesTok)}`, form('approve'));
  check('«Да» применено (200)', r.status === 200, 'status=' + r.status);
  const votes = (await pool.query('SELECT director_user_id, decision FROM office_vacation_approvals WHERE vacation_id=$1', [vacId])).rows;
  check('голос директора записан', votes.length === 1 && votes[0].decision === 'approve', JSON.stringify(votes));
  st = (await pool.query('SELECT status FROM office_vacations WHERE id=$1', [vacId])).rows[0].status;
  check('один голос не делает период согласованным', st === 'pending', 'status=' + st);

  // ── 5. Все директора «за» → согласовано + «отп» в графике офиса ────────
  const { rows: allDirs } = await pool.query(
    `SELECT id FROM users WHERE role = ANY($1::text[]) AND is_active = true`,
    [['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV']]);
  for (const d of allDirs) {
    if (Number(d.id) === Number(dirId)) continue;
    const t = cron.decisionToken(vacId, d.id, 'approve');
    await http(`/vacation-decision/${encodeURIComponent(t)}`, form('approve'));
  }
  st = (await pool.query('SELECT status FROM office_vacations WHERE id=$1', [vacId])).rows[0].status;
  check('все «за» → период согласован', st === 'approved', 'status=' + st);

  const plan = (await pool.query(
    `SELECT status_code, kind FROM staff_plan WHERE staff_id=$1 AND date='2027-09-06'::date`, [empId])).rows;
  check('«отп» проставлен в график офиса', plan.length > 0 && plan[0].status_code === 'отп',
    JSON.stringify(plan));

  // ── 6. Повторное решение по согласованному — «уже решено» ──────────────
  r = await http(`/vacation-decision/${encodeURIComponent(yesTok)}`, form('approve'));
  check('повтор не меняет согласованный период', /Уже решено|Уже согласовано/.test(r.text), r.text.slice(0, 120));

  // ── 7. Сценарий отказа: новый период → «Нет» с причиной ────────────────
  r = await api('POST', '/api/vacations', { role: 'PM', body: { year: YEAR, date_from: '2027-10-11', date_to: '2027-10-15' } });
  check('второй период поставлен', r.status === 200, JSON.stringify(r.data).slice(0, 120));
  const vac2 = (r.data || {}).vacation && r.data.vacation.id;

  const noTok2 = cron.decisionToken(vac2, dirId, 'reject');
  r = await http(`/vacation-decision/${encodeURIComponent(noTok2)}`, form('reject', 'Сдача объекта — возьмите после 20 октября.'));
  check('«Нет» с причиной применено (200)', r.status === 200, 'status=' + r.status);

  const v2 = (await pool.query('SELECT status, reason FROM office_vacations WHERE id=$1', [vac2])).rows[0];
  check('период отклонён', v2.status === 'rejected', 'status=' + v2.status);
  check('причина сохранена', /Сдача объекта/.test(v2.reason || ''), v2.reason);

  const blocked = (await pool.query(
    'SELECT COUNT(*)::int AS n FROM office_vacation_blocked_days WHERE vacation_id=$1', [vac2])).rows[0].n;
  check('дни ушли в блокировку', blocked === 5, 'blocked=' + blocked);

  const plan2 = (await pool.query(
    `SELECT COUNT(*)::int AS n FROM staff_plan WHERE staff_id=$1 AND date BETWEEN '2027-10-11' AND '2027-10-15' AND status_code='отп'`,
    [empId])).rows[0].n;
  check('«отп» убран из графика офиса после отказа', plan2 === 0, 'rows=' + plan2);

  // ── 8. Повторная постановка снятых дней запрещена ──────────────────────
  r = await api('POST', '/api/vacations', { role: 'PM', body: { year: YEAR, date_from: '2027-10-11', date_to: '2027-10-15' } });
  check('снятые дни повторно не поставить', r.status === 400 && (r.data || {}).error === 'blocked',
    JSON.stringify(r.data).slice(0, 140));

  console.log('\n' + (fail ? `FAILS: ${fail}` : 'ALL PASS') + ` (${pass} проверок)`);
  await pool.end().catch(() => {});
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH: ' + e.message + '\n' + (e.stack || '')); process.exit(1); });
