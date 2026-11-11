'use strict';
/**
 * Тесты структурного разбора Excel.
 *
 * Главное, что здесь проверяется, — УНИВЕРСАЛЬНОСТЬ: разбор не должен
 * зависеть от формулировок одного заказчика. Поэтому в тестах разные шапки:
 * человеческие («Количество чисток»), машинные («Кол_во_чисток»),
 * строительные («Захватка»), сварочные («Стык»), химические («Реагент»).
 */

const path = require('path');
const es = require(path.join(__dirname, '..', 'src', 'services', 'excel-structure'));

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS ' + name); }
  catch (e) { fail += 1; console.log('FAIL ' + name + ' — ' + e.message); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ` expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

/** Мини-книга из массива листов: [[имя, aoa], ...]. */
function fakeWorkbook(sheets) {
  const XLSX = { utils: { sheet_to_json(sheet) { return sheet._aoa; } } };
  const wb = { SheetNames: sheets.map((s) => s[0]), Sheets: {} };
  sheets.forEach(([name, aoa]) => { wb.Sheets[name] = { _aoa: aoa }; });
  return { XLSX, wb };
}

/** Какое поле победило на заголовке. */
function bestField(header) {
  let best = null;
  for (const f of Object.keys(es.FIELD_HINTS)) {
    const s = es.scoreField(f, header);
    if (s >= es.MIN_FIELD_SCORE && (!best || s > best.score)) best = { field: f, score: s };
  }
  return best ? best.field : null;
}

// ── Разные формулировки одного поля ─────────────────────────────────────────
check('период: разные формулировки распознаются', () => {
  for (const h of ['Период выполнения работ', 'Период', 'Месяц', 'Квартал',
    'График работ', 'Срок выполнения работ']) {
    eq(bestField(h), 'period', 'заголовок: ' + h);
  }
});

check('деньги НЕ распознаются как период', () => {
  for (const h of ['Стоимость выполнения работ в срок по графику',
    'Цена за 1 п.м, без НДС', 'Сумма с НДС', 'Итого по разделу']) {
    if (bestField(h) === 'period') throw new Error('деньги приняты за период: ' + h);
  }
});

check('чистки: «количество» и «кол_во» равноценны', () => {
  for (const h of ['Количество чисток', 'Кол_во_чисток', 'Число чисток',
    'Количество циклов', 'Повторность']) {
    eq(bestField(h), 'clean_count', 'заголовок: ' + h);
  }
});

check('трубки в аппарате ≠ количество работ', () => {
  eq(bestField('Количество труб, шт'), 'tubes');
  eq(bestField('Кол_во_трубок_шт'), 'tubes');
  if (bestField('Количество труб, шт') === 'volume') throw new Error('трубки приняты за объём');
});

check('объём: «всего за год» распознаётся', () => {
  eq(bestField('Объём_всего_за_год'), 'volume');
  eq(bestField('Объём'), 'volume');
  eq(bestField('Объем емкости м3'), 'volume');
});

check('человеко-часы: разные формулировки', () => {
  eq(bestField('Человек_часов_всего'), 'mh');
  eq(bestField('Человек-часов'), 'mh');
  eq(bestField('Трудоемкость, чел·ч'), 'mh');
});

check('наименование: разные формулировки', () => {
  eq(bestField('Наименование теплообменников'), 'name');
  eq(bestField('Наименование_позиция'), 'name');
  eq(bestField('Позиция'), 'name');
});

// ── Универсальность: не только чистка теплообменников ───────────────────────
check('стройка: захватка и ось опознаются как зона работ', () => {
  eq(bestField('Захватка'), 'zone');
  eq(bestField('Ось'), 'zone');
  eq(bestField('Этаж'), 'zone');
});

check('сварка: стык опознаётся как позиция, а не теряется', () => {
  const { XLSX, wb } = fakeWorkbook([['Сварка', [
    ['Стык', 'Количество стыков', 'Диаметр, мм', 'Ед. изм.'],
    ['С-1', '12', '159', 'шт'],
    ['С-2', '8', '219', 'шт']
  ]]]);
  const r = es.parseWorkbook(XLSX, wb);
  eq(r.positions.length, 2, 'стыки должны стать позициями');
});

check('изоляция: площадь участка', () => {
  const { XLSX, wb } = fakeWorkbook([['Изоляция', [
    ['Наименование участка', 'Площадь поверхности', 'Ед. изм.'],
    ['Трубопровод 1', '45', 'м2'],
    ['Трубопровод 2', '30', 'м2']
  ]]]);
  const r = es.parseWorkbook(XLSX, wb);
  eq(r.positions.length, 2);
});

check('простой шаблон заказчика: Наименование / Объём / Ед. изм.', () => {
  const { XLSX, wb } = fakeWorkbook([['Л', [
    ['№', 'Наименование работ', 'Объём', 'Ед. изм.', 'Период'],
    ['1', 'Работа А', '10', 'м3', 'май'],
    ['2', 'Работа Б', '20', 'м3', 'июнь']
  ]]]);
  const r = es.parseWorkbook(XLSX, wb);
  eq(r.positions.length, 2);
  eq(r.stats.periods, 2);
});

// ── Пустая колонка «Наименование» ───────────────────────────────────────────
check('пустое «Наименование» → имя из «Тип оборудования»', () => {
  const { XLSX, wb } = fakeWorkbook([['ДВ', [
    ['№', 'Цех', 'Тип оборудования', 'Подтип', 'Наименование позиции', 'Объём', 'Период'],
    ['1', '1-Б', 'Теплообменник', 'Трубное', '', '100', 'май'],
    ['2', '1-Б', 'Холодильник', 'Межтрубное', '', '200', 'июнь']
  ]]]);
  const r = es.parseWorkbook(XLSX, wb);
  eq(r.positions.length, 2, 'обе строки должны стать позициями');
  if (!/Теплообменник/.test(r.positions[0].name)) {
    throw new Error('имя не из типа оборудования: ' + r.positions[0].name);
  }
});

check('тег в незанятой колонке → имя', () => {
  const { XLSX, wb } = fakeWorkbook([['Л', [
    ['№', 'Позиция', 'Наименование', 'Объём', 'Ед.'],
    ['7', '203/1-4', '', '70', 'шт'],
    ['7', 'Р-1103', '', '40', 'шт']
  ]]]);
  const r = es.parseWorkbook(XLSX, wb);
  eq(r.positions.length, 2);
});

// ── Объём из геометрии ──────────────────────────────────────────────────────
check('объём из геометрии: трубки × длина в мм', () => {
  const { XLSX, wb } = fakeWorkbook([['Л', [
    ['Наименование', 'Количество труб, шт', 'Длина трубки, мм', 'Период'],
    ['Аппарат А', '100', '5000', 'май']
  ]]]);
  const r = es.parseWorkbook(XLSX, wb);
  eq(r.positions.length, 1);
  // 100 × 5000 мм = 500 м
  eq(r.positions[0].volume, 500);
  eq(r.positions[0].unit, 'п.м');
});

check('объём из геометрии: метры не пересчитываются дважды', () => {
  const { XLSX, wb } = fakeWorkbook([['Л', [
    ['Наименование', 'Количество труб, шт', 'Суммарная длина трубок, м', 'Период'],
    ['Аппарат А', '10', '60', 'май']
  ]]]);
  const r = es.parseWorkbook(XLSX, wb);
  eq(r.positions[0].volume, 600, '10 × 60 м = 600');
});

// ── Периоды ─────────────────────────────────────────────────────────────────
check('периоды группируются, работы считаются по чисткам', () => {
  const { XLSX, wb } = fakeWorkbook([['Л', [
    ['Наименование', 'Объём', 'Период', 'Количество чисток'],
    ['А', '10', 'апрель', '1'],
    ['Б', '20', 'апрель', '2'],
    ['В', '30', 'октябрь', '1']
  ]]]);
  const r = es.parseWorkbook(XLSX, wb);
  eq(r.stats.periods, 2);
  eq(r.periods.find((p) => /апрель/.test(p.label)).works, 3);
});

check('регистр периода не задваивает группы', () => {
  const { XLSX, wb } = fakeWorkbook([['Л', [
    ['Наименование', 'Объём', 'Период'],
    ['А', '10', 'Апрель'],
    ['Б', '20', 'апрель']
  ]]]);
  eq(es.parseWorkbook(XLSX, wb).stats.periods, 1);
});

// ── compareLists ────────────────────────────────────────────────────────────
check('один перечень двумя файлами распознаётся как один', () => {
  const a = [
    { name: 'теплообменник оборотной воды', volume: 899, period: 'апрель' },
    { name: 'теплообменник поз. 1127-С', volume: 2312, period: 'октябрь' }
  ];
  const b = [
    { name: 'Теплообменник трубчатый', volume: 899, period: 'апрель' },
    { name: 'Теплообменник трубчатый', volume: 2312, period: 'октябрь' }
  ];
  eq(es.compareLists(a, b).sameList, true);
});

check('разные перечни не схлопываются', () => {
  const a = [{ name: 'А', volume: 100, period: 'май' }];
  const b = [{ name: 'Б', volume: 777, period: 'сентябрь' }];
  eq(es.compareLists(a, b).sameList, false);
});

// ── Крайние случаи ──────────────────────────────────────────────────────────
check('бланк без данных не даёт позиций', () => {
  const { XLSX, wb } = fakeWorkbook([['ТКП', [
    ['ФОРМА ПРЕДЛОЖЕНИЯ', '', ''],
    ['НАЗВАНИЕ УЧАСТНИКА', '', '']
  ]]]);
  eq(es.parseWorkbook(XLSX, wb).positions.length, 0);
});

check('сводные листы без объёма не считаются ведомостью', () => {
  const { XLSX, wb } = fakeWorkbook([['Сводка', [
    ['Наименование', 'Цех', 'Длина трубки, мм'],
    ['Итого по типу', '1-Б', '5000']
  ]]]);
  const r = es.parseWorkbook(XLSX, wb);
  // Длина есть — это мера, значит лист считается таблицей, но строка
  // «Итого» отсекается как служебная.
  eq(r.positions.length, 0, 'служебная строка не должна стать позицией');
});

check('675 позиций парсятся быстро', () => {
  const aoa = [['Наименование', 'Объём', 'Период', 'Ед.']];
  for (let i = 0; i < 675; i += 1) {
    aoa.push(['Аппарат ' + i, String(100 + i), i % 2 ? 'апрель' : 'октябрь', 'шт']);
  }
  const { XLSX, wb } = fakeWorkbook([['Л', aoa]]);
  const t0 = Date.now();
  const r = es.parseWorkbook(XLSX, wb);
  if (Date.now() - t0 > 700) throw new Error('медленно');
  eq(r.positions.length, 675);
});

console.log('\nитог: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
