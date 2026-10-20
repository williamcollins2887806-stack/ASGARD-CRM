'use strict';
/**
 * D-299 (заказчик 20.10.2026): «И как быть? правильно нужно сделать!!!»
 * ═══════════════════════════════════════════════════════════════════════════
 * Два случая ошибочной привязки договора. Оба — один класс дефекта:
 * matchContract искал по НОМЕРУ и не сверял контрагента.
 *
 * СЛУЧАЙ 1: договор 56201 принадлежит ООО «ТМХ-ЭЛЕКТРОТЕХ» (ИНН 7704469592),
 *   но к нему привязался счёт ЭТК (ИНН 3015042714). У ЭТК в CRM договора нет
 *   вовсе (0 записей по её ИНН) — номер 56201 в её счёте означает ИХ договор.
 *   Правильно: отвязать, режим 'once' («договор из счёта, в CRM не заведён»).
 *
 * СЛУЧАЙ 2: счёт А-2060 от «ООО Учебный Комбинат Магистр» к договору
 *   №25-16/2 (УК «МАГИСТР»). Доказательство тождества:
 *     • email контрагента в счёте — general@ukmagistr.ru;
 *     • в suppliers этот адрес у id=33 ООО «УК «МАГИСТР» (ИНН 9728132048);
 *     • все 25 документов договора — этого контрагента.
 *   Правильно: привязать. Это НЕ «чужой договор», а торговое имя того же юрлица.
 */

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const MATCH = fs.readFileSync(path.join(__dirname, '../src/services/contract-match.js'), 'utf8');
const MIG = fs.readFileSync(path.join(__dirname, '../migrations/V424__fix_wrong_contract_links.sql'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────
console.log('── 1. matchContract проверяет контрагента, а не только номер ──');
{
  check('есть проверка расхождения ИНН', /contractInn \!== inn/.test(MATCH));
  check('возвращает found:false при чужом ИНН', /number_taken_by_other_counterparty/.test(MATCH));
  check('не ставит linked на чужой договор', /found: false/.test(MATCH));
  check('в conflict есть оба ИНН для разбора', /wanted_inn: inn, contract_inn: contractInn/.test(MATCH));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 2. Миграция исправляет оба случая точечно ──');
{
  check('отвязывает #1523 от договора 26', /id = 1523[\s\S]{0,120}contract_id = 26/.test(MIG) || /contract_id = 26[\s\S]{0,200}id = 1523/.test(MIG));
  check('проверяет ИНН документа перед отвязкой', /3015042714/.test(MIG));
  check('ставит режим once (договор не в CRM)', /contract_mode = 'once'/.test(MIG));
  check('привязывает #1532 к договору 21', /contract_id = 21[\s\S]{0,200}id = 1532/.test(MIG) || /id = 1532[\s\S]{0,200}contract_id = 21/.test(MIG));
  check('ставит режим linked для проверенного случая', /contract_mode = 'linked'/.test(MIG));
  check('идемпотентно (условия по текущему состоянию)', /AND contract_id IS NULL/.test(MIG));
  check('не удаляет данные', !/DELETE\s+FROM/i.test(MIG));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 3. Документировано, почему А-2060 = УК МАГИСТР ──');
{
  check('в миграции указан email-домен как доказательство', /ukmagistr\.ru/.test(MIG));
  check('указан ИНН УК МАГИСТР', /9728132048/.test(MIG));
  check('объяснено, что это торговое имя, а не другой контрагент', /торговое|брендовое имя/i.test(MIG));
}

console.log('\n────────────────────────────────────────');
console.log(`ИТОГ D-299: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('FAIL:', fails.join(' | ')); process.exit(1); }
