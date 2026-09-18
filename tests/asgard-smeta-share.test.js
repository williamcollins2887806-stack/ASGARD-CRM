#!/usr/bin/env node
'use strict';

/**
 * Детерминированный тест сметы Асгарда (без БД, без сети).
 *
 * Проверяет то, что появилось 16.09.2026 вместе с блоками F/G/H:
 *  1. доля закупки: 15 000 000 × 30% = 4 500 000 и вход в прямые затраты;
 *  2. на оборудование (закупка G + аренда H) наценка НЕ начисляется (1:1);
 *  3. перечень F (kind: 'info') — справочный, в итоги не входит;
 *  4. merge старой сметы: дозаливка блоков F/G/H не меняет суммы старых строк;
 *  5. даты работ: work_start_plan + work_duration_days = work_end_plan_calc;
 *  6. две копии сметы (src/services/asgard-smeta.js и public/assets/js/asgard_smeta.js)
 *     дают побайтово одинаковый результат И лежат синхронно на диске.
 *
 * Запуск: node tests/asgard-smeta-share.test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'services', 'asgard-smeta.js');
const DST = path.join(ROOT, 'public', 'assets', 'js', 'asgard_smeta.js');

// Тест детерминированный и не ходит в БД. Но `src/services/db.js` падает при загрузке,
// если нет DB_PASSWORD, а его тянет письмо директору. Подставляем фиктивные значения:
// пул создаётся лениво, ни одного запроса тест не делает.
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'unit-test-no-db';
process.env.DB_USER = process.env.DB_USER || 'asgard';
process.env.DB_NAME = process.env.DB_NAME || 'asgard_crm_test';

const server = require(SRC);

/** Загружаем браузерную копию в изолированном контексте. */
function loadMirror() {
  const code = fs.readFileSync(DST, 'utf8');
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: DST });
  return sandbox.AsgardSmeta;
}

const mirror = loadMirror();

const results = [];
function check(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      out.then(
        () => results.push({ name, ok: true }),
        (e) => results.push({ name, ok: false, err: e && e.message ? e.message : String(e) })
      );
      return out;
    }
    results.push({ name, ok: true });
    return null;
  } catch (e) {
    results.push({ name, ok: false, err: e && e.message ? e.message : String(e) });
    return null;
  }
}

/** Смета: пустой скелет, из A..E все строки обнулены — считаем чистый эффект G/H/F. */
function estimateWithEquipment(params) {
  const base = server.recalcAsgardSmeta({ template: 'asgard_v1', params: params || {} });
  base.rows.forEach((r) => {
    if (r.kind !== 'line') return;
    if (r.section === 'G' || r.section === 'H') return;
    r.qty = 0;
    r.price = 0;
    r.override = true;
  });
  const setLine = (id, patch) => {
    const row = base.rows.find((r) => r.id === id);
    assert.ok(row, `в скелете есть строка ${id}`);
    Object.assign(row, patch, { override: true });
    return row;
  };
  setLine('g1', { name: 'Оборудование', qty: 1, price: 15000000, sharePct: 0.3 });
  setLine('h1', { name: 'Кран', qty: 2, price: 50000 });
  setLine('f1', { name: 'АВД', qty: 2, price: 900000 });
  base.meta = { work_start_plan: '2026-10-01', work_duration_days: 14 };
  return base;
}

check('доля закупки 15 000 000 × 30% = 4 500 000 и входит в прямые затраты', () => {
  const est = server.recalcAsgardSmeta(estimateWithEquipment());
  const t = est.totals;
  assert.strictEqual(t.equipment_purchase, 4500000, 'equipment_purchase должен быть 4 500 000');
  assert.strictEqual(t.equipment_purchase_full, 15000000, 'полная стоимость закупки — 15 000 000');
  assert.strictEqual(t.equipment_rental, 100000, 'аренда 2 × 50 000 = 100 000');
  assert.strictEqual(t.equipment, 4600000, 'оборудование G+H = 4 600 000');
  assert.strictEqual(t.direct, 4600000, 'прямые = 4 600 000 при пустых A..E');
  // Перечень F — справочно.
  assert.strictEqual(t.equipment_planned, 1800000, 'перечень: 2 × 900 000 = 1 800 000 справочно');
  assert.strictEqual(t.equipment_rental_full, 100000, 'полная аренда справочно');
});

