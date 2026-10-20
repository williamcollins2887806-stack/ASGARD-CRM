'use strict';

/**
 * D-317: эскалация согласования — 12ч → 24ч → каждые 24ч, тихое окно 07–22 МСК.
 * ═══════════════════════════════════════════════════════════════════════════
 * Требование заказчика: «сразу как пришла заявка, далее через 12 часов если нет
 * движения, но не позднее 22:00 и не раньше 7:00, далее через 24 часа и далее
 * каждые 24 часа».
 *
 * Оффлайн-часть (без БД): окно, интервалы, тексты, идемпотентность шага.
 * Рантайм-часть (с БД): реальное расписание, отправка, снятие после решения,
 * отсутствие дублей при повторном проходе.
 */

const esc = require('../src/services/approval-escalation');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS', m); };
const bad = (m) => { fail++; console.log('  FAIL', m); };

console.log('\n=== D-317: тайминги (оффлайн) ===');

// Интервалы: первое напоминание через 12 ч, дальше 24 ч.
if (esc.FIRST_DELAY_H === 12) ok('первое напоминание — через 12 ч');
else bad('FIRST_DELAY_H = ' + esc.FIRST_DELAY_H);
if (esc.nextDelayHours(0) === 12) ok('nextDelayHours(0) = 12');
else bad('nextDelayHours(0) = ' + esc.nextDelayHours(0));
if (esc.nextDelayHours(1) === 24 && esc.nextDelayHours(5) === 24) ok('после первого — каждые 24 ч');
else bad('nextDelayHours(1/5) не 24');

// Тихое окно: 07:00–22:00 МСК. Собираем UTC-даты, соответствующие МСК.
function mskDate(hourMsk, dayOffset) {
  // МСК = UTC+3 → UTC = МСК − 3.
  const base = Date.UTC(2026, 9, 20, 12, 0, 0); // 20.10.2026 12:00 UTC = 15:00 МСК
  return new Date(base + ((hourMsk - 15) * 3600000) + ((dayOffset || 0) * 86400000));
}

const cases = [
  [7, true, '07:00 — можно'],
  [9, true, '09:00 — можно'],
  [21, true, '21:00 — можно'],
  [22, false, '22:00 — уже тихо'],
  [23, false, '23:00 — тихо'],
  [0, false, '00:00 — тихо'],
  [3, false, '03:00 — тихо'],
  [6, false, '06:00 — тихо'],
];
for (const [h, expect, label] of cases) {
  const got = esc.inSendWindow(mskDate(h));
  if (got === expect) ok(`окно: ${label}`);
  else bad(`окно: ${label} → получено ${got}, ожидалось ${expect}`);
}

if (esc.QUIET_FROM === 7 && esc.QUIET_TO === 22) ok('границы окна 7 и 22');
else bad(`границы окна ${esc.QUIET_FROM}–${esc.QUIET_TO}`);

// Тексты: эскалация заметна и без вранья про число дней.
const t1 = esc.reminderText({ supplier_name: 'ООО Ромашка', amount: 1234.5 }, 1, 12);
if (/Ромашка/.test(t1.body) && /12 ч/.test(t1.body)) ok('шаг 1: в тексте поставщик и 12 ч');
else bad('шаг 1 текст: ' + JSON.stringify(t1));
const t2 = esc.reminderText({ supplier_name: 'ООО Ромашка', amount: 1000 }, 2, 36);
if (/сутки/.test(t2.title)) ok('шаг 2: «сутки» в заголовке');
else bad('шаг 2 title: ' + t2.title);
const t3 = esc.reminderText({ supplier_name: 'X', amount: 1 }, 3, 60);
if (/дн/.test(t3.title) && t3.urgent === true) ok('шаг 3+: дни в заголовке, urgent=true');
else bad('шаг 3 title: ' + JSON.stringify(t3));

// МСК считается верно: 19:30 UTC 20.10 = 22:30 МСК → тихо.
const late = new Date(Date.UTC(2026, 9, 20, 19, 30));
if (esc.mskNow(late).hour === 22 && esc.inSendWindow(late) === false) ok('22:30 МСК (19:30 UTC) — тихо');
else bad('МСК-сдвиг: ' + JSON.stringify(esc.mskNow(late)));

