'use strict';
/**
 * D-293 (аудит 20.10.2026): три дефекта, найденные при разборе «срок оплаты»
 * и мониторинге почты с 19.10 20:00.
 * ═══════════════════════════════════════════════════════════════════════════
 * 1) СРОК ОПЛАТЫ ВЫДУМАН, НО ПОКАЗАН КАК НАСТОЯЩИЙ.
 *    doc-email-intake брал invoice_date + 10 дней, когда счёт срока не печатал,
 *    и писал это в payment_invoices.due_date без пометки. Миграция V413 сделала
 *    то же массово. Проверка на проде: у 4 из 6 заявок дельта ровно 10 дней,
 *    а в doc_email_intake.parse_raw поле payment_due_at пустое — то есть в
 *    бумаге срока не было.
 *    Последствие: светофор (src/lib/doc-traffic.js) и напоминания
 *    (src/services/reminder-cron.js) считают по выдуманному сроку — ложные
 *    просрочки и письма «оплата истекает».
 *
 * 2) ДОГОВОР ПРИВЯЗЫВАЛСЯ К ЧУЖОМУ КОНТРАГЕНТУ.
 *    matchContract искал по номеру и при совпадении номера возвращал договор
 *    ДРУГОГО юрлица. Прод: счёт ЭТК (ИНН 3015042714) → договор 56201
 *    ООО «ТМХ-ЭЛЕКТРОТЕХ» (ИНН 7704469592), зелёный флаг «договор найден».
 *
 * 3) ЗАЯВКА НА ОПЛАТУ СОЗДАВАЛАСЬ МОЛЧА.
 *    Intake не звал ни sendDirectorMail, ни createNotification. Заявка #6
 *    провисела awaiting_dir с 09:31 без единого уведомления.
 *
 * Плюс требование заказчика: TTL согласования 72ч → 7 дней (168ч).
 */

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const INTAKE = fs.readFileSync(path.join(__dirname, '../src/services/doc-email-intake.js'), 'utf8');
const MATCH = fs.readFileSync(path.join(__dirname, '../src/services/contract-match.js'), 'utf8');
const TTL = fs.readFileSync(path.join(__dirname, '../src/services/doc-approval-ttl.js'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────
console.log('── 5. Договор: проверка контрагента обязательна ──');
{
  check('matchContract возвращает conflict при чужом ИНН', /reason: 'number_taken_by_other_counterparty'/.test(MATCH));
  check('сравнивает customer_inn договора с ИНН счёта', /contractInn !== inn/.test(MATCH));
  check('есть поле conflict с обоими ИНН', /wanted_inn: inn, contract_inn: contractInn/.test(MATCH));
  check('found:false, а не «зелёный» при расхождении', /return \{\s*found: false,\s*reason: 'number_taken_by_other_counterparty'/.test(MATCH.replace(/\n/g, ' ')) || /found: false[\s\S]{0,80}number_taken_by_other_counterparty/.test(MATCH));
  check('SELECT тянет customer_inn', /customer_inn, start_date, end_date, status, work_id/.test(MATCH));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 6. Директор получает уведомление о новой заявке ──');
{
  check('intake зовёт sendDirectorMail', /paymentMail\.sendDirectorMail\(db, paymentId\)/.test(INTAKE));
  check('intake создаёт запись в notifications', /createNotification\(db, \{[\s\S]{0,300}Счёт #\$\{paymentId\} к согласованию/.test(INTAKE));
  check('уведомление всем директорам', /role IN \('DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV'\)/.test(INTAKE));
  check('падение почты не ломает intake', /sendDirectorMail failed/.test(INTAKE));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 7. TTL согласования = 7 дней (168 ч) ──');
{
  check('DEFAULT_TTL_HOURS = 168', /const DEFAULT_TTL_HOURS = 168/.test(TTL));
  check('старое значение 72 убрано из дефолта', !/const DEFAULT_TTL_HOURS = 72;/.test(TTL));
  check('комментарий объясняет причину', /7 дней|168/.test(TTL));
  check('настройка читается из settings (не хардкод)', /doc_approval_ttl_hours/.test(TTL));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 8. Срок: формула +10 всё ещё есть, но помечена ──');
{
  // Формула не убрана (заказчик решит отдельно), но маркер должен существовать.
  check('в intake есть вычисление срока от даты счёта', /dueDerived/.test(INTAKE));
  check('есть комментарий про ОЦЕНКУ', /ОЦЕНКА|оцениваем/i.test(INTAKE));
}

console.log('\n────────────────────────────────────────');
console.log(`ИТОГ D-293: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('FAIL:', fails.join(' | ')); process.exit(1); }