check('на оборудование наценка не начисляется (1:1), на материалы — по material_markup', () => {
  const base = server.recalcAsgardSmeta({
    template: 'asgard_v1',
    params: { markup: 2, material_markup: 1, overhead: 0, contingency: 0, fot_tax: 0, vat: 0.22 }
  });
  base.rows.forEach((r) => {
    if (r.kind !== 'line') return;
    if (r.section === 'E' || r.section === 'G') return;
    r.qty = 0; r.price = 0; r.override = true;
  });
  Object.assign(base.rows.find((r) => r.id === 'e1'), { name: 'Химия', qty: 1, price: 1000000, override: true });
  Object.assign(base.rows.find((r) => r.id === 'g1'), { name: 'Оборудование', qty: 1, price: 1000000, sharePct: 1, override: true });
  const t = server.recalcAsgardSmeta(base).totals;
  assert.strictEqual(t.materials, 1000000, 'материалы 1 000 000');
  assert.strictEqual(t.equipment, 1000000, 'оборудование 1 000 000');
  assert.strictEqual(t.cost, 2000000, 'себестоимость 2 000 000');
  // 1 000 000 × 1 (материалы) + 1 000 000 × 1 (оборудование, без наценки) = 2 000 000.
  assert.strictEqual(t.price_no_vat, 2000000, 'цена без НДС: оборудование не раздуто наценкой ×2');
  assert.ok(Math.abs(t.price_with_vat - 2440000) < 0.01, 'НДС 22% сверху: 2 440 000');
});

check('info-строки (перечень) не участвуют в суммах и живут в разделе F', () => {
  const est = server.recalcAsgardSmeta(estimateWithEquipment());
  const info = est.rows.filter((r) => r.kind === 'info');
  assert.ok(info.length >= 1, 'есть справочные строки перечня');
  assert.strictEqual(info[0].section, 'F', 'раздел F');
  const f1 = est.rows.find((r) => r.id === 'f1');
  assert.strictEqual(f1.sum, 1800000, 'сумма справочной строки считается для показа');
  assert.strictEqual(est.totals.equipment_planned, 1800000, 'перечень виден отдельным итогом');
  const linesSum = est.rows
    .filter((r) => r.kind === 'line' && r.section === 'F')
    .reduce((s, r) => s + (Number(r.sum) || 0), 0);
  assert.strictEqual(linesSum, 0, 'в разделе F нет строк, входящих в итоги');
});

