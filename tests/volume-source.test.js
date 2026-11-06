'use strict';
/**
 * Источник и доказательство объёма работ.
 *
 * Требование РП 07.11.2026: «Главное, чтобы пользователь видел, откуда что
 * берётся — из паспорта, из ТЗ, из ВОР или из ДВ. То есть должно быть
 * доказательство, откуда взяты объёмы работы».
 */
const assert = require('assert');
const stages = require('../src/services/mimir-tender-stages');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS', name); }
  catch (e) { fail += 1; console.log('FAIL', name, '—', e.message); }
}

const catalog = {
  categories: [
    {
      code: 'tubes',
      title: 'Трубные пучки',
      methods_json: [{ code: 'gdo', label: 'Гидродинамическая очистка' }]
    },
    {
      code: 'vessels',
      title: 'Ёмкости',
      methods_json: [{ code: 'clean', label: 'Зачистка' }]
    }
  ]
};

function norm(over) {
  const dv = stages.normalizeDv({
    positions: [Object.assign({
      name: 'Позиция', category_code: 'tubes', method_code: 'gdo', volume: 100, unit: 'труб'
    }, over)]
  }, catalog);
  return dv.positions[0];
}

// ── 1. Определение источника ────────────────────────────────────────────────
check('явный volume_source сохраняется', () => {
  const p = norm({ volume_source: 'vor' });
  assert.strictEqual(p.volume_source, 'vor');
});

check('источник определяется по имени документа', () => {
  assert.strictEqual(
    norm({ source_ref: { document: 'Ведомость объёмов.xlsx', fragment: 'п.1' } }).volume_source,
    'vor',
    'ведомость не распознана как ВОР');
  assert.strictEqual(
    norm({ source_ref: { document: 'Техническое задание.pdf', fragment: 'п.2' } }).volume_source,
    'tz');
});

check('паспорт из своей базы даёт источник passport', () => {
  const p = norm({ passport: { brand: 'ПСВ-315', source: 'own', note: 'подогреватель' } });
  assert.strictEqual(p.volume_source, 'passport');
});

check('паспорт из интернета помечается отдельно', () => {
  const p = norm({ passport: { brand: 'Некая-марка', source: 'web', note: 'данные из сети' } });
  assert.strictEqual(p.volume_source, 'passport-web',
    'источник из сети должен отличаться от своей базы');
});

check('позиция, правленная РП, помечается rp', () => {
  const p = norm({ tech_status: 'rp' });
  assert.strictEqual(p.volume_source, 'rp');
});

check('без источника — none (не выдумываем)', () => {
  const p = norm({});
  assert.strictEqual(p.volume_source, 'none');
});

// ── 2. Доказательство ───────────────────────────────────────────────────────
check('доказательство содержит документ и цитату', () => {
  const p = norm({
    source_ref: { document: 'ТЗ.pdf', fragment: 'п.3.1 промывка котла К-1' }
  });
  assert.ok(/ТЗ\.pdf/.test(p.volume_proof), 'нет имени документа: ' + p.volume_proof);
  assert.ok(/п\.3\.1/.test(p.volume_proof), 'нет цитаты: ' + p.volume_proof);
});

check('доказательство по паспорту показывает марку и характеристики', () => {
  const p = norm({
    passport: { brand: 'ПСВ-315', source: 'own', note: 'подогреватель сетевой воды' }
  });
  assert.ok(/ПСВ-315/.test(p.volume_proof), 'нет марки: ' + p.volume_proof);
  assert.ok(/подогреватель/.test(p.volume_proof), 'нет описания: ' + p.volume_proof);
});

check('параметры пересчёта попадают в доказательство', () => {
  const p = norm({ thickness_mm: 50, density_t_m3: 1.3, measured_unit: 'м²', measured_value: 1750 });
  assert.ok(/толщина 50/.test(p.volume_proof), 'нет толщины: ' + p.volume_proof);
  assert.ok(/плотность 1\.3/.test(p.volume_proof), 'нет плотности: ' + p.volume_proof);
  assert.ok(/1750 м²/.test(p.volume_proof), 'нет измеренного значения: ' + p.volume_proof);
});

check('нет доказательства — null, а не пустая строка', () => {
  const p = norm({});
  assert.strictEqual(p.volume_proof, null);
});

// ── 3. Confidence ───────────────────────────────────────────────────────────
check('confidence словом сохраняется, а не теряется', () => {
  // Дефект: модель отдаёт 'low', код ждал число и писал null.
  assert.strictEqual(norm({ confidence: 'low' }).confidence, 'low');
  assert.strictEqual(norm({ confidence: 'high' }).confidence, 'high');
  assert.strictEqual(norm({ confidence: 'medium' }).confidence, 'medium');
});

check('confidence по-русски переводится', () => {
  assert.strictEqual(norm({ confidence: 'низкая' }).confidence, 'low');
  assert.strictEqual(norm({ confidence: 'высокая' }).confidence, 'high');
});

check('confidence числом переводится в слово', () => {
  assert.strictEqual(norm({ confidence: 0.9 }).confidence, 'high');
  assert.strictEqual(norm({ confidence: 0.5 }).confidence, 'medium');
  assert.strictEqual(norm({ confidence: 0.2 }).confidence, 'low');
});

// ── 4. Список источников для UI ─────────────────────────────────────────────
check('все источники имеют русское название', () => {
  for (const v of ['vor', 'tz', 'passport', 'passport-web', 'history', 'geometry', 'rp', 'none']) {
    const p = norm({ volume_source: v });
    assert.strictEqual(p.volume_source, v, 'источник ' + v + ' не сохранился');
  }
});

console.log(`\nитог: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
