'use strict';

/**
 * Тесты письма директору: сохранение состава сметы и блок анализа.
 *
 * ── Что проверяем ──────────────────────────────────────────────────────────
 * 1. ensureEstimate больше не теряет crew / mtr / schedule / works.
 *    Раньше в recalc уходили только meta, params и rows, и письмо директору
 *    показывало смету без бригады и без состава работ.
 * 2. Блок анализа рендерится: источник объёма, уверенность, состав работ,
 *    бригада, проблемы. И НЕ рендерится, когда данных нет (письмо не должно
 *    пухнуть пустой рамкой).
 * 3. Все тексты — по-русски, без латинских служебных кодов.
 */

const assert = require('assert');

process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test-only-not-used';
const mail = require('../src/services/tender-director-mail');

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

// ── 1. ensureEstimate сохраняет техплан ────────────────────────────────────
check('ensureEstimate сохраняет бригаду и график', () => {
  const input = {
    template: 'asgard_v1',
    params: { work_days: 5 },
    crew: [{ code: 'slesar', role: 'Слесарь', count: 2, shifts_per_day: 1, hours_per_shift: 11 }],
    mtr: [],
    schedule: { duration_days: 5, crews: 1 },
    meta: { work_duration_days: 5, crews: 1 }
  };
  const est = mail.ensureEstimate(input);
  assert.ok(Array.isArray(est.crew), 'crew потерян');
  assert.ok(est.crew.length > 0, 'бригада пустая');
  assert.ok(est.totals && est.totals.cost > 0, 'смета не посчиталась');
});

check('ensureEstimate сохраняет состав работ', () => {
  const input = {
    template: 'asgard_v1',
    params: { work_days: 3 },
    crew: [{ code: 'slesar', role: 'Слесарь', count: 1, shifts_per_day: 1, hours_per_shift: 11 }],
    works: [{ name: 'Очистка резервуара', volume: 100, unit: 'м3', volume_source: 'vor' }],
    meta: { work_duration_days: 3, crews: 1 }
  };
  const est = mail.ensureEstimate(input);
  assert.ok(Array.isArray(est.works), 'works потерян');
  assert.strictEqual(est.works.length, 1);
  assert.strictEqual(est.works[0].name, 'Очистка резервуара');
});

// ── 2. Блок анализа ────────────────────────────────────────────────────────
check('блок анализа показывает источник объёма и уверенность', () => {
  const html = mail.renderAnalysisBlockHtml(
    { volume_source: 'vor', confidence: 0.85 },
    { works: [{ name: 'Очистка', volume: 100, unit: 'м3' }], meta: { work_duration_days: 5 } }
  );
  assert.ok(html.includes('Анализ'), 'нет заголовка блока');
  assert.ok(html.includes('ведомость объёмов работ'), 'нет источника объёма');
  assert.ok(html.includes('высокая'), 'нет оценки уверенности');
  assert.ok(html.includes('5'), 'нет срока');
});

check('блок анализа показывает состав работ с источником', () => {
  const html = mail.renderAnalysisBlockHtml(
    {},
    { works: [
      { name: 'Гидрочистка трубок', volume: 7200, unit: 'п.м', volume_source: 'vor' },
      { name: 'Замена участка', volume: 50, unit: 'м', volume_source: 'passport' }
    ] }
  );
  assert.ok(html.includes('СОСТАВ РАБОТ'), 'нет заголовка состава');
  assert.ok(html.includes('Гидрочистка трубок'), 'нет первой позиции');
  assert.ok(html.includes('7200'), 'нет объёма');
  assert.ok(html.includes('паспорт оборудования'), 'нет источника второй позиции');
});

check('блок анализа показывает бригаду', () => {
  const html = mail.renderAnalysisBlockHtml(
    {},
    { crew: [
      { role: 'Слесарь', count: 4 },
      { role: 'Мастер / бригадир', count: 1 },
      { role: 'ИТР (РП)', count: 1 }
    ] }
  );
  assert.ok(html.includes('БРИГАДА'), 'нет заголовка бригады');
  assert.ok(html.includes('Слесарь'), 'нет слесарей');
  assert.ok(html.includes('Мастер'), 'нет мастера');
  assert.ok(html.includes('ИТР'), 'нет ИТР');
});

check('блок анализа показывает проблемы', () => {
  const html = mail.renderAnalysisBlockHtml(
    { problems: ['Не указан срок работ', { text: 'Объём требует подтверждения', kind: 'внимание' }] },
    {}
  );
  assert.ok(html.includes('ЧТО ТРЕБУЕТ ВНИМАНИЯ'), 'нет заголовка проблем');
  assert.ok(html.includes('Не указан срок работ'), 'нет первой проблемы');
  assert.ok(html.includes('Объём требует подтверждения'), 'нет второй проблемы');
});

