'use strict';

/**
 * D-306b: регрессия оверлея карточки документа (FAIL D3/D4 верификатора).
 * ═══════════════════════════════════════════════════════════════════════════
 * Что проверяем — ровно те три сценария, на которых ломался фикс мерцания:
 *
 *   1. Первое открытие карточки  → оверлей ВКЛЮЧЁН (затемнение, клик по фону).
 *   2. Сохранение той же карточки → оверлей НЕ ПЕРЕКЛЮЧАЕТСЯ (нет мерцания).
 *      Перерисовка идёт через openDrawer, и если бы он каждый раз заново
 *      включал `opacity: 0 → 1`, экран «мутнел» — это жалоба Вики.
 *   3. Закрыл → открыл ТУ ЖЕ снова → оверлей ВКЛЮЧЁН. Именно здесь был FAIL:
 *      `!d.hidden` вычислялось ПОСЛЕ `d.hidden = false`, флаг вырождался в
 *      «та же строка», и карточка открывалась без затемнения и без закрытия
 *      кликом по фону.
 *
 * Тест статический (без браузера): читает doc-hub.js и проверяет порядок
 * операций. Это надёжнее скриншота — гоняется в CI и ловит именно регресс
 * порядка строк, а не «на глаз».
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'doc-hub.js'), 'utf8');

// Вырезаем тело openDrawer и closeDrawer, чтобы искать только в них.
function bodyOf(fnName) {
  const re = new RegExp(`function ${fnName}\\s*\\([^)]*\\)\\s*\\{`, 'm');
  const m = SRC.match(re);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < SRC.length && depth > 0) {
    const ch = SRC[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return SRC.slice(start, i - 1);
}

const openBody = bodyOf('openDrawer');
const closeBody = bodyOf('closeDrawer');

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  PASS', name); }
  catch (e) { fail++; console.log('  FAIL', name, '→', e.message); }
};

console.log('\n=== D-306b: оверлей карточки документа ===');

check('тела openDrawer и closeDrawer найдены', () => {
  assert.ok(openBody, 'openDrawer не найден');
  assert.ok(closeBody, 'closeDrawer не найден');
});

check('wasOpen снимается ДО того, как d.hidden получил false', () => {
  const iWas = openBody.indexOf('const wasOpen');
  const iHiddenFalse = openBody.indexOf('d.hidden = false');
  assert.ok(iWas >= 0, 'нет объявления wasOpen');
  assert.ok(iHiddenFalse >= 0, 'нет d.hidden = false');
  assert.ok(iWas < iHiddenFalse, `wasOpen (${iWas}) должен быть ДО d.hidden = false (${iHiddenFalse})`);
});

check('reopeningSame не использует мёртвое !d.hidden напрямую', () => {
  const line = (openBody.match(/const reopeningSame[^\n]*/) || [''])[0];
  assert.ok(line, 'нет объявления reopeningSame');
  assert.ok(!/!\s*d\.hidden/.test(line), 'reopeningSame всё ещё читает !d.hidden — условие мёртвое');
  assert.ok(/wasOpen/.test(line) && /sameDoc|dataset/.test(line), 'reopeningSame должен складывать wasOpen и «та же строка»');
});

check('reopeningSame требует И «было открыто», И «та же строка»', () => {
  const line = (openBody.match(/const reopeningSame[^\n]*/) || [''])[0];
  assert.ok(/wasOpen\s*&&/.test(line), 'нет условия wasOpen && … — флаг снова вырождается');
});

check('closeDrawer сбрасывает dataset.docId (состояния не протекают)', () => {
  assert.ok(/delete\s+d\.dataset\.docId/.test(closeBody), 'closeDrawer не сбрасывает docId — повторное открытие той же карточки останется без оверлея');
});

check('оверлей включается, когда reopeningSame === false', () => {
  assert.ok(/if\s*\(\s*ov\s*&&\s*!\s*reopeningSame\s*\)/.test(openBody), 'нет ветки включения оверлея по !reopeningSame');
  const branch = (openBody.match(/if\s*\(\s*ov\s*&&\s*!\s*reopeningSame\s*\)[^\n]*/) || [''])[0];
  assert.ok(/ov\.hidden\s*=\s*false/.test(branch), 'ветка не снимает hidden с оверлея');
  assert.ok(/classList\.add\('is-on'\)/.test(branch), 'ветка не включает is-on (нет затемнения)');
});

check('closeDrawer гасит оверлей (hidden + без is-on)', () => {
  assert.ok(/ov\.hidden\s*=\s*true/.test(closeBody), 'оверлей не скрывается');
  assert.ok(/classList\.remove\('is-on'\)/.test(closeBody), 'is-on не снимается');
});

check('saveDrawer восстанавливает scrollTop карточки', () => {
  assert.ok(/keepBody/.test(SRC), 'нет сохранения scrollTop тела карточки');
  assert.ok(/bodyAfter\.scrollTop\s*=\s*keepBody/.test(SRC), 'scrollTop не восстанавливается после перерисовки');
});

// Симуляция порядка: проверяем, что при «было закрыто» флаг false,
// а при «было открыто и та же строка» — true.
function simulate(wasHidden, wasOn, datasetId, openId) {
  const d = { hidden: wasHidden, classList: { contains: (c) => (c === 'is-on' ? wasOn : false) }, dataset: { docId: datasetId } };
  const wasOpen = !d.hidden && d.classList.contains('is-on');
  const sameDoc = String(d.dataset.docId || '') === String(openId);
  const reopeningSame = wasOpen && sameDoc;
  d.dataset.docId = String(openId);
  d.hidden = false;
  return reopeningSame;
}

check('сценарий 1: первое открытие → оверлей включается (reopeningSame=false)', () => {
  assert.strictEqual(simulate(true, false, undefined, 641), false);
});

check('сценарий 2: сохранение той же карточки → оверлей не трогаем (reopeningSame=true)', () => {
  assert.strictEqual(simulate(false, true, '641', 641), true);
});

check('сценарий 3: закрыл → открыл ту же снова → оверлей включается (reopeningSame=false)', () => {
  // после closeDrawer: hidden=true, is-on снят, docId удалён
  assert.strictEqual(simulate(true, false, undefined, 641), false);
});

check('сценарий 4: открыта одна, открываем другую → оверлей включается', () => {
  assert.strictEqual(simulate(false, true, '641', 642), false);
});

console.log(`\nИТОГ: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
