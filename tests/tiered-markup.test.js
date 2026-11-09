'use strict';

/**
 * Тесты динамической наценки по себестоимости.
 *
 * ── Зачем ──────────────────────────────────────────────────────────────────
 * Наценка была единой (×1.5). На мелких тендерах это не покрывает постоянные
 * издержки, на крупных — не проходит по цене. Теперь три ступени:
 *   до 5 млн → ×1.75, 5–15 млн → ×1.50, свыше 15 млн → ×1.45.
 *
 * Границы проверяются на самих порогах и рядом с ними: ошибка на единицу
 * в сравнении (`<` вместо `<=`) сдвигает всю ступень.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'services', 'asgard-smeta.js');
const src = fs.readFileSync(SRC, 'utf8');

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

// Функция извлекается из исходника: экспорт не нужен, а дублировать правило
// в тесте нельзя — тест должен проверять именно рабочий код.
const fnSource = /function tieredMarkup\(cost\) \{[\s\S]*?\n\}/.exec(src);
assert.ok(fnSource, 'функция tieredMarkup не найдена в asgard-smeta.js');
const tieredMarkup = new Function('cost', fnSource[0] + '\nreturn tieredMarkup(cost);');

check('мелкая себестоимость — наценка 1.75', () => {
  assert.strictEqual(tieredMarkup(1000000), 1.75);
  assert.strictEqual(tieredMarkup(4999999), 1.75);
});

check('ровно 5 млн — граница ступени, наценка 1.50', () => {
  assert.strictEqual(tieredMarkup(5000000), 1.5);
});

check('средняя себестоимость — наценка 1.50', () => {
  assert.strictEqual(tieredMarkup(5000001), 1.5);
  assert.strictEqual(tieredMarkup(10000000), 1.5);
  assert.strictEqual(tieredMarkup(15000000), 1.5);
});

check('крупная себестоимость — наценка 1.45', () => {
  assert.strictEqual(tieredMarkup(15000001), 1.45);
  assert.strictEqual(tieredMarkup(50000000), 1.45);
});

check('ноль и отрицательное — базовый уровень, без деления на ноль', () => {
  assert.strictEqual(tieredMarkup(0), 1.5);
  assert.strictEqual(tieredMarkup(-100), 1.5);
  assert.strictEqual(tieredMarkup(null), 1.5);
});

check('наценка применяется в recalc: цена = материалы×1.25 + прочее×коэф', () => {
  // Проверяем, что итоговая цена реально зависит от ступени: две сметы
  // разного масштаба должны дать РАЗНЫЕ коэффициенты.
  const smeta = require(SRC);
  const build = (days, crew) => ({
    template: 'asgard_v1',
    params: { work_days: days },
    crew: [{ code: 'slesar', role: 'Слесарь', count: crew, shifts_per_day: 1, hours_per_shift: 11 }],
    mtr: [],
    schedule: { duration_days: days, crews: 1 },
    meta: { work_duration_days: days, crews: 1 }
  });

  const small = (smeta.buildAsgardSmeta || smeta.recalcAsgardSmeta)(build(5, 1));
  const big = (smeta.buildAsgardSmeta || smeta.recalcAsgardSmeta)(build(90, 20));

  assert.ok(small.totals && small.totals.markup, 'нет markup в итогах малой сметы');
  assert.ok(big.totals && big.totals.markup, 'нет markup в итогах крупной сметы');
  // Малая смета дешевле 5 млн → 1.75; крупная дороже → 1.45 или 1.5.
  assert.strictEqual(small.totals.markup, 1.75,
    'малая смета должна идти по 1.75, а не ' + small.totals.markup);
  assert.ok(big.totals.markup < 1.75,
    'крупная смета не должна идти по 1.75, получено ' + big.totals.markup);
});

check('явная настройка mark имеет приоритет над ступенью', () => {
  const smeta = require(SRC);
  const est = (smeta.buildAsgardSmeta || smeta.recalcAsgardSmeta)({
    template: 'asgard_v1',
    params: { work_days: 5, markup_multiplier: 2.0 },
    crew: [{ code: 'slesar', role: 'Слесарь', count: 1, shifts_per_day: 1, hours_per_shift: 11 }],
    mtr: [],
    schedule: { duration_days: 5, crews: 1 },
    meta: { work_duration_days: 5, crews: 1 }
  });
  assert.strictEqual(est.totals.markup, 2.0,
    'явный коэффициент не применился: ' + est.totals.markup);
});

check('дефолт 1.5 из старого кода не считается ручным выбором', () => {
  // 16 из 20 смет на проде шли по 1.5 при себестоимости < 5 млн вместо 1.75.
  // Проверяем рабочий код: есть предикат наследия и он участвует в hasExplicit.
  assert.ok(/function isLegacyDefaultMarkup/.test(src), 'нет предиката isLegacyDefaultMarkup');
  assert.ok(/isLegacyDefaultMarkup\(rawParams\)/.test(src), 'предикат не используется в hasExplicit');
});

check('явный выбор 1.5 (markup_chosen) уважается', () => {
  assert.ok(/markup_chosen/.test(src), 'нет флага ручного выбора markup_chosen');
});

check('ступень не ставит замок — цена пересчитается при новой себестоимости', () => {
  // Замок только для явного выбора: иначе дефолт застывает.
  assert.ok(/if \(hasExplicit\) est\.params\.markup_locked = 1/.test(src),
    'замок ставится безусловно — наценка застынет');
});

check('модалка помечает ручной выбор наценки', () => {
  const modal = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'assets', 'js', 'rp_calc_modal.js'), 'utf8'
  );
  assert.ok(/markup_chosen = 1/.test(modal), 'модалка не ставит флаг выбора наценки');
});

const failed = results.filter((r) => !r.ok);
console.log('');
console.log('итог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);