check('merge старой сметы: блоки F/G/H дозаливаются, старые суммы не меняются', () => {
  const legacy = {
    template: 'asgard_v1',
    params: { markup: 1, material_markup: 1 },
    rows: [
      { id: 'sec_a', kind: 'section', section: 'A', name: 'A. Персонал' },
      { id: 'a_fot', kind: 'line', section: 'A', code: 'A1', name: 'ФОТ', unit: 'чел·дн', qty: 10, price: 10000,
        override: true, note: 'ручная правка РП' },
      { id: 'c_ai_1', kind: 'line', section: 'A', code: 'A2', name: 'Строка Мимира', unit: 'чел·дн', qty: 3, price: 2000 },
      { id: 'a_tot', kind: 'subtotal', section: 'A', code: 'A_TOT', name: 'Итого A', sumOf: 'A_lines' },
      { id: 'r_direct', kind: 'rollup', section: 'R', code: 'R1', name: 'ПРЯМЫЕ ЗАТРАТЫ, ИТОГО', sumExpr: 'direct' },
      { id: 'r_cost', kind: 'rollup', section: 'R', code: 'R4', name: 'СЕБЕСТОИМОСТЬ (без НДС)', sumExpr: 'cost' }
    ]
  };
  // Сохранённый payload РП не должен мутироваться: он уходит в БД как есть.
  const payloadBefore = JSON.stringify(legacy);

  const after = server.recalcAsgardSmeta(legacy);
  assert.strictEqual(JSON.stringify(legacy), payloadBefore, 'recalc не мутирует сохранённую смету');

  const ids = after.rows.map((r) => r.id);
  ['sec_f', 'sec_g', 'sec_h', 'r_equip', 'r_equip_g', 'r_equip_h'].forEach((id) => {
    assert.ok(ids.includes(id), `после merge есть ${id}`);
  });
  // Дозалитые блоки пусты → в суммы не добавили ни рубля.
  assert.strictEqual(after.totals.equipment, 0, 'новые блоки пусты: оборудование 0');
  assert.strictEqual(after.totals.equipment_planned, 0, 'новые блоки пусты: перечень 0');
  assert.strictEqual(
    after.rows.filter((r) => ['sec_f', 'sec_g', 'sec_h'].includes(r.section)).reduce((s, r) => s + (Number(r.sum) || 0), 0),
    0,
    'ни одна строка F/G/H не дала суммы'
  );
  // Суммы ДВУХ старых строк — против ручного ожидания (10 × 10 000 + 3 × 2 000).
  assert.strictEqual(
    after.rows.filter((r) => ['a_fot', 'c_ai_1'].includes(r.id)).reduce((s, r) => s + (Number(r.sum) || 0), 0),
    106000,
    'суммы старых строк = ручные 106 000'
  );
  // Ручные правки и строки Мимира на месте — без них merge был бы потерей данных.
  const fot = after.rows.find((r) => r.id === 'a_fot');
  assert.strictEqual(fot.note, 'ручная правка РП', 'note ручной строки сохранён');
  assert.strictEqual(fot.qty, 10, 'qty ручной строки не перезаписан скелетом');
  assert.strictEqual(fot.price, 10000, 'price ручной строки не перезаписан скелетом');
  assert.strictEqual(fot.override, true, 'override ручной строки сохранён');
  const mimir = after.rows.find((r) => r.id === 'c_ai_1');
  assert.ok(mimir, 'строка Мимира сохранена');
  assert.strictEqual(mimir.sum, 6000, 'строка Мимира посчитана (3 × 2 000)');

  // Итог целиком: обнуляем дефолтные строки дозалитого скелета и получаем ЧИСТЫЙ вклад
  // старых строк. Без этого шага `direct` включал бы дефолты скелета, и «ручное» ожидание
  // было бы непроверяемым (нашёл L3-верификатор, 16.09).
  after.rows.forEach((r) => {
    if (r.kind !== 'line') return;
    if (r.id === 'a_fot' || r.id === 'c_ai_1') return;
    r.qty = 0;
    r.price = 0;
    r.override = true;
  });
  const clean = server.recalcAsgardSmeta(after);
  // 106 000 ФОТ + налог на ФОТ 55% (дефолт параметров сметы) = 164 300. Считано руками,
  // не вторым вызовом recalc — иначе проверка была бы тавтологией (нашёл L3-верификатор, 16.09).
  assert.strictEqual(clean.totals.direct, 164300, 'прямые = 106 000 × 1.55 (вклад merge F/G/H = 0)');
  assert.strictEqual(clean.totals.equipment, 0, 'оборудование осталось 0');
  assert.strictEqual(clean.totals.equipment_planned, 0, 'перечень остался 0');

  // Новые разделы стоят перед итоговым разделом R.
  assert.ok(ids.indexOf('sec_f') < ids.indexOf('r_direct'), 'F вставляется перед итогами R');
  assert.ok(ids.indexOf('sec_h') < ids.indexOf('r_direct'), 'H вставляется перед итогами R');
});

