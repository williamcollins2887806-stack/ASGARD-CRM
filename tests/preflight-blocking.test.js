'use strict';

/**
 * Preflight анализа: нельзя считать, когда считать нечего.
 *
 * ── Почему этот тест существует ───────────────────────────────────────────
 * Верификатор 09.11.2026 провёл мутацию: убрал блокировку `no_quantities` —
 * ни один тест не покраснел. Код был правильный, но незащищённый: следующая
 * правка могла тихо вернуть «модель придумала сроки из воздуха».
 *
 * Проверяем три вещи:
 *   1) текст без единиц измерения → блокирующая находка no_quantities;
 *   2) текст с объёмами → блокировки нет;
 *   3) текст только с трудоёмкостью (чел·ч) → блокировки нет, это норма.
 */

const assert = require('assert');
const path = require('path');

const stages = require(path.join(__dirname, '..', 'src', 'services', 'mimir-tender-stages.js'));

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

/** Минимальный вход preflight: документы с текстом, без позиций. */
function preflight(text) {
  const docs = [{ id: 1, original_name: 'ТЗ.pdf', doc_role: 'tz', text }];
  return stages.preflight({ documents: docs, positions: [] });
}

function hasNoQuantities(res) {
  const gaps = (res && res.gaps) || [];
  return gaps.some((g) => g.id === 'no_quantities' && g.blocking);
}

check('текст без объёмов и трудоёмкости блокирует анализ', () => {
  const res = preflight('Требуется выполнить очистку оборудования. Сроки по согласованию. '
    + 'Работы производятся на территории заказчика, персонал обеспечивается исполнителем. '
    + 'Гарантия на работы — двенадцать месяцев.');
  assert.ok(hasNoQuantities(res), 'нет блокирующей находки no_quantities');
  assert.ok(res.blocking > 0, 'анализ не помечен как заблокированный');
});

check('объёмы в м² снимают блокировку', () => {
  const res = preflight('Очистить поверхность площадью 1200 м2 от отложений. '
    + 'Состав работ: гидроочистка, зачистка, промывка.');
  assert.ok(!hasNoQuantities(res), 'блокировка осталась при наличии м2');
});

check('трудоёмкость в чел·ч снимает блокировку', () => {
  // Тендер 2143 Hi Pro: заказчик дал только минуты, физического объёма нет.
  const res = preflight('Зачистка внутренней поверхности 1800 мин. '
    + 'Оплата по фактически отработанным часам.');
  assert.ok(!hasNoQuantities(res), 'трудоёмкость не признана источником нормы');
});

check('трудоёмкость в минутах распознаётся отдельно от объёма', () => {
  const res = preflight('Общая трудоёмкость работ: 1800 мин. Объёмов в ведомости нет.');
  assert.ok(!hasNoQuantities(res), 'минуты не распознаны как трудоёмкость');
});

const failed = results.filter((r) => !r.ok);
console.log('\nитог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
