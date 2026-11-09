'use strict';

/**
 * Тесты ручного редактирования ведомости объёмов.
 *
 * ── Требование ─────────────────────────────────────────────────────────────
 * «Я должен быть уверен, что при любом раскладе смогу закрыть анализ, даже
 * если Мимир ошибётся в ДВ». Значит ДВ обязана быть редактируемой:
 *   • удалить лишнюю строку;
 *   • добавить пропущенную;
 *   • поправить название, объём, единицу, метод;
 *   • заполнить с НУЛЯ, если модель ничего не нашла.
 *
 * Проверяем наличие обработчиков и логику правки в исходнике, а также
 * собираем HTML карточки на подготовленном отчёте.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', 'public', 'assets', 'js', 'rp_review_modal.js');
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

/** Извлекает функцию и исполняет её в минимальном окружении. */
function runRenderDv(reportJson, isLocked) {
  const m = /function renderDvBlock\(rj, isLocked\) \{[\s\S]*?\n  \}/.exec(src);
  assert.ok(m, 'функция renderDvBlock не найдена');
  const helpers = `
    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  `;
  const factory = new Function('rj', 'isLocked',
    helpers + m[0] + '\nreturn renderDvBlock(rj, isLocked);');
  return factory(reportJson, isLocked);
}

// ── 1. Обработчики на месте ────────────────────────────────────────────────
check('удаление строки подключено', () => {
  assert.ok(src.includes("data-rp-dv-act=\"del\""), 'нет кнопки удаления');
  assert.ok(/addEventListener\('click',\s*\(\)\s*=>\s*\{[\s\S]{0,200}splice/.test(src),
    'удаление не вызывает splice');
});

check('добавление строки подключено', () => {
  assert.ok(src.includes("data-rp-dv-act=\"add\""), 'нет кнопки добавления');
  assert.ok(/volume_source:\s*'manual'/.test(src),
    'новая строка не помечается как ручная');
});

check('правка полей пишется в reportJson', () => {
  for (const field of ['name', 'volume', 'unit', 'method_name', 'fouling']) {
    assert.ok(src.includes('data-rp-dv-field="' + field + '"'),
      'нет поля «' + field + '»');
  }
  assert.ok(/list\[idx\]\[field\]\s*=\s*v/.test(src),
    'правка не сохраняется в массив позиций');
});

// ── 2. Рендер: редактируемый режим ─────────────────────────────────────────
check('в редактируемом режиме поля ввода, а не текст', () => {
  const html = runRenderDv({
    dv_positions: [{ name: 'Очистка', volume: 100, unit: 'м3', method_name: 'чистка' }]
  }, false);
  assert.ok(html.includes('data-rp-dv-field="name"'), 'нет поля названия');
  assert.ok(html.includes('data-rp-dv-field="volume"'), 'нет поля объёма');
  assert.ok(html.includes('data-rp-dv-field="unit"'), 'нет поля единицы');
  assert.ok(html.includes('data-rp-dv-act="add"'), 'нет кнопки добавления');
  assert.ok(html.includes('data-rp-dv-act="del"'), 'нет кнопки удаления');
  // Строка таблицы, а не карточка-анкета: правка ведомости должна
  // ощущаться как работа в таблице.
  assert.ok(html.includes('rp-dv-row'), 'нет строки таблицы');
});

check('в режиме просмотра полей ввода нет', () => {
  const html = runRenderDv({
    dv_positions: [{ name: 'Очистка', volume: 100, unit: 'м3' }]
  }, true);
  assert.ok(!html.includes('data-rp-dv-field="name"'), 'поля ввода при закрытой карточке');
  assert.ok(!html.includes('data-rp-dv-act="add"'), 'кнопка добавления при просмотре');
});

check('пустая ДВ даёт возможность заполнить вручную', () => {
  // Главное требование: если Мимир ничего не нашёл, анализ не заблокирован.
  const html = runRenderDv({ dv_positions: [] }, false);
  assert.ok(html.length > 0, 'пустая ДВ не рендерится вовсе');
  assert.ok(html.includes('вручную'), 'нет подсказки про ручное заполнение');
  assert.ok(html.includes('data-rp-dv-act="add"'), 'нельзя добавить строку');
});

check('единицы — только те, что понимает справочник', () => {
  const html = runRenderDv({
    dv_positions: [{ name: 'Работа', volume: 1, unit: 'м3' }]
  }, false);
  for (const u of ['м3', 'м2', 'п.м', 'т', 'шт']) {
    assert.ok(html.includes('>' + u + '</option>'), 'нет единицы «' + u + '»');
  }
});

check('нестандартная единица сохраняется, а не стирается', () => {
  // Если модель поставила «пог.м», правка не должна молча превратить её в пусто.
  const html = runRenderDv({
    dv_positions: [{ name: 'Работа', volume: 1, unit: 'пог.м' }]
  }, false);
  assert.ok(html.includes('пог.м'), 'нестандартная единица потеряна');
});

check('значения экранируются', () => {
  const html = runRenderDv({
    dv_positions: [{ name: '<script>alert(1)</script>', volume: 1, unit: 'м3' }]
  }, false);
  assert.ok(!html.includes('<script>alert'), 'значение не экранировано');
});

const failed = results.filter((r) => !r.ok);
console.log('');
console.log('итог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
