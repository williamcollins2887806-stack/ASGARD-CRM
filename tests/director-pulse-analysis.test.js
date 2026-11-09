'use strict';

/**
 * Тесты вкладки «Анализ» в Пульсе директора.
 *
 * ── Зачем ──────────────────────────────────────────────────────────────────
 * Директор согласовывает цену, но судит по обоснованию. Источник объёмов,
 * уверенность разбора и проблемы модели лежали в report_json и нигде не
 * показывались — директор видел итог без причины.
 *
 * Проверяем: вкладка объявлена, рендерится, показывает поля анализа,
 * переводит служебные коды на русский, не падает без данных.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', 'public', 'assets', 'js', 'director_analytics.js');
const src = fs.readFileSync(JS, 'utf8');

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log('PASS ' + name);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log('FAIL ' + name + ' — ' + e.message);
  }
}

// ── 1. Вкладка объявлена ───────────────────────────────────────────────────
check('вкладка «Анализ» есть в списке вкладок тендера', () => {
  assert.ok(/id:\s*'analysis',\s*label:\s*'Анализ'/.test(src),
    'вкладка analysis не объявлена');
});

check('рендер вкладки вызывается по состоянию', () => {
  assert.ok(src.includes("state.tab === 'analysis'"), 'нет ветки рендера');
  assert.ok(src.includes('renderAnalysisTab(t)'), 'нет вызова renderAnalysisTab');
});

// ── 2. Рендер на живых данных ──────────────────────────────────────────────
/** Достаёт функции вкладки и собирает тестовое окружение. */
function build() {
  const fnSources = [];
  for (const name of ['renderAnalysisTab', 'block', 'sideCard']) {
    const re = new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}', 'm');
    const m = re.exec(src);
    assert.ok(m, 'функция ' + name + ' не найдена');
    fnSources.push(m[0]);
  }
  const helpers = `
    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  `;
  return new Function('t', helpers + fnSources.join('\n\n')
    + '\nreturn renderAnalysisTab(t);');
}

check('вкладка показывает источник объёма, уверенность и числа', () => {
  const render = build();
  const html = render({
    rp_review: {
      report_json: {
        volume_source: 'vor',
        confidence: 0.85,
        expected_rows: 673,
        found_positions: 353,
        valid_positions: 349,
        generation_rounds: 3,
        incomplete: true,
        history_count: 5
      }
    }
  });
  assert.ok(html.includes('Источник объёмов'), 'нет источника');
  assert.ok(html.includes('ведомость объёмов работ'), 'код vor не переведён');
  assert.ok(html.includes('высокая'), 'нет оценки уверенности');
  assert.ok(html.includes('673'), 'нет числа строк');
  assert.ok(html.includes('353'), 'нет числа найденных');
  assert.ok(html.includes('349'), 'нет числа годных');
  assert.ok(html.includes('3'), 'нет числа проходов');
  assert.ok(html.includes('неполный'), 'не показан неполный разбор');
  assert.ok(html.includes('Прошлых тендеров'), 'нет истории заказчика');
});

check('вкладка показывает состав работ с источником каждой позиции', () => {
  const render = build();
  const html = render({
    rp_review: {
      report_json: {
        works: [
          { name: 'Гидрочистка трубок', volume: 7200, unit: 'п.м', volume_source: 'vor' },
          { name: 'Замена участка', volume: 50, unit: 'м', volume_source: 'passport' }
        ]
      }
    }
  });
  assert.ok(html.includes('Состав работ'), 'нет заголовка состава');
  assert.ok(html.includes('Гидрочистка трубок'), 'нет первой позиции');
  assert.ok(html.includes('7200'), 'нет объёма');
  assert.ok(html.includes('паспорт оборудования'), 'нет источника паспорта');
});

check('вкладка показывает проблемы', () => {
  const render = build();
  const html = render({
    rp_review: { report_json: { problems: ['Не указан срок', { text: 'Проверить объём' }] } }
  });
  assert.ok(html.includes('Требует внимания'), 'нет заголовка проблем');
  assert.ok(html.includes('Не указан срок'));
  assert.ok(html.includes('Проверить объём'));
});

check('без анализа вкладка честно говорит что данных нет', () => {
  const render = build();
  const html = render(null);
  assert.ok(html.includes('Анализ ещё не проводился'), 'нет честного пустого экрана');
});

check('report_json приходит строкой — парсится', () => {
  const render = build();
  const html = render({
    rp_review: { report_json: JSON.stringify({ volume_source: 'tz_labor', confidence: 0.3 }) }
  });
  assert.ok(html.includes('трудоёмкость из технического задания'), 'JSON-строка не разобрана');
  assert.ok(html.includes('низкая'), 'уверенность не показана');
});

// ── 3. Русский язык и кодировка ────────────────────────────────────────────
check('служебные коды переведены, латиницы в тексте нет', () => {
  const render = build();
  const html = render({
    rp_review: { report_json: { volume_source: 'passport', works: [
      { name: 'Работа', volume: 1, unit: 'м3', volume_source: 'tz_labor' }
    ] } }
  });
  assert.ok(!html.includes('>passport<'), 'латинский код passport');
  assert.ok(!html.includes('>tz_labor<'), 'латинский код tz_labor');
  assert.ok(html.includes('паспорт оборудования'));
});

check('нет mojibake в файле пульса', () => {
  const MOJI = /\u2568|\u2564|\u2565|\u2560/;
  assert.ok(!MOJI.test(src), 'mojibake в director_analytics.js');
  assert.ok(!src.includes('\uFFFD'), 'символы замены');
});

const failed = results.filter((r) => !r.ok);
console.log('');
console.log('итог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