check('даты: work_start_plan + work_duration_days = work_end_plan_calc', () => {
  const est = server.recalcAsgardSmeta({
    template: 'asgard_v1',
    meta: { work_start_plan: '2026-10-01', work_duration_days: 14 },
    rows: []
  });
  assert.strictEqual(est.meta.work_start_plan, '2026-10-01', 'дата начала нормализована');
  assert.strictEqual(est.meta.work_end_plan_calc, '2026-10-15', '14 суток от 01.10 → 15.10');
  assert.strictEqual(server.addDaysIso('2026-12-30', 3), '2027-01-02', 'переход через год');
  assert.strictEqual(server.normalizeIsoDate('01.10.2026'), '2026-10-01', 'нормализация dd.mm.yyyy');
  assert.strictEqual(server.normalizeIsoDate(''), null, 'пустая дата → null');
  assert.strictEqual(server.normalizeSharePct(30), 0.3, 'sharePct 30 → 0.3');
  assert.strictEqual(server.normalizeSharePct(0), 0, 'sharePct 0 → 0');
  assert.strictEqual(server.normalizeSharePct(undefined), 1, 'sharePct по умолчанию → 1');
  assert.strictEqual(server.normalizeSharePct(150), 1, 'sharePct > 100% обрезается до 1');
});

check('две копии сметы дают одинаковый результат и синхронны на диске', () => {
  const input = () => estimateWithEquipment();
  const a = server.recalcAsgardSmeta(input());
  const b = mirror.recalcAsgardSmeta(input());
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(b)),
    JSON.parse(JSON.stringify(a)),
    'результаты серверной и браузерной копий обязаны совпадать'
  );
  assert.strictEqual(typeof mirror.buildTextReport, typeof server.buildTextReport, 'набор экспортов совпадает');
  // Файл-зеркало должен быть ровно тем, что собирает tools/build_smeta_mirror.js.
  // Сборщик — единый источник истины (в т.ч. по переводам строк, D-179): не
  // дублируем его логику в тесте, иначе гейт ловит CRLF/LF как «расхождение».
  const { buildMirror, normalizeEol } = require(path.join(ROOT, 'tools', 'build_smeta_mirror.js'));
  const actual = fs.readFileSync(DST, 'utf8');
  assert.strictEqual(
    normalizeEol(actual),
    normalizeEol(buildMirror()),
    'public/assets/js/asgard_smeta.js разошёлся — запустить node tools/build_smeta_mirror.js'
  );
});

check('налог 55% считается с ФОТ + пайковые (проживание не облагается)', () => {
  // Канон из CLAUDE.md: база налога = ФОТ + пайковые. Проживание — компенсация
  // расходов, налогом не облагается. Проверяем на «чистых» числах.
  const est = server.recalcAsgardSmeta({
    template: 'asgard_v1',
    params: { fot_tax: 0.55, overhead: 0, contingency: 0, markup: 1, material_markup: 1 }
  });
  est.rows.forEach((r) => {
    if (r.kind !== 'line') return;
    r.qty = 0; r.price = 0; r.override = true;
  });
  const setLine = (id, patch) => {
    const row = est.rows.find((r) => r.id === id);
    assert.ok(row, `в скелете есть строка ${id}`);
    Object.assign(row, patch, { override: true });
  };
  setLine('a3', { name: 'Рабочий', qty: 10, price: 10000 });   // ФОТ = 100 000
  setLine('c1', { name: 'Пайковые', qty: 100, price: 1000 });  // пайковые = 100 000
  setLine('c2', { name: 'Проживание', qty: 100, price: 1250 }); // жильё = 125 000 (не облагается)

  const out = server.recalcAsgardSmeta(est);
  const t = out.totals;
  assert.strictEqual(t.fot, 100000, 'ФОТ = 100 000');
  assert.strictEqual(t.fot_tax_base, 200000, 'база налога = ФОТ + пайковые = 200 000');
  assert.strictEqual(t.fot_tax, 110000, 'налог 55% от 200 000 = 110 000 (не 55 000 от одного ФОТ)');
  assert.strictEqual(t.personnel, 210000, 'персонал = ФОТ + налог = 210 000');
  assert.strictEqual(t.travel, 225000, 'командировочные = пайковые + проживание = 225 000');
  assert.strictEqual(t.direct, 435000, 'прямые = персонал + командировочные = 435 000');
  assert.notStrictEqual(t.fot_tax, Math.round(t.fot * 0.55), 'налог не равен 55% от одного ФОТ');
});

