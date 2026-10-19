'use strict';
/**
 * Проверка напоминаний и автоснятия отпусков на КЛОНЕ (asgard_crm_test).
 * Ничего не пишет в прод. Почта глушится mail-killswitch.
 * Инвариант проверяем ПО ЗАПИСЯМ В БД (office_vacation_reminders / blocked_days /
 * audit / status), а не по факту доставки письма.
 *
 * Запуск: node tests/api/vacation-cron.test.js
 */
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_USER = process.env.DB_USER || 'asgard';
process.env.DB_NAME = 'asgard_crm_test';           // КЛОН
process.env.PGDATABASE = 'asgard_crm_test';
if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = '123456789';
process.env.SMTP_DISABLED = '1';
process.env.MAIL_DISABLED = '1';
delete process.env.MAIL_ALLOW_TO;

try { require(path.join(ROOT, 'src', 'lib', 'mail-killswitch')).install(); } catch (_) {}

const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));
const svc = require(path.join(ROOT, 'src', 'services', 'vacation-reminders-cron'));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; failures.push(name); console.log('FAIL ' + name + (extra != null ? ' :: ' + extra : '')); }
}

function ymdAdd(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

const pool = new Pool({
  host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT, 10),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: 'asgard_crm_test', max: 5,
});
const db = { query: (text, params) => pool.query(text, params), pool };

const tag = crypto.randomBytes(4).toString('hex');
let staffId = null, vacId = null;
const NOTICE = 15, CAL_DAYS = 6;

async function cleanup() {
  try {
    if (vacId) {
      await db.query('DELETE FROM office_vacation_audit WHERE vacation_id = $1', [vacId]);
      await db.query('DELETE FROM office_vacation_blocked_days WHERE vacation_id = $1', [vacId]);
      await db.query('DELETE FROM office_vacation_reminders WHERE vacation_id = $1', [vacId]);
      await db.query('DELETE FROM office_vacations WHERE id = $1', [vacId]);
    }
    if (staffId) await db.query('DELETE FROM staff WHERE id = $1', [staffId]);
  } catch (e) { console.error('[verify] cleanup: ' + e.message); }
}

