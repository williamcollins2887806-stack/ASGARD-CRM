#!/usr/bin/env node
'use strict';

/**
 * Регресс-тест полевого модуля (vanilla) без БД и без сети.
 *
 * Закрывает дефект: РП задаёт тариф + роль, сохраняет бригаду, выходит и заходит
 * снова — «Баллы» и «₽/смену» показываются, а ячейка «Тариф» пустая.
 *
 * Причина: сохранённый tariff_id не попадает в список, отфильтрованный по
 * `роль × категория участка` (пример: работа категории «Земля», а тариф назначен
 * по МЛСП; или роль переключили уже после выбора тарифа). Селект рисует только
 * labels из options, поэтому показывал плейсхолдер «— выберите —».
 *
 * Тест вытаскивает функции прямо из public/assets/js/field-tab.js и проверяет,
 * что текущий тариф ВСЕГДА возвращается в список и помечается предупреждением.
 *
 * Запуск: node tests/field-crew-tariff.test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'assets', 'js', 'field-tab.js');
const src = fs.readFileSync(SRC, 'utf8');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✅ ' + name); }
  catch (e) { failed++; console.log('  ❌ ' + name + '\n     ' + e.message); }
}

// Массивы из другого vm-контекста не проходят deepStrictEqual — сравниваем через JSON.
const eq = (actual, expected, msg) =>
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), msg);

// ── Достаём функции из исходника (не переписываем их в тесте) ──
function grabFunction(name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start !== -1, `В field-tab.js не найдена функция ${name}()`);
  let depth = 0;
  let i = src.indexOf('{', start);
  const bodyStart = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(depth === 0, `Не удалось выделить тело ${name}()`);
  const code = src.slice(start, i + 1);
  assert.ok(bodyStart !== -1 && code.length > 20, `${name}() подозрительно короткая`);
  return code;
}

// money() в field-tab.js приходит из AsgardUI (`moneyRub: money`), поэтому в песочнице
// подставляем тот же формат, что и в UI: «8 500 ₽».
const moneyStub = `function money(v) { var n = Number(v) || 0; return n.toLocaleString('ru-RU') + ' ₽'; }`;

const sandbox = {
  console,
  Number,
  String,
  Array,
  Object,
  Boolean,
  Math,
  Set,
  JSON
};
vm.createContext(sandbox);
vm.runInContext(
  moneyStub + '\n' +
  grabFunction('isWelderTariffName') + '\n' +
  grabFunction('isPtoTariffName') + '\n' +
  grabFunction('filterTariffsForFieldRole') + '\n' +
  grabFunction('tariffSelectOptions') + '\n' +
  grabFunction('injectCurrentTariff'),
  sandbox
);

const { filterTariffsForFieldRole, tariffSelectOptions, injectCurrentTariff } = sandbox;

// ── Фикстуры: как в реальном проде (работа «Земля», тарифы назначены по МЛСП) ──
const allTariffs = [
  { id: 31, category: 'mlsp', position_name: 'Слесарь (полный функционал, от второго заезда)', points: 17, rate_per_shift: 8500, is_combinable: false },
  { id: 33, category: 'mlsp', position_name: 'Мастер сменный (второй)', points: 19, rate_per_shift: 9500, is_combinable: false },
  { id: 133, category: 'mlsp', position_name: 'Сварщик (14б)', points: 14, rate_per_shift: 7000, is_combinable: false },
  { id: 309, category: 'mlsp', position_name: 'Сварщик совмещение (+1б)', points: 1, rate_per_shift: 500, is_combinable: true },
  { id: 501, category: 'ground', position_name: 'Слесарь (Земля)', points: 15, rate_per_shift: 7500, is_combinable: false },
  { id: 502, category: 'ground', position_name: 'Мастер сменный (Земля)', points: 17, rate_per_shift: 8500, is_combinable: false }
];

const groundPool = () => allTariffs.filter((t) => t.category === 'ground');
const mlspPool = () => allTariffs.filter((t) => t.category === 'mlsp');

console.log('\nfield-crew-tariff — регресс: сохранённый тариф не должен «пропадать»\n');

// П.1 — воспроизводим сам дефект: базовый фильтр действительно выкидывает тариф
check('П1. до фикса тариф #31 вне списка для role=worker/cat=ground (дефект воспроизводится)', () => {
  const base = filterTariffsForFieldRole(groundPool(), 'worker', 'ground');
  assert.strictEqual(base.some((t) => Number(t.id) === 31), false,
    'тариф #31 неожиданно попал в список — фикстура перестала воспроизводить дефект');
});

// П2 — ключевое: тариф возвращается в список
check('П2. injectCurrentTariff возвращает сохранённый тариф в список', () => {
  const base = filterTariffsForFieldRole(groundPool(), 'worker', 'ground');
  const r = injectCurrentTariff(base, 31, allTariffs, 'ground');
  assert.strictEqual(r.pool.some((t) => Number(t.id) === 31), true, 'тариф #31 не вернулся в список');
  assert.strictEqual(r.pool[0].id, 31, 'возвращённый тариф должен быть первым в списке');
  assert.strictEqual(r.pool.length, base.length + 1, 'в список должен добавиться ровно один тариф');
});

// П3 — предупреждение о несовпадении категории
check('П3. тариф чужой категории помечается предупреждением', () => {
  const base = filterTariffsForFieldRole(groundPool(), 'worker', 'ground');
  const r = injectCurrentTariff(base, 31, allTariffs, 'ground');
  eq(r.warnIds, ['31'], 'тариф mlsp на работе ground обязан быть помечен');
});

// П4 — селект показывает название тарифа, а не плейсхолдер
check('П4. options селекта содержат выбранный тариф с меткой предупреждения', () => {
  const base = filterTariffsForFieldRole(groundPool(), 'worker', 'ground');
  const r = injectCurrentTariff(base, 31, allTariffs, 'ground');
  const opts = tariffSelectOptions(r.pool, { warnIds: r.warnIds });
  const opt = opts.find((o) => String(o.value) === '31');
  assert.ok(opt, 'в options нет значения 31 — тариф снова «пропал»');
  assert.ok(/Слесарь/.test(opt.label), 'в метке нет названия тарифа: ' + opt.label);
  assert.ok(/не из категории объекта/.test(opt.label), 'нет предупреждения в метке: ' + opt.label);
});

// П5 — тариф СВОЕЙ категории не помечается (нет ложного шума)
check('П5. тариф своей категории не получает предупреждение', () => {
  const base = filterTariffsForFieldRole(groundPool(), 'worker', 'ground');
  const r = injectCurrentTariff(base, 501, allTariffs, 'ground');
  eq(r.warnIds, [], 'тариф своей категории помечать нельзя');
  assert.strictEqual(r.pool.length, base.length, 'тариф уже был в списке — дублировать нельзя');
});

// П6 — совмещаемый тариф как основной тоже помечается
check('П6. совмещаемый тариф, выбранный основным, помечается', () => {
  const base = filterTariffsForFieldRole(mlspPool(), 'welder', 'mlsp');
  const r = injectCurrentTariff(base, 309, allTariffs, 'mlsp');
  assert.strictEqual(r.pool.some((t) => Number(t.id) === 309), true, 'совмещаемый тариф не вернулся');
  eq(r.warnIds, ['309'], 'совмещаемый тариф обязан быть помечен');
});

// П7 — смена роли: тариф не из нового списка тоже возвращается
check('П7. после смены роли тариф остаётся в списке', () => {
  // было worker (+Слесарь #31), роль переключили на shift_master
  const base = filterTariffsForFieldRole(mlspPool(), 'shift_master', 'mlsp');
  assert.strictEqual(base.some((t) => Number(t.id) === 31), false, 'фикстура: #31 не должен подходить мастеру');
  const r = injectCurrentTariff(base, 31, allTariffs, 'mlsp');
  assert.strictEqual(r.pool.some((t) => Number(t.id) === 31), true, 'после смены роли тариф пропал');
});

// П8 — краевые случаи: нет тарифа / тариф удалён из сетки
check('П8. краевые случаи не ломают список (нет id, неизвестный id)', () => {
  const base = filterTariffsForFieldRole(groundPool(), 'worker', 'ground');
  const a = injectCurrentTariff(base, null, allTariffs, 'ground');
  assert.strictEqual(a.pool.length, base.length, 'при пустом tariff_id список не должен меняться');
  eq(a.warnIds, [], 'при пустом tariff_id не должно быть предупреждений');
  const b = injectCurrentTariff(base, 999999, allTariffs, 'ground'); // тариф удалён из сетки
  assert.strictEqual(b.pool.length, base.length, 'удалённый из сетки тариф не должен добавляться');
  eq(b.warnIds, [], 'для неизвестного тарифа предупреждений быть не должно');
});

// П9 — все три точки вызова обёрнуты фиксом
check('П9. фикс подключён во всех трёх местах (строка, смена категории, уехавшие)', () => {
  const calls = (src.match(/injectCurrentTariff\(/g) || []).length;
  // 1 объявление + 3 вызова = 4
  assert.ok(calls >= 4, `ожидалось >=4 упоминаний injectCurrentTariff, найдено ${calls}`);
  assert.ok(/injectCurrentTariff\(filteredBase, cur,\s*allTariffsPool, cat\)/.test(src),
    'нет вызова в refreshRowTariffs (строка бригады)');
  assert.ok(/injectCurrentTariff\(filteredBase, curVal,\s*allTariffs, newCat\)/.test(src),
    'нет вызова в _onCategoryChange (смена категории)');
  assert.ok(/injectCurrentTariff\(filtered,\s*assignment\.tariff_id,\s*allTariffs,\s*cat\)/.test(src),
    'нет вызова в openDepartedTariffModal (уехавшие)');
});

// П10 — модалка уехавших показывает метку
check('П10. модалка «Тариф» у уехавших выводит предупреждение', () => {
  assert.ok(/не из категории объекта/.test(src), 'в field-tab.js нет метки предупреждения');
  const m = src.match(/warnIds\s*=\s*new Set\(it\.warnIds\.map\(String\)\)/);
  assert.ok(m, 'в openDepartedTariffModal не прокинуты warnIds');
});

// П11 — синтаксис файла валиден
check('П11. field-tab.js парсится без ошибок', () => {
  new vm.Script(src, { filename: 'field-tab.js' });
});

console.log(`\nИТОГ: ${passed} PASS / ${failed} FAIL`);
process.exit(failed ? 1 : 0);