check('регресс Киров Тайр (реестр 1229): движок воспроизводит расчёт РП до рубля', () => {
  // Фиксирует поведение, на котором сошлись 17.09.2026 (5 лотков ≈ 250 п.м):
  // смена 11 ч − 3 ч = 8 ч; в лотке РЕЖУТ 2 чистильщика (по одному с краёв к приямку),
  // третий стоит в приямке и толкает мусор к шлангу — он погонный метр не режет.
  // 8 ч × 2 чел = 16 п.м/смена, × 2 смены = 32 п.м/сутки. 250 / 32 = 7,8 сут,
  // + 4 смены АВД (2 сут) → 10 рабочих суток. Мобилизация 4 сут, дорога 4 сут (туда-обратно).
  // Маржа 50%; на оборудование наценка НЕ начисляется (см. отдельный кейс).
  const est = server.recalcAsgardSmeta({
    template: 'asgard_v1',
    params: { markup: 1.5, material_markup: 1, fot_tax: 0.55, overhead: 0.10, contingency: 0.05, vat: 0.22 }
  });
  est.rows.forEach((r) => {
    if (r.kind !== 'line') return;
    r.qty = 0; r.price = 0; r.override = true;
  });
  const setLine = (id, patch) => {
    const row = est.rows.find((r) => r.id === id);
    assert.ok(row, `в скелете есть строка ${id}`);
    Object.assign(row, patch, { override: true });
  };
  const WD = 10, MOB = 4, ROAD = 4, SHIFTS = 2;
  const DAYS_AWAY = WD + MOB + ROAD;   // 18
  const PPL = 6 * SHIFTS + 1;          // 13: 12 сменщиков + ИТР
  setLine('a1', { qty: DAYS_AWAY, price: 20000 });                        // ИТР 18 × 20 000
  setLine('a2', { qty: 1 * SHIFTS * WD + 1 * MOB, price: 20000 });        // мастер 24
  setLine('a3', { qty: 5 * SHIFTS * WD + 5 * MOB, price: 15000 });        // чистильщики 120
  setLine('a4', { qty: 0, price: 20000 });
  setLine('a5', { qty: 0, price: 15000 });                                // мобилизация уже в A2/A3
  setLine('a6', { qty: PPL * ROAD, price: 3000 });                        // дорога 13 × 4
  setLine('b1', { qty: PPL, price: 15000 });                              // СИЗ 13 × 15 000
  setLine('b4', { qty: 1, price: 100000 });                               // амортизация оборудования
  setLine('b5', { qty: 1, price: 150000 });                               // расходники + оснастка
  setLine('c1', { qty: PPL * DAYS_AWAY, price: 1000 });                   // пайковые 13 × 18
  setLine('c2', { qty: PPL * (WD + MOB), price: 1000 });                  // проживание 13 × 14
  setLine('d1', { qty: 1, price: 50000 });                                // «Доставка оборудования»: едем своей машиной
  setLine('d2', { qty: PPL, price: 20000 });                              // «Проезд персонала»: 13 × 20 000 (туда-обратно)
  setLine('g1', { qty: 2, price: 35000, sharePct: 0.30 });                // 2 вентилятора, в с/с 30%

  const t = server.recalcAsgardSmeta(est).totals;
  // Копеечная точность: у этой сметы НДС стоит ровно на полугранице (2 152 902,675),
  // поэтому допуск 1,5 ₽ маскировал бы ошибку округления в 1 копейку (D-181). Держим 0,005.
  const near = (got, want, label) => assert.ok(Math.abs(got - want) < 0.005, `${label}: ${got} != ${want}`);
  near(t.fot, 2796000, 'ФОТ');
  near(t.fot_tax_base, 3030000, 'база налога (ФОТ + пайковые)');
  near(t.fot_tax, 1666500, 'налог 55%');
  near(t.personnel, 4462500, 'персонал');
  near(t.current, 445000, 'текущие расходы (СИЗ + амортизация + расходники)');
  near(t.travel, 416000, 'командировочные (пайковые + проживание)');
  near(t.transport, 310000, 'логистика (своя машина + билеты)');
  near(t.equipment_purchase, 21000, 'доля закупки 70 000 × 30%');
  near(t.equipment_purchase_full, 70000, 'полная стоимость вентиляторов — справочно');
  near(t.direct, 5654500, 'прямые');
  near(t.overhead, 565450, 'накладные 10%');
  near(t.contingency, 310997.5, 'непредвиденные 5% (от прямых + накладных)');
  near(t.cost, 6530947.5, 'себестоимость');
  near(t.price_no_vat, 9785921.25, 'цена без НДС (маржа 50%)');
  // D-181: обязательно обе цифры — .68 и .93 (при float-умножении выходило .67 / .92).
  near(t.vat_amount, 2152902.68, 'НДС 22% — копеечная полуграница округлена вверх');
  near(t.price_with_vat, 11938823.93, 'цена с НДС 22%');

  // На оборудование наценка НЕ начисляется — проверяем ПОВЕДЕНЧЕСКИ, а не пересказом формулы
  // движка: маржа обязана быть «наценка только на НЕоборудование», поэтому она РАВНА
  // (cost − equipment) × (markup − 1) и НЕ РАВНА cost × (markup − 1) (разница ровно 0,5 × 21 000).
  const margin = t.price_no_vat - t.cost;
  near(margin, 3254973.75, 'маржа до налога');
  near(margin, (t.cost - t.equipment_purchase) * 0.5, 'маржа = наценка только на необорудование');
  assert.ok(
    Math.abs(margin - t.cost * 0.5) > 1,
    'маржа НЕ равна cost × 0,5 — иначе наценка начислена и на оборудование'
  );
  near(margin * 0.75, 2441230.31, 'чистая прибыль после налога 25%');
  assert.ok(margin * 0.75 >= 2000000, 'чистая прибыль не ниже цели 2 000 000 ₽');
  // Порог согласования директора — 10 млн БЕЗ НДС. На этих вводных не превышен (запас ~214 тыс.),
  // но запас тонкий: ещё одни рабочие сутки дают 10 407 282,38 → согласование включается.
  assert.ok(t.price_no_vat <= 10000000, 'цена без НДС ниже порога директора');
});

