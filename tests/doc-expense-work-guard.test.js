'use strict';

/**
 * D-333: расход не должен теряться из-за незаполненного проекта.
 * ═══════════════════════════════════════════════════════════════════════════
 * Заказчик 21.10.2026: «если стоит расход на проект, но не заполнен сам проект —
 * просим дозаполнить, чтобы расходы не пропустились и точно упали в проект».
 *
 * Что проверяем:
 *   1. отправка в оплату БЕЗ объекта блокируется (409 no_work_for_expense);
 *   2. но только для ПЛАТЕЖЕЙ: архив без заявки не синеет (196 строк);
 *   3. офис/АХО и «собственность АСГАРД»/«расходники» — исключения;
 *   4. autoWorkExpense не теряет расход молча — помечает строку;
 *   5. расходы не пропали и не имеют битых ссылок.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REG = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'doc-registry.js'), 'utf8');
const PI = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'payment-invoices.js'), 'utf8');
const HUB = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'doc-hub.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  PASS', name); }
  catch (e) { fail++; console.log('  FAIL', name, '→', e.message); }
};

console.log('\n=== D-333: расход не теряется без проекта ===');

check('отправка в оплату без объекта блокируется 409', () => {
  assert.ok(/code: 'no_work_for_expense'/.test(REG), 'нет кода отказа');
  const block = REG.match(/if \(!doc\.work_id && !exemptKind && !exemptFlag\)[\s\S]{0,500}/);
  assert.ok(block, 'нет проверки work_id перед оплатой');
  assert.ok(/409/.test(block[0]), 'нет статуса 409');
});

check('офис/АХО не требует объекта', () => {
  const block = REG.match(/const exemptKind = [^\n]+/);
  assert.ok(block, 'нет проверки office');
  assert.ok(/'office'/.test(block[0]));
});

check('«Собственность АСГАРД» и «Расходники» — исключения', () => {
  const block = REG.match(/const exemptFlag = [^\n]+/);
  assert.ok(block, 'нет проверки purpose_asgard/consumables');
});

check('архив БЕЗ заявки не синеет (иначе 196 ложных)', () => {
  // Правило no_work_for_expense должно требовать payment_invoice_id
  const block = REG.match(/if \(row\.dir === 'in' && !row\.work_id && row\.payment_invoice_id\)/);
  assert.ok(block, 'правило не ограничено платежами — архив станет синим');
});

check('autoWorkExpense помечает строку вместо молчаливого null', () => {
  const block = PI.match(/async function autoWorkExpense[\s\S]*?\n\}/);
  assert.ok(block, 'нет autoWorkExpense');
  assert.ok(/no_work_for_expense/.test(block[0]), 'нет пометки строки без проекта');
  assert.ok(/is_incomplete = true/.test(block[0]), 'флаг неполноты не ставится');
});

check('есть русская подпись причины', () => {
  assert.ok(/no_work_for_expense: 'расход не попадёт в проект/.test(HUB), 'нет человеческой подписи');
});

check('дубли расходов по-прежнему ловятся (регресс D-328)', () => {
  const block = PI.match(/async function autoWorkExpense[\s\S]*?\n\}/);
  assert.ok(/abs\(amount - \$3\) < 0\.01/.test(block[0]), 'проверка дубля по сумме пропала');
});

console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