check('без данных блок не рендерится (письмо не пухнет)', () => {
  assert.strictEqual(mail.renderAnalysisBlockHtml({}, {}), '');
  assert.strictEqual(mail.renderAnalysisBlockHtml(null, null), '');
  assert.strictEqual(mail.renderAnalysisBlockHtml({ problems: [] }, { works: [], crew: [] }), '');
});

// ── 3. Русский язык ────────────────────────────────────────────────────────
check('в блоке нет латинских служебных кодов', () => {
  const html = mail.renderAnalysisBlockHtml(
    { volume_source: 'vor', confidence: 0.9, problems: ['Проверить объём'] },
    { works: [{ name: 'Очистка', volume: 10, unit: 'м3', volume_source: 'passport' }],
      crew: [{ role: 'Слесарь', count: 2 }],
      meta: { work_duration_days: 4 } }
  );
  // Служебные значения переведены: 'vor' → «ведомость…», 'passport' → «паспорт…».
  assert.ok(!html.includes('>vor<'), 'латинский код vor в тексте');
  assert.ok(!html.includes('passport'), 'латинский код passport в тексте');
  assert.ok(html.includes('ведомость объёмов работ'));
  assert.ok(html.includes('паспорт оборудования'));
});

check('письмо содержит блок анализа', () => {
  // Проверяем не только функцию блока, но и то, что письмо её ВЫЗЫВАЕТ.
  const html = mail.buildEmailHtml({
    tender: { id: 1, registry_no: '2138', tender_title: 'Очистка' },
    review: {
      report_json: JSON.stringify({
        summary: 'Очистка оборудования',
        volume_source: 'vor',
        confidence: 0.8,
        problems: ['Уточнить объём по позиции 7']
      })
    },
    estimate: {
      template: 'asgard_v1',
      params: { work_days: 5 },
      crew: [{ code: 'slesar', role: 'Слесарь', count: 2, shifts_per_day: 1, hours_per_shift: 11 }],
      works: [{ name: 'Гидрочистка трубок', volume: 100, unit: 'п.м', volume_source: 'vor' }],
      meta: { work_duration_days: 5, crews: 1 }
    },
    decideUrl: 'https://example.test/decide',
    filesUrl: 'https://example.test/files',
    files: [],
    pmName: 'Андросов',
    expectedFrom: 'директор',
    recipientLabel: 'Директор'
  });
  assert.ok(typeof html === 'string' && html.length > 100, 'письмо не собралось');
  assert.ok(html.includes('Анализ'), 'в письме нет блока анализа');
  assert.ok(html.includes('СОСТАВ РАБОТ'), 'в письме нет состава работ');
  assert.ok(html.includes('Гидрочистка трубок'), 'в письме нет позиции работ');
});

check('уверенность словом не даёт «NaN %»', () => {
  // Конвейер отдаёт 'high'/'medium'/'low', а блок ждал число:
  // директор видел «низкая (NaN %)» — ложный сигнал в письме.
  const high = mail.renderAnalysisBlockHtml({ confidence: 'high' }, {});
  assert.ok(high.includes('высокая'), 'слово high не распознано');
  assert.ok(!high.includes('NaN'), 'NaN в письме');
  const low = mail.renderAnalysisBlockHtml({ confidence: 'low' }, {});
  assert.ok(low.includes('низкая'), 'слово low не распознано');
  const medium = mail.renderAnalysisBlockHtml({ confidence: 'medium' }, {});
  assert.ok(medium.includes('средняя'), 'слово medium не распознано');
});

check('уверенность числом и процентами', () => {
  const a = mail.renderAnalysisBlockHtml({ confidence: 0.85 }, {});
  assert.ok(a.includes('высокая'), 'доля 0.85 не распознана');
  assert.ok(a.includes('85'), 'нет процента');
  const b = mail.renderAnalysisBlockHtml({ confidence: 85 }, {});
  assert.ok(b.includes('высокая'), 'проценты 85 не распознаны');
  assert.ok(!b.includes('NaN'), 'NaN при процентах');
});

check('состав работ берётся из dv_positions', () => {
  // Карточка РП пишет позиции в report_json.dv_positions, а блок читал
  // только est.works / rj.works — на проде состав терялся у 19 смет из 31.
  const html = mail.renderAnalysisBlockHtml(
    { dv_positions: [{ name: 'Гидрочистка трубок', volume: 7200, unit: 'п.м' }] },
    {}
  );
  assert.ok(html.includes('СОСТАВ РАБОТ'), 'нет блока состава');
  assert.ok(html.includes('Гидрочистка трубок'), 'нет позиции из dv_positions');
});

const failed = results.filter((r) => !r.ok);
console.log('');
console.log('итог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