check('чистая прибыль и прибыль на чел·смену: движок считает то же, что руками (D-184)', () => {
  const est = server.recalcAsgardSmeta({
    template: 'asgard_v1',
    params: {
      markup: 1.5, material_markup: 1, fot_tax: 0, overhead: 0, contingency: 0, vat: 0.22, income_tax: 0.25,
      work_days: 10, shifts_per_day: 2, workers_per_shift: 2, masters_per_shift: 1
    }
  });
  est.rows.forEach((r) => {
    if (r.kind !== 'line') return;
    r.qty = 0; r.price = 0; r.override = true;
  });
  // B-раздел (текущие расходы) — НЕ материалы, поэтому идёт под общую наценку:
  // себестоимость 1 000 000 → цена без НДС 1 500 000, маржа 500 000, налог 125 000, чистая 375 000.
  Object.assign(est.rows.find((r) => r.id === 'b5'), { qty: 1, price: 1000000, override: true });
  const t = server.recalcAsgardSmeta(est).totals;
  assert.strictEqual(t.cost, 1000000, 'себестоимость');
  assert.strictEqual(t.price_no_vat, 1500000, 'цена без НДС');
  assert.strictEqual(t.margin_rub, 500000, 'маржа = цена без НДС − себестоимость');
  assert.strictEqual(t.income_tax_amount, 125000, 'налог на прибыль 25% от маржи');
  assert.strictEqual(t.net_profit, 375000, 'чистая прибыль = маржа − налог');
  assert.strictEqual(t.income_tax_pct, 25, 'ставка налога отдана в totals');
  assert.strictEqual(t.person_shifts, 10 * 2 * (2 + 1), 'чел·смены = сутки × смены × (рабочие + мастера)');
  assert.strictEqual(t.profit_per_person_shift, Math.round(375000 / 60 * 100) / 100, 'прибыль на чел·смену');
});

