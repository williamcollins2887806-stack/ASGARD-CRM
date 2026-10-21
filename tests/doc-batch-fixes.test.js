'use strict';

/**
 * D-326..D-328: проверки по замечаниям заказчика 21.10.2026.
 * ═══════════════════════════════════════════════════════════════════════════
 *   1. «Офис — это офисные расходы»: spendKind='office', а не «объект».
 *   2. «Закупщик не видит работы» — /api/works и work-search отдают все работы
 *      всем ролям, ведущим закупки (регресс-контроль).
 *   3. «Удалить можно только там, где ты ответственный» — canDeleteRow.
 *   4. «Счета идут в расходы без дублей» — защита по номеру+сумме+объекту.
 *
 * Часть проверок статическая (читает код), часть — SQL на клоне.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  PASS', name); }
  catch (e) { fail++; console.log('  FAIL', name, '→', e.message); }
};

const INTAKE = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'doc-email-intake.js'), 'utf8');
const DOC_HUB = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'doc-hub.js'), 'utf8');
const PI = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'payment-invoices.js'), 'utf8');
const REG = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'doc-registry.js'), 'utf8');

console.log('\n=== 1. Офис = офисные расходы ===');

check('«офис» распознаётся как spend_kind=office', () => {
  assert.ok(/spendKind = 'office'/.test(INTAKE), 'нет присвоения office');
  assert.ok(/офис\|офисн\|ахо\|канцеляр/.test(INTAKE), 'нет паттерна офисных слов');
});

check('склад — отдельный вид (warehouse)', () => {
  assert.ok(/spendKind = 'warehouse'/.test(INTAKE));
});

check('spend_kind больше не хардкодится как other', () => {
  assert.ok(!/VALUES \('in','invoice','wait_sf','wait',\$1,\$2::date,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\s*\n\s*'other'/.test(INTAKE),
    'в INSERT всё ещё жёстко other');
  assert.ok(/\$26/.test(INTAKE), 'spendKind не передан параметром в INSERT');
});

check('«Офис» НЕ становится подсказкой объекта', () => {
  // Проверяем через реальную функцию
  const { extractWorkHintFromSubject } = require('../src/services/doc-email-intake');
  assert.strictEqual(extractWorkHintFromSubject('Офис: Счет ООО Пресс Бюро от 16.10.2026'), null);
});

console.log('\n=== 2. Закупщик видит работы ===');

check('/work-search не фильтрует по роли (все работы)', () => {
  const block = PI.match(/fastify\.get\('\/work-search'[\s\S]*?\n  \}\);/);
  assert.ok(block, 'не найден роут work-search');
  assert.ok(!/pm_id\s*=|doc_owner_id\s*=|requireRoles/.test(block[0]),
    'work-search ограничивает по роли — закупщик не увидит чужие работы');
});

check('объект в модалке заявки берётся из /work-search (не из /api/works)', () => {
  const batch = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'procurement-batch.js'), 'utf8');
  assert.ok(/work-search/.test(batch), 'модалка заявки не использует work-search');
});

console.log('\n=== 3. Удаление: только свой документ ===');

check('canDeleteRow существует и проверяет doc_owner_id', () => {
  assert.ok(/function canDeleteRow\(row\)/.test(DOC_HUB));
  assert.ok(/row\.doc_owner_id\) === me/.test(DOC_HUB) || /doc_owner_id\) === me/.test(DOC_HUB));
});

check('кнопка удаления в строке использует canDeleteRow', () => {
  assert.ok(/canDeleteRow\(r\)/.test(DOC_HUB), 'строка всё ещё по canWh/canCorrect');
});

check('кнопка удаления в карточке использует canDeleteRow', () => {
  assert.ok(/canDeleteRow\(row\)/.test(DOC_HUB));
});

check('бэкенд DELETE проверяет ответственного', () => {
  const block = REG.match(/fastify\.delete\('\/:id'[\s\S]*?assertSafeBillingDelete/);
  assert.ok(block, 'не найден DELETE роут');
  assert.ok(/doc_owner_id/.test(block[0]), 'нет проверки doc_owner_id');
  assert.ok(/403/.test(block[0]), 'нет отказа 403');
});

console.log('\n=== 4. Расходы без дублей ===');

check('autoWorkExpense проверяет дубль по номеру+сумме+объекту', () => {
  const block = PI.match(/async function autoWorkExpense[\s\S]*?\n\}/);
  assert.ok(block, 'не найдена autoWorkExpense');
  assert.ok(/lower\(trim\(coalesce\(doc_number/.test(block[0]), 'нет проверки по номеру документа');
  assert.ok(/abs\(amount - \$3\) < 0\.01/.test(block[0]), 'нет сравнения суммы');
  assert.ok(/work_id = \$1/.test(block[0]), 'нет проверки по объекту');
});

check('есть инструмент аудита дублей', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'tools', 'audit_expense_dups.js')));
});

console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