// ── Рантайм с БД ──
(async () => {
  let db;
  try { db = require('pg'); } catch (_) { db = null; }
  if (!db) { console.log('\n(БД недоступна — рантайм пропущен)'); return finish(); }

  const { Client } = db;
  const c = new Client({ host: '127.0.0.1', port: 5432, database: 'asgard_crm_test', user: 'asgard', password: '123456789' });
  try { await c.connect(); } catch (e) {
    console.log('\n(клон недоступен: ' + e.message + ' — рантайм пропущен)');
    return finish();
  }

  console.log('\n=== D-317: рантайм на клоне ===');
  const hasT = await c.query(`SELECT 1 FROM information_schema.tables WHERE table_name='approval_escalation'`);
  if (!hasT.rows.length) { console.log('НЕТ таблицы approval_escalation — примените V432'); await c.end(); return finish(); }
  ok('таблица approval_escalation есть');

  // Чистим следы прошлых прогонов.
  await c.query(`DELETE FROM payment_invoices WHERE supplier_name LIKE 'ESC-TEST%'`);

  const author = (await c.query(`SELECT id FROM users WHERE role='PROC' AND is_active=true LIMIT 1`)).rows[0];
  const ins = await c.query(
    `INSERT INTO payment_invoices(status, supplier_name, amount, created_by, submitted_at, basis_type)
     VALUES('awaiting_dir','ESC-TEST 1', 500, $1, NOW() - INTERVAL '13 hours', 'other') RETURNING id`, [author.id]);
  const id1 = ins.rows[0].id;

  // Расписание «в прошлом» ОТНОСИТЕЛЬНО опорного времени (noon), иначе проход
  // ничего не найдёт: next_at должен быть раньше момента проверки.
  const noon = mskDate(12);
  await esc.scheduleForInvoice(c, id1, { firstAt: new Date(noon.getTime() - 3600000) });
  const sched = (await c.query('SELECT * FROM approval_escalation WHERE payment_invoice_id=$1', [id1])).rows[0];
  if (sched && sched.step === 0) ok('расписание создано со step=0 (первое напоминание впереди)');
  else bad('расписание не создано: ' + JSON.stringify(sched));

  // Идемпотентность: повторный вызов не дублирует строку.
  await esc.scheduleForInvoice(c, id1, { firstAt: new Date(noon.getTime() + 3600000) });
  const cnt = (await c.query('SELECT count(*)::int n FROM approval_escalation WHERE payment_invoice_id=$1', [id1])).rows[0].n;
  if (cnt === 1) ok('повторное планирование не создаёт дубль');
  else bad('дублей расписания: ' + cnt);

  const notifBefore = (await c.query(
    `SELECT count(*)::int n FROM notifications WHERE user_id IN
       (SELECT id FROM users WHERE role IN ('DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'))`)).rows[0].n;

  // Проход в «дневное» время: берём 12:00 МСК.
  const r1 = await esc.runOnce(c, null, noon);
  if (r1.sent >= 1) ok(`проход в 12:00 МСК отправил напоминание (sent=${r1.sent})`);
  else bad('напоминание не отправлено: ' + JSON.stringify(r1));

  const notifAfter = (await c.query(
    `SELECT count(*)::int n FROM notifications WHERE user_id IN
       (SELECT id FROM users WHERE role IN ('DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'))`)).rows[0].n;
  if (notifAfter > notifBefore) ok(`директора получили ${notifAfter - notifBefore} уведомлений (push уходит из createNotification)`);
  else bad('уведомления не созданы');

  const afterStep = (await c.query('SELECT step, next_at FROM approval_escalation WHERE payment_invoice_id=$1', [id1])).rows[0];
  if (afterStep.step === 1) ok('step увеличен до 1');
  else bad('step после отправки: ' + afterStep.step);
  const hrs = (new Date(afterStep.next_at).getTime() - Date.now()) / 3600000;
  if (hrs > 23 && hrs < 25) ok(`следующее напоминание через ~24 ч (${hrs.toFixed(1)})`);
  else bad('интервал следующего: ' + hrs.toFixed(1) + ' ч');

  // Повторный проход сразу же — НЕ должен слать второй раз.
  const r2 = await esc.runOnce(c, null, noon);
  if (r2.sent === 0) ok('повторный проход не задваивает напоминание');
  else bad('повторный проход отправил ещё ' + r2.sent);

  // Ночью слать нельзя. Ставим срок «в прошлое» относительно 23:00 того же дня,
  // чтобы проход реально увидел due-заявку (а не пустую выборку).
  const night = mskDate(23);
  await c.query(`UPDATE approval_escalation SET next_at=$2 WHERE payment_invoice_id=$1`,
    [id1, new Date(night.getTime() - 3600000)]);
  const r3 = await esc.runOnce(c, null, night);
  if (r3.sent === 0 && r3.skippedQuiet >= 1) ok('в 23:00 МСК напоминание отложено (тихое окно)');
  else bad('ночью отправило: ' + JSON.stringify(r3));

  // В 07:00 следующего дня — уходит (срок уже наступил, окно открылось).
  const morning = mskDate(7, 1);
  const r4 = await esc.runOnce(c, null, morning);
  if (r4.sent >= 1) ok('в 07:00 МСК отложенное напоминание уходит');
  else bad('в 07:00 не отправило: ' + JSON.stringify(r4));

  // Решение директора снимает расписание.
  await esc.clearForInvoice(c, id1);
  const gone = (await c.query('SELECT count(*)::int n FROM approval_escalation WHERE payment_invoice_id=$1', [id1])).rows[0].n;
  if (gone === 0) ok('после решения расписание снято');
  else bad('расписание осталось после решения');

  // Заявка вне awaiting_dir не напоминается.
  const ins2 = await c.query(
    `INSERT INTO payment_invoices(status, supplier_name, amount, created_by, submitted_at, basis_type)
     VALUES('pending_payment','ESC-TEST 2', 700, $1, NOW() - INTERVAL '40 hours', 'other') RETURNING id`, [author.id]);
  await esc.scheduleForInvoice(c, ins2.rows[0].id, { firstAt: new Date(Date.now() - 60000) });
  const r5 = await esc.runOnce(c, null, noon);
  const stillThere = (await c.query('SELECT step FROM approval_escalation WHERE payment_invoice_id=$1', [ins2.rows[0].id])).rows[0];
  if (r5.sent === 0 && stillThere.step === 0) ok('согласованная заявка (pending_payment) не напоминается');
  else bad('напомнило по уже согласованной заявке');

  await c.query(`DELETE FROM payment_invoices WHERE supplier_name LIKE 'ESC-TEST%'`);
  await c.end();
  finish();
})().catch((e) => { console.error('ERR', e.message); finish(); });

function finish() {
  console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}