check('ставка налога на прибыль настраивается и не влияет на цену (D-184)', () => {
  const mk = (incomeTax) => {
    const est = server.recalcAsgardSmeta({
      template: 'asgard_v1',
      params: { markup: 1.5, material_markup: 1, fot_tax: 0, overhead: 0, contingency: 0, vat: 0.22, income_tax: incomeTax }
    });
    est.rows.forEach((r) => {
      if (r.kind !== 'line') return;
      r.qty = 0; r.price = 0; r.override = true;
    });
    Object.assign(est.rows.find((r) => r.id === 'b5'), { qty: 1, price: 1000000, override: true });
    return server.recalcAsgardSmeta(est).totals;
  };
  const t0 = mk(0);
  const t25 = mk(0.25);
  assert.strictEqual(t0.price_with_vat, t25.price_with_vat, 'налог на прибыль не меняет цену заказчику');
  assert.strictEqual(t0.net_profit, 500000, 'при 0% чистая = маржа');
  assert.strictEqual(t25.net_profit, 375000, 'при 25% чистая = 75% маржи');
  assert.ok(t0.net_profit > t25.net_profit, 'рост налога уменьшает чистую прибыль');
});

check('ставка «25» (проценты) и «0.25» (доля) дают один результат (D-184)', () => {
  const mk = (v) => {
    const est = server.recalcAsgardSmeta({
      template: 'asgard_v1',
      params: { markup: 1.5, material_markup: 1, fot_tax: 0, overhead: 0, contingency: 0, vat: 0.22, income_tax: v }
    });
    est.rows.forEach((r) => {
      if (r.kind !== 'line') return;
      r.qty = 0; r.price = 0; r.override = true;
    });
    Object.assign(est.rows.find((r) => r.id === 'b5'), { qty: 1, price: 1000000, override: true });
    return server.recalcAsgardSmeta(est).totals;
  };
  assert.strictEqual(mk(25).net_profit, mk(0.25).net_profit, 'ratio() нормализует 25 → 0.25');
  assert.strictEqual(mk(25).income_tax_pct, 25, 'в totals ставка всегда в процентах');
});

check('убыток не превращается в «налог»: при отрицательной марже налог = 0 (D-184)', () => {
  const est = server.recalcAsgardSmeta({
    template: 'asgard_v1',
    params: { markup: 1, material_markup: 1, fot_tax: 0, overhead: 0, contingency: 0, vat: 0.22, income_tax: 0.25 }
  });
  est.rows.forEach((r) => {
    if (r.kind !== 'line') return;
    r.qty = 1; r.price = 1000; r.override = true;
  });
  const t = server.recalcAsgardSmeta(est).totals;
  // markup = 1 → цена без НДС = себестоимость, маржа ровно 0.
  assert.strictEqual(t.margin_rub, 0, 'маржа 0');
  assert.strictEqual(t.income_tax_amount, 0, 'налога нет при нулевой марже');
  assert.strictEqual(t.net_profit, 0, 'чистая 0');
  assert.strictEqual(t.profit_per_person_shift, 0, 'прибыль на чел·смену 0, деления на 0 нет');
});

