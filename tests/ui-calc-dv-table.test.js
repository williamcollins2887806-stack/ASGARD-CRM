#!/usr/bin/env node
'use strict';
/**
 * UI-проверка вкладки «Объёмы» в просчёте: таблица, а не карточки.
 *
 * Что доказывает:
 *   • позиции рендерятся строками таблицы (rp-dv-row), карточек нет;
 *   • есть шапка колонок, и число колонок в шапке совпадает со строкой;
 *   • правка на месте: у каждой строки есть data-dv-field для имени, объёма,
 *     единицы, отложений и периода;
 *   • нет второй нативной кнопки выбора файла (input[type=file] с hidden);
 *   • нет undefined/null в разметке.
 *
 * Запуск: node tests/ui-calc-dv-table.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const MODAL = path.join(ROOT, 'public', 'assets', 'js', 'rp_calc_modal.js');
const CSS = path.join(ROOT, 'public', 'assets', 'css', 'rp-calc-modal.css');
const APP_CSS = path.join(ROOT, 'public', 'assets', 'css', 'app.css');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

// ── Статический разбор: классы, которых больше не должно быть ──────────────
const jsSrc = fs.readFileSync(MODAL, 'utf8');
const cssSrc = fs.readFileSync(CSS, 'utf8');
const appCss = fs.readFileSync(APP_CSS, 'utf8');

check('в просчёте нет рендера карточек позиций', () => {
  assert.ok(!/rp-calc-dv-card"/.test(jsSrc), 'осталась разметка карточек rp-calc-dv-card');
  assert.ok(!/rp-calc-dv-cards/.test(jsSrc), 'остался контейнер карточек');
  assert.ok(!/rp-calc-dv-inp/.test(jsSrc), 'остались поля старой карточной вёрстки');
});

check('позиции рендерятся строками таблицы', () => {
  assert.ok(/class="rp-dv-row/.test(jsSrc), 'нет строк rp-dv-row');
  assert.ok(/class="rp-dv-table"/.test(jsSrc), 'нет контейнера таблицы');
  assert.ok(/class="rp-dv-head"/.test(jsSrc), 'нет шапки колонок');
  assert.ok(/class="rp-dv-list"/.test(jsSrc), 'нет списка строк');
});

check('правка на месте: все шесть полей на data-dv-field', () => {
  ['name', 'method_name', 'volume', 'unit', 'fouling', 'period'].forEach((f) => {
    assert.ok(jsSrc.includes('data-dv-field="' + f + '"'),
      'нет поля ' + f + ' — правка на месте сломана');
  });
});

check('строки несут data-dv-idx (по нему обработчик находит позицию)', () => {
  assert.ok(/data-dv-idx="' \+ idx/.test(jsSrc), 'нет data-dv-idx в строке');
});

check('в app.css hidden у файлового инпута снова работает', () => {
  assert.ok(/input\[type="file"\]\[hidden\]/.test(appCss),
    'нет правила, возвращающего hidden для input[type=file]');
  assert.ok(/display:\s*none\s*!important/.test(appCss),
    'правило не перебивает display:block');
});

check('в CSS есть сетка колонок, общая для шапки и строк', () => {
  assert.ok(/--rp-dv-cols:/.test(cssSrc), 'нет общей сетки колонок');
  assert.ok(/\.rp-dv-head\s*\{[^}]*grid-template-columns:\s*var\(--rp-dv-cols\)/s.test(cssSrc),
    'шапка не использует общую сетку');
  assert.ok(/\.rp-dv-row\s*\{[^}]*grid-template-columns:\s*var\(--rp-dv-cols\)/s.test(cssSrc),
    'строка не использует общую сетку');
});

check('в CSS нет остатков карточных стилей', () => {
  assert.ok(!/\.rp-calc-dv-card__grid/.test(cssSrc), 'остался стиль карточной сетки');
  assert.ok(!/\.rp-calc-dv-card__tech/.test(cssSrc), 'остался стиль карточки');
});

// ── Загрузка модуля и рендер ───────────────────────────────────────────────
function loadModal() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.Promise = Promise;
  sandbox.JSON = JSON;
  sandbox.localStorage = { getItem: () => null, setItem: () => {} };
  sandbox.fetch = () => Promise.reject(new Error('offline'));
  sandbox.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: () => {},
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
    body: { appendChild() {}, classList: { add() {}, remove() {} } }
  };
  sandbox.Array = Array;
  sandbox.Object = Object;
  sandbox.String = String;
  sandbox.Number = Number;
  sandbox.Math = Math;
  sandbox.Date = Date;
  sandbox.RegExp = RegExp;
  sandbox.Error = Error;
  sandbox.isNaN = isNaN;
  vm.createContext(sandbox);
  vm.runInContext(jsSrc, sandbox, { filename: 'rp_calc_modal.js' });
  return sandbox;
}

let api = null;
try {
  const sb = loadModal();
  api = sb.AsgardRpCalcModal || sb.RpCalcModal || null;
} catch (e) {
  api = null;
}

check('модуль загружается без исключений', () => {
  assert.ok(api, 'AsgardRpCalcModal не определён после загрузки');
});

check('тест-хук рендера объёмов доступен', () => {
  assert.ok(api && typeof api.__renderDvForTest === 'function',
    'нет __renderDvForTest — добавить экспорт хука');
});

if (api && typeof api.__renderDvForTest === 'function') {
  const state = {
    tab: 'dv',
    review: {
      report_json: {
        dv_positions: [
          { id: 'p1', name: 'Теплообменник 2104L', volume: 5475, unit: 'п.м', period: 'апрель',
            fouling: 'medium', category_code: 'tubes', method_code: 'gdo',
            method_name: 'ГДО', category_name: 'Трубные пучки', objects: [{ tag: '2104L' }],
            volume_source: 'vor', volume_proof: 'документ: форма', tech_equip: 'АВД' },
          { id: 'p2', name: 'Конденсатор 39/2', volume: 182, unit: 'п.м', period: 'октябрь',
            fouling: 'light', category_code: 'tubes', method_code: 'gdo' }
        ],
        calc_plan: { positions: [], work_days: 158 }
      }
    },
    readOnly: false,
    demo: false
  };
  let html = '';
  try { html = api.__renderDvForTest(state); } catch (e) { html = 'ERR: ' + e.message; }

  check('рендер отдаёт таблицу и две строки', () => {
    assert.ok(!/^ERR/.test(html), html.slice(0, 120));
    // Считаем именно строки, а не вложенные элементы вида rp-dv-row__name.
    const rowCount = (html.match(/class="rp-dv-row(?!__)/g) || []).length;
    assert.strictEqual(rowCount, 2, 'строк ' + rowCount);
  });

  check('шапка и строка имеют одинаковое число колонок', () => {
    const head = /class="rp-dv-head"[^>]*>([\s\S]*?)<\/div>\s*<div class="rp-dv-list"/.exec(html);
    assert.ok(head, 'не найдена шапка');
    const headCols = (head[1].match(/<span/g) || []).length;
    assert.strictEqual(headCols, 7, 'колонок в шапке ' + headCols + ', ожидалось 7');
    // В первой строке столько же прямых потомков-колонок.
    const firstRow = /class="rp-dv-row(?!__)[^"]*"[^>]*>([\s\S]*?)<div class="rp-dv-row__src"/.exec(html);
    assert.ok(firstRow, 'не найдена первая строка');
    const colCount = (firstRow[1].match(/class="rp-dv-row__(num|name|qty|foul|period|plan)|class="rp-dv-row__del/g) || []).length;
    assert.strictEqual(colCount, 7, 'колонок в строке ' + colCount + ', ожидалось 7');
  });

  check('нет undefined и null в разметке', () => {
    assert.ok(!/undefined/.test(html), 'в разметке есть undefined');
    assert.ok(!/>null</.test(html), 'в разметке есть null');
  });

  check('источник объёма виден строкой', () => {
    assert.ok(/из ВОР/.test(html), 'нет бейджа источника объёма');
  });

  check('файловый инпут скрыт атрибутом hidden', () => {
    assert.ok(/<input type="file" data-rp-extra-input[^>]*hidden/.test(jsSrc),
      'у файлового инпута нет hidden — браузер нарисует вторую кнопку');
  });
}

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