async function reminderStats() {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n, COALESCE(MAX(seq),0)::int AS max_seq
       FROM office_vacation_reminders WHERE vacation_id = $1`, [vacId]);
  return rows[0];
}
async function vacStatus() {
  const { rows } = await db.query('SELECT status FROM office_vacations WHERE id = $1', [vacId]);
  return rows[0] ? rows[0].status : null;
}

async function main() {
  const t = await db.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_schema='public' AND table_name LIKE 'office_vacation%'`);
  if (t.rows[0].n < 7) throw new Error(`нет таблиц V411 (найдено ${t.rows[0].n}/7)`);
  console.log(`[verify] клон ${pool.options.database}: таблиц V411 = ${t.rows[0].n}`);

  const dirs = await db.query(
    `SELECT COUNT(*)::int AS n FROM users
      WHERE role = ANY($1::text[]) AND COALESCE(is_active,true) AND email IS NOT NULL AND TRIM(email) <> ''`,
    [svc.DIRECTOR_ROLES]);
  check('есть директор-адресат', dirs.rows[0].n >= 1, 'n=' + dirs.rows[0].n);

  const T = '2031-06-10';
  const from = ymdAdd(T, NOTICE), to = ymdAdd(T, NOTICE + CAL_DAYS - 1);
  const year = Number(from.slice(0, 4));

  const st = await db.query(
    `INSERT INTO staff (name, position, department, is_active, created_at, updated_at)
     VALUES ($1,$2,$3,true,NOW(),NOW()) RETURNING id`,
    [`ТЕСТ Отпускной ${tag}`, 'Тестировщик', 'QA']);
  staffId = st.rows[0].id;

  const vv = await db.query(
    `INSERT INTO office_vacations
       (employee_id, user_id, date_from, date_to, days, cal_days, holidays_count, kind, year, status, submitted_at, created_at, updated_at)
     VALUES ($1, NULL, $2, $3, $4, $4, 0, 'extra', $5, 'pending', NOW(), NOW(), NOW()) RETURNING id`,
    [staffId, from, to, CAL_DAYS, year]);
  vacId = vv.rows[0].id;

  const run1 = await svc.processVacations(db, console, { today: T });
  let s = await reminderStats();
  check('прогон 1: 1 письмо (seq=1)', s.n === 1 && s.max_seq === 1, JSON.stringify(s));
  check('прогон 1: кандидат найден', run1.candidates === 1, JSON.stringify(run1));

  const run2 = await svc.processVacations(db, console, { today: ymdAdd(T, 1) });
  s = await reminderStats();
  check('прогон 2: 2 письма (seq=2)', s.n === 2 && s.max_seq === 2, JSON.stringify({ s, run2 }));

  const run3 = await svc.processVacations(db, console, { today: ymdAdd(T, 2) });
  s = await reminderStats();
  check('прогон 3: 3 письма (seq=3)', s.n === 3 && s.max_seq === 3, JSON.stringify({ s, run3 }));
  check('прогон 3: ещё не снят', (await vacStatus()) === 'pending');

  const run3b = await svc.processVacations(db, console, { today: ymdAdd(T, 2) });
  s = await reminderStats();
  check('антидубль: повтор в тот же день не добавил письмо', s.n === 3 && s.max_seq === 3, JSON.stringify({ s, run3b }));
  check('антидубль: период не снят раньше срока', (await vacStatus()) === 'pending',
    'status=' + (await vacStatus()));

  const run4 = await svc.processVacations(db, console, { today: ymdAdd(T, 3) });
  check('прогон 4: автоснятие', (await vacStatus()) === 'cancelled', 'status=' + (await vacStatus()));

  const bl = await db.query('SELECT COUNT(*)::int AS n FROM office_vacation_blocked_days WHERE vacation_id = $1', [vacId]);
  check(`прогон 4: все ${CAL_DAYS} дней заблокированы`, bl.rows[0].n === CAL_DAYS, 'n=' + bl.rows[0].n);
  check('прогон 4: блокировка по сотруднику', (await db.query(
    'SELECT COUNT(*)::int AS n FROM office_vacation_blocked_days WHERE employee_id = $1', [staffId])).rows[0].n === CAL_DAYS);

  const stamp = await db.query('SELECT COUNT(*)::int AS n FROM office_vacation_reminders WHERE vacation_id=$1 AND auto_cancelled_at IS NOT NULL', [vacId]);
  check('прогон 4: auto_cancelled_at проставлен', stamp.rows[0].n >= 1, 'n=' + stamp.rows[0].n);

  const aud = await db.query("SELECT COUNT(*)::int AS n FROM office_vacation_audit WHERE vacation_id=$1 AND action='autocancel'", [vacId]);
  check('прогон 4: запись audit autocancel', aud.rows[0].n === 1, 'n=' + aud.rows[0].n);
  check('прогон 4: сводка сообщила об автоснятии', run4.cancelled === 1, JSON.stringify(run4));

  const blockedBefore = bl.rows[0].n;
  await svc.processVacations(db, console, { today: ymdAdd(T, 4) });
  const bl2 = await db.query('SELECT COUNT(*)::int AS n FROM office_vacation_blocked_days WHERE vacation_id=$1', [vacId]);
  const aud2 = await db.query("SELECT COUNT(*)::int AS n FROM office_vacation_audit WHERE vacation_id=$1 AND action='autocancel'", [vacId]);
  check('идемпотентность: повтор не добавил дней', bl2.rows[0].n === blockedBefore, 'n=' + bl2.rows[0].n);
  check('идемпотентность: audit не продублирован', aud2.rows[0].n === 1, 'n=' + aud2.rows[0].n);

  const tk = svc.decisionToken(vacId, 3455, 'approve');
  const vTok = svc.verifyDecisionToken(tk);
  check('токен: валиден', vTok.ok && vTok.vacationId === vacId && vTok.directorUserId === 3455 && vTok.decision === 'approve', JSON.stringify(vTok));
  check('токен: подделка отбивается', svc.verifyDecisionToken(tk.slice(0, -2) + 'xx').ok === false);
}

(async () => {
  try { await main(); }
  catch (e) { fail++; failures.push('exception: ' + e.message); console.error('[verify] ИСКЛЮЧЕНИЕ: ' + (e.stack || e.message)); }
  finally {
    await cleanup();
    await pool.end().catch(() => {});
    try { await require(path.join(ROOT, 'src', 'services', 'db')).end(); } catch (_) {}
    console.log(`\n[verify] ИТОГ: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
    if (fail) { console.log('[verify] FAIL: ' + failures.join('; ')); process.exitCode = 1; }
    setTimeout(() => process.exit(fail ? 1 : 0), 200);
  }
})();