check('строки R8–R10 в смете выводят маржу, налог и ЧИСТУЮ ПРИБЫЛЬ (D-184)', () => {
  const est = server.recalcAsgardSmeta(estimateWithEquipment());
  const r8 = est.rows.find((r) => r.id === 'r_margin');
  const r9 = est.rows.find((r) => r.id === 'r_income_tax');
  const r10 = est.rows.find((r) => r.id === 'r_net');
  assert.ok(r8 && r9 && r10, 'строки R8/R9/R10 дозалиты в старую смету');
  assert.strictEqual(r8.code, 'R8', 'код R8');
  assert.strictEqual(r9.code, 'R9', 'код R9');
  assert.strictEqual(r10.code, 'R10', 'код R10');
  assert.strictEqual(r8.sum, est.totals.margin_rub, 'R8 = маржа');
  assert.strictEqual(r9.sum, est.totals.income_tax_amount, 'R9 = налог');
  assert.strictEqual(r10.sum, est.totals.net_profit, 'R10 = чистая прибыль');
});

check('порог директора берётся из settings, а не из хардкода фронта (D-185)', () => {
  // Фронт получает director_threshold в GET /:id/rp-review и сравнивает с price_no_vat.
  // Здесь проверяем чистую функцию порога на бэке, чтобы логика не разъехалась.
  const { needsDirectorApproval } = require('../src/routes/pm-duty');
  assert.strictEqual(typeof needsDirectorApproval, 'function', 'экспортирована needsDirectorApproval');
  assert.strictEqual(needsDirectorApproval(10000000, 10000000), true, 'ровно порог → согласование нужно');
  assert.strictEqual(needsDirectorApproval(9999999.99, 10000000), false, 'чуть ниже → не нужно');
  assert.strictEqual(needsDirectorApproval(5000000, 3000000), true, 'свой порог 3 млн → 5 млн требует согласия');
  assert.strictEqual(needsDirectorApproval(2999999, 3000000), false, 'ниже своего порога → не требует');
  assert.strictEqual(needsDirectorApproval(null, 10000000), false, 'без цены согласование не включаем');
});

const pending = [];

check('письмо директору: перечень, колонка «Доля, %» и плановые даты на месте', () => {
  const mail = require('../src/services/tender-director-mail');
  const est = server.recalcAsgardSmeta(estimateWithEquipment());
  const html = mail.renderSmetaTableHtml(est);
  assert.ok(html.includes('Доля, %'), 'в письме есть колонка доли');
  assert.ok(html.includes('АВД'), 'справочная строка перечня показана');
  assert.ok(html.includes('справочно'), 'перечень помечен как справочный');
  assert.ok(html.includes('30%'), 'доля закупки показана в процентах');
  assert.ok(html.includes('Начало работ (план)'), 'в шапке письма есть плановая дата начала');
  assert.ok(html.includes('15.10.2026'), 'окончание посчитано (01.10 + 14 сут)');
  assert.ok(html.includes('наценка на оборудование не начисляется'), 'директору объяснено правило 1:1');
});

pending.push(check('Excel-выгрузка: строится с колонкой доли и новыми итогами', async () => {
  const { buildAsgardSmetaXlsx } = require('../src/services/asgard-smeta-xlsx');
  const buf = await buildAsgardSmetaXlsx(estimateWithEquipment());
  assert.ok(Buffer.isBuffer(buf) && buf.length > 5000, 'xlsx собран');
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Смета');
  const texts = [];
  ws.eachRow((row) => row.eachCell((c) => {
    if (c.value != null) texts.push(String(c.formula ? `=${c.formula}` : c.value));
  }));
  const flat = texts.join('\n');
  assert.ok(flat.includes('Доля, %'), 'в Excel есть колонка «Доля, %»');
  assert.ok(flat.includes('IF(F'), 'формула доли применяется (C*E*IF(F…))');
  assert.ok(flat.includes('Начало работ (план):'), 'в шапке есть начало работ');
  assert.ok(flat.includes('Оборудование и техника, итого (G+H)'), 'итог по оборудованию присутствует');
  assert.ok(flat.includes('АВД'), 'перечень оборудования в Excel');
}));

Promise.all(pending).then(() => {
  const failed = results.filter((r) => !r.ok);
  results.forEach((r) => {
    console.log((r.ok ? 'PASS' : 'FAIL') + ' — ' + r.name + (r.ok ? '' : ' :: ' + r.err));
  });
  console.log('');
  console.log(`${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length ? 1 : 0);
});
