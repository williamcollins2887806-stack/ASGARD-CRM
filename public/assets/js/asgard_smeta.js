(function (root) {
'use strict';

/**
 * Параметрическая смета Асгарда (шаблон как СМЕТА_СЕГЕЖСКИЙ_ЦБК_v1.xlsx).
 * Чистый recalc + compose из Auto-Estimate + Excel с формулами.
 */

const DEFAULT_PARAMS = {
  shifts_per_day: 2,
  workers_per_shift: 3,
  masters_per_shift: 1,
  work_days: 10,
  road_days: 2,
  mob_days: 4,
  trip_count: 1,
  rate_worker: 5500,
  rate_master: 7000,
  rate_itr: 10000,
  rate_road: 3000,
  meals: 1000,
  lodging: 1250,
  siz: 15000,
  fot_tax: 0.55,
  overhead: 0.10,
  contingency: 0.05,
  consumables_pct: 0.03,
  markup: 1.5,
  material_markup: 1.25,
  vat: 0.22,
  // Налог на прибыль (25 %) — нужен, чтобы показать РП и директору ЧИСТУЮ прибыль,
  // а не только маржу. Ставка предприятия лежит в settings.income_tax_rate.
  income_tax: 0.25
};

const PARAM_LABELS = [
  { key: 'shifts_per_day', label: 'Смен в сутки', unit: 'смен', note: 'режим 24/7' },
  { key: 'workers_per_shift', label: 'Рабочих в смене', unit: 'чел', note: 'вкл. наблюдающего/ОЗП' },
  { key: 'masters_per_shift', label: 'Мастеров в смене', unit: 'чел', note: '' },
  { key: 'work_days', label: 'Рабочих суток', unit: 'сут', note: '' },
  { key: 'road_days', label: 'Дни дороги (в одну сторону)', unit: 'дн', note: 'туда+обратно × trip_count' },
  { key: 'mob_days', label: 'Дни мобилизации/демоб.', unit: 'дн', note: 'на выезд' },
  { key: 'trip_count', label: 'Число выездов бригады', unit: 'шт', note: '' },
  { key: 'rate_worker', label: 'Ставка рабочего', unit: '₽/смена', note: '' },
  { key: 'rate_master', label: 'Ставка мастера', unit: '₽/смена', note: '' },
  { key: 'rate_itr', label: 'Ставка ИТР/РП', unit: '₽/смена', note: '' },
  { key: 'rate_road', label: 'Ставка дня дороги', unit: '₽/чел', note: '' },
  { key: 'meals', label: 'Пайковые', unit: '₽/чел·дн', note: '' },
  { key: 'lodging', label: 'Проживание', unit: '₽/чел·ночь', note: '' },
  { key: 'siz', label: 'СИЗ + спецодежда', unit: '₽/чел', note: '' },
  { key: 'fot_tax', label: 'Налог на ФОТ', unit: 'доля', note: '0.55 = 55%' },
  { key: 'overhead', label: 'Накладные расходы', unit: 'доля', note: 'от прямых' },
  { key: 'contingency', label: 'Непредвиденные', unit: 'доля', note: 'от прямых+накладных' },
  { key: 'markup', label: 'Наценка (markup)', unit: '×', note: 'к себестоимости' },
  { key: 'material_markup', label: 'Наценка на материал', unit: '×', note: 'раздельный сценарий' },
  { key: 'vat', label: 'НДС', unit: 'доля', note: '0.22 = 22%' },
  { key: 'income_tax', label: 'Налог на прибыль', unit: 'доля', note: '0.25 = 25% (для чистой прибыли)' }
];

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function ratio(v, fallback) {
  const n = num(v, fallback);
  // 55 → 0.55; 1.5 остаётся 1.5; 0.55 остаётся
  if (n > 3 && n <= 100) return n / 100;
  return n;
}

/** Доля закупки, входящая в себестоимость: 30 → 0.3, 0.3 → 0.3, пусто → 1, 0 → 0. */
function normalizeSharePct(v) {
  if (v == null || v === '') return 1;
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  if (n <= 0) return 0;
  const frac = n > 1 ? n / 100 : n;
  return Math.min(1, frac);
}

/** YYYY-MM-DD или null. Принимает ISO-таймстемпы и dd.mm.yyyy (старые карточки/письма). */
function normalizeIsoDate(v) {
  const s = String(v == null ? '' : v).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (ru) return `${ru[3]}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}`;
  return null;
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + num(days, 0));
  return d.toISOString().slice(0, 10);
}

function mergeParams(input) {
  const p = { ...DEFAULT_PARAMS, ...(input || {}) };
  for (const k of Object.keys(DEFAULT_PARAMS)) {
    if (p[k] == null || p[k] === '') p[k] = DEFAULT_PARAMS[k];
    else p[k] = num(p[k], DEFAULT_PARAMS[k]);
  }
  p.fot_tax = ratio(p.fot_tax, DEFAULT_PARAMS.fot_tax);
  p.overhead = ratio(p.overhead, DEFAULT_PARAMS.overhead);
  p.contingency = ratio(p.contingency, DEFAULT_PARAMS.contingency);
  p.consumables_pct = ratio(p.consumables_pct, DEFAULT_PARAMS.consumables_pct);
  p.vat = ratio(p.vat, DEFAULT_PARAMS.vat);
  p.income_tax = ratio(p.income_tax, DEFAULT_PARAMS.income_tax);
  if (p.markup > 10) p.markup = p.markup / 100 + 1; // 50% → 1.5
  return p;
}

function evalQtyExpr(expr, p) {
  if (!expr) return null;
  const crew = num(p.workers_per_shift) + num(p.masters_per_shift);
  const trips = num(p.trip_count) || 1;
  const workPerTrip = num(p.work_days) / trips;
  const map = {
    work_days: num(p.work_days),
    shifts: num(p.shifts_per_day),
    workers: num(p.workers_per_shift),
    masters: num(p.masters_per_shift),
    road_days: num(p.road_days),
    mob_days: num(p.mob_days),
    trip_count: trips,
    crew,
    headcount_shift: crew,
    itr_days: num(p.work_days),
    master_shifts: num(p.work_days) * num(p.shifts_per_day) * num(p.masters_per_shift),
    worker_shifts: num(p.work_days) * num(p.shifts_per_day) * num(p.workers_per_shift),
    // (раб+мастер)×смен×дорога×2×выезды
    road_person_days: crew * num(p.shifts_per_day) * num(p.road_days) * 2 * trips,
    // СИЗ: люди на проект ≈ бригада×смен + ИТР
    siz_people: crew * num(p.shifts_per_day) + 1,
    // Пайковые: siz_people × (сут на выезд) × выезды; сут = work/trip + road×2 + mob
    meal_person_days: (crew * num(p.shifts_per_day) + 1) * (workPerTrip + num(p.road_days) * 2 + num(p.mob_days)) * trips,
    // Проживание: crew×shifts × (work/trip + mob) × trips
    lodging_nights: crew * num(p.shifts_per_day) * (workPerTrip + num(p.mob_days)) * trips
  };
  if (Object.prototype.hasOwnProperty.call(map, expr)) return map[expr];
  // Простые выражения a*b*c
  try {
    const safe = String(expr).replace(/[^a-z0-9_.*+\-/() ]/gi, '');
    // eslint-disable-next-line no-new-func
    const fn = new Function('m', `with(m){ return (${safe}); }`);
    const v = fn(map);
    return Number.isFinite(v) ? v : null;
  } catch (_) {
    return null;
  }
}

function evalPriceExpr(expr, p) {
  if (!expr) return null;
  const map = {
    rate_itr: num(p.rate_itr),
    rate_master: num(p.rate_master),
    rate_worker: num(p.rate_worker),
    rate_road: num(p.rate_road),
    meals: num(p.meals),
    lodging: num(p.lodging),
    siz: num(p.siz)
  };
  if (Object.prototype.hasOwnProperty.call(map, expr)) return map[expr];
  return null;
}

function skeletonRows() {
  return [
    { id: 'sec_a', kind: 'section', section: 'A', name: 'A. Персонал' },
    { id: 'a1', kind: 'line', section: 'A', code: 'A1', name: 'ИТР (РП)', unit: 'чел·смен',
      qtyExpr: 'itr_days', priceExpr: 'rate_itr', editable: { qty: true, price: true, name: true } },
    { id: 'a2', kind: 'line', section: 'A', code: 'A2', name: 'Мастер', unit: 'чел·смен',
      qtyExpr: 'master_shifts', priceExpr: 'rate_master', editable: { qty: true, price: true, name: true } },
    { id: 'a3', kind: 'line', section: 'A', code: 'A3', name: 'Рабочий (исполнитель)', unit: 'чел·смен',
      qtyExpr: 'worker_shifts', priceExpr: 'rate_worker', editable: { qty: true, price: true, name: true } },
    { id: 'a4', kind: 'line', section: 'A', code: 'A4', name: 'Специалист ОТ / высота', unit: 'чел·смен',
      qty: 0, priceExpr: 'rate_itr', editable: { qty: true, price: true, name: true } },
    { id: 'a5', kind: 'line', section: 'A', code: 'A5', name: 'Подготовка на складе', unit: 'чел·смен',
      qty: 8, priceExpr: 'rate_worker', editable: { qty: true, price: true, name: true } },
    { id: 'a6', kind: 'line', section: 'A', code: 'A6', name: 'Дни дороги', unit: 'чел·смен',
      qtyExpr: 'road_person_days', priceExpr: 'rate_road', editable: { qty: true, price: true, name: true } },
    { id: 'a_fot', kind: 'subtotal', section: 'A', code: 'A_FOT', name: 'ФОТ, итого', sumOf: 'A_lines' },
    { id: 'a_tax', kind: 'rollup', section: 'A', code: 'A_TAX', name: 'Налог / взносы на ФОТ', sumExpr: 'fot_tax' },
    { id: 'a_tot', kind: 'rollup', section: 'A', code: 'A_TOT', name: 'Персонал, итого', sumExpr: 'personnel' },

    { id: 'sec_b', kind: 'section', section: 'B', name: 'B. Текущие расходы' },
    { id: 'b1', kind: 'line', section: 'B', code: 'B1', name: 'СИЗ + спецодежда', unit: 'чел',
      qtyExpr: 'siz_people', priceExpr: 'siz', editable: { qty: true, price: true, name: true } },
    { id: 'b4', kind: 'line', section: 'B', code: 'B4', name: 'Оборудование (амортизация)', unit: 'компл',
      qty: 1, price: 0, editable: { qty: true, price: true, name: true } },
    { id: 'b5', kind: 'line', section: 'B', code: 'B5', name: 'Расходники / оснастка', unit: 'компл',
      qty: 1, price: 0, editable: { qty: true, price: true, name: true } },
    { id: 'b_tot', kind: 'subtotal', section: 'B', code: 'B_TOT', name: 'Текущие расходы, итого', sumOf: 'B_lines' },

    { id: 'sec_c', kind: 'section', section: 'C', name: 'C. Командировочные' },
    { id: 'c1', kind: 'line', section: 'C', code: 'C1', name: 'Пайковые', unit: 'чел·дн',
      qtyExpr: 'meal_person_days', priceExpr: 'meals', editable: { qty: true, price: true, name: true } },
    { id: 'c2', kind: 'line', section: 'C', code: 'C2', name: 'Проживание', unit: 'чел·ночь',
      qtyExpr: 'lodging_nights', priceExpr: 'lodging', editable: { qty: true, price: true, name: true } },
    { id: 'c_tot', kind: 'subtotal', section: 'C', code: 'C_TOT', name: 'Командировочные, итого', sumOf: 'C_lines' },

    { id: 'sec_d', kind: 'section', section: 'D', name: 'D. Логистика / транспорт' },
    { id: 'd1', kind: 'line', section: 'D', code: 'D1', name: 'Доставка оборудования', unit: 'рейс',
      qty: 2, price: 0, editable: { qty: true, price: true, name: true } },
    { id: 'd2', kind: 'line', section: 'D', code: 'D2', name: 'Проезд персонала', unit: 'чел·поездка',
      qty: 0, price: 0, note: 'Маршрут — в примечании', editable: { qty: true, price: true, name: true } },
    { id: 'd3', kind: 'line', section: 'D', code: 'D3', name: 'Транспорт на объекте', unit: 'рейс',
      qty: 0, price: 0, editable: { qty: true, price: true, name: true } },
    { id: 'd_tot', kind: 'subtotal', section: 'D', code: 'D_TOT', name: 'Транспорт, итого', sumOf: 'D_lines' },

    { id: 'sec_e', kind: 'section', section: 'E', name: 'E. Материалы и реагенты' },
    { id: 'e1', kind: 'line', section: 'E', code: 'E1', name: 'Материалы / реагенты', unit: 'компл',
      qty: 0, price: 0, editable: { qty: true, price: true, name: true } },
    { id: 'e_tot', kind: 'subtotal', section: 'E', code: 'E_TOT', name: 'Материалы и реагенты, итого', sumOf: 'E_lines' },

    // F — перечень планируемого оборудования и техники: справочно, в суммы НЕ входит.
    { id: 'sec_f', kind: 'section', section: 'F', name: 'F. Планируемое оборудование и техника (перечень, справочно)' },
    { id: 'f1', kind: 'info', section: 'F', code: 'F1', name: 'АВД высокого давления', unit: 'шт',
      qty: 1, price: 0, note: 'собственное, вывозим',
      editable: { qty: true, price: true, name: true, note: true } },

    // G — закупка оборудования: в себестоимость входит долей от цены закупки, наценка не начисляется.
    { id: 'sec_g', kind: 'section', section: 'G', name: 'G. Закупка оборудования (доля входит в себестоимость)' },
    { id: 'g1', kind: 'line', section: 'G', code: 'G1', name: 'Оборудование к закупке', unit: 'компл',
      qty: 1, price: 0, sharePct: 1, note: '',
      editable: { qty: true, price: true, name: true, sharePct: true, note: true } },
    { id: 'g_tot', kind: 'subtotal', section: 'G', code: 'G_TOT', name: 'Закупка оборудования (доля в с/с), итого', sumOf: 'G_lines' },

    // H — аренда техники: 1:1, без наценки.
    { id: 'sec_h', kind: 'section', section: 'H', name: 'H. Аренда техники' },
    { id: 'h1', kind: 'line', section: 'H', code: 'H1', name: 'Аренда техники (кран, манипулятор и т.п.)', unit: 'смена',
      qty: 0, price: 0, note: '',
      editable: { qty: true, price: true, name: true, note: true } },
    { id: 'h_tot', kind: 'subtotal', section: 'H', code: 'H_TOT', name: 'Аренда техники, итого', sumOf: 'H_lines' },

    { id: 'r_equip_g', kind: 'rollup', section: 'R', code: 'R0a', name: 'Закупка оборудования (доля), в себестоимости', sumExpr: 'equipment_purchase' },
    { id: 'r_equip_h', kind: 'rollup', section: 'R', code: 'R0b', name: 'Аренда техники, в себестоимости', sumExpr: 'equipment_rental' },
    { id: 'r_equip', kind: 'rollup', section: 'R', code: 'R0', name: 'Оборудование и техника, итого (G+H)', sumExpr: 'equipment' },

    { id: 'r_direct', kind: 'rollup', section: 'R', code: 'R1', name: 'ПРЯМЫЕ ЗАТРАТЫ, ИТОГО', sumExpr: 'direct' },
    { id: 'r_oh', kind: 'rollup', section: 'R', code: 'R2', name: '+ Накладные расходы', sumExpr: 'overhead' },
    { id: 'r_cont', kind: 'rollup', section: 'R', code: 'R3', name: '+ Непредвиденные', sumExpr: 'contingency' },
    { id: 'r_cost', kind: 'rollup', section: 'R', code: 'R4', name: 'СЕБЕСТОИМОСТЬ (без НДС)', sumExpr: 'cost' },
    { id: 'r_price', kind: 'rollup', section: 'R', code: 'R5', name: 'Цена без НДС (наценка)', sumExpr: 'price_no_vat' },
    { id: 'r_vat', kind: 'rollup', section: 'R', code: 'R6', name: 'НДС', sumExpr: 'vat_amount' },
    { id: 'r_total', kind: 'rollup', section: 'R', code: 'R7', name: 'ЦЕНА ЗАКАЗЧИКУ (с НДС)', sumExpr: 'price_with_vat' },
    { id: 'r_margin', kind: 'rollup', section: 'R', code: 'R8', name: 'Маржа (цена без НДС − себестоимость)', sumExpr: 'margin_rub' },
    { id: 'r_income_tax', kind: 'rollup', section: 'R', code: 'R9', name: 'Налог на прибыль', sumExpr: 'income_tax_amount' },
    { id: 'r_net', kind: 'rollup', section: 'R', code: 'R10', name: 'ЧИСТАЯ ПРИБЫЛЬ (после налога)', sumExpr: 'net_profit' }
  ];
}

/**
 * Дозаливает в сохранённую смету строки скелета, которых в ней нет (блоки F/G/H и
 * rollup-и «Оборудование» появились 16.09.2026). Строки Мимира (c_ai_*, d_ai_*, e_ai_*)
 * и правки РП остаются на своих местах, суммы старых строк не меняются.
 * Вызывается из recalcAsgardSmeta — поэтому лечатся и модалка, и письмо, и Excel.
 */
function mergeSkeletonRows(rows) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const skeleton = skeletonRows();
  const present = new Set(list.map((r) => r && r.id));
  for (let i = 0; i < skeleton.length; i += 1) {
    const sk = skeleton[i];
    if (present.has(sk.id)) continue;
    // Вставляем перед ближайшей следующей строкой скелета, которая уже есть в смете.
    let insertAt = list.length;
    for (let j = i + 1; j < skeleton.length; j += 1) {
      const idx = list.findIndex((r) => r && r.id === skeleton[j].id);
      if (idx >= 0) { insertAt = idx; break; }
    }
    list.splice(insertAt, 0, JSON.parse(JSON.stringify(sk)));
    present.add(sk.id);
  }
  return list;
}

/**
 * Пересчёт сметы. Мутирует копию.
 */
function recalcAsgardSmeta(estimate) {
  const est = JSON.parse(JSON.stringify(estimate || {}));
  est.template = 'asgard_v1';
  est.params = mergeParams(est.params);
  const p = est.params;
  if (!Array.isArray(est.rows) || !est.rows.length) {
    est.rows = skeletonRows();
  } else {
    est.rows = mergeSkeletonRows(est.rows);
  }

  // Даты работ: план начала + примерный срок → расчётное окончание (для письма/Excel/модалки).
  const meta = (est.meta && typeof est.meta === 'object') ? est.meta : {};
  meta.work_start_plan = normalizeIsoDate(meta.work_start_plan);
  const durDays = Number(meta.work_duration_days);
  meta.work_duration_days = Number.isFinite(durDays) && durDays > 0 ? Math.round(durDays) : null;
  meta.work_end_plan_calc = (meta.work_start_plan && meta.work_duration_days)
    ? addDaysIso(meta.work_start_plan, meta.work_duration_days)
    : null;
  est.meta = meta;

  const sumSectionLines = (sec) => {
    let s = 0;
    for (const r of est.rows) {
      if (r.kind !== 'line' || r.section !== sec) continue;
      s += num(r.sum);
    }
    return s;
  };

  // 1) линии
  for (const r of est.rows) {
    if (r.kind === 'info') {
      // Справочная строка перечня (блок F): в суммы не входит ни в одном контуре.
      r.qty = (r.qty == null || r.qty === '') ? null : num(r.qty);
      r.price = (r.price == null || r.price === '') ? null : num(r.price);
      r.sum = (r.qty != null && r.price != null) ? Math.round(r.qty * r.price * 100) / 100 : null;
      continue;
    }
    if (r.kind !== 'line') continue;
    if (!r.override) {
      if (r.qtyExpr) {
        const q = evalQtyExpr(r.qtyExpr, p);
        if (q != null) r.qty = Math.round(q * 1000) / 1000;
      }
      if (r.priceExpr) {
        const pr = evalPriceExpr(r.priceExpr, p);
        if (pr != null) r.price = Math.round(pr);
      }
    }
    r.qty = num(r.qty);
    r.price = num(r.price);
    // Доля в себестоимость (блок G): пусто → 1, 30 → 0.3, 0.3 → 0.3.
    if (r.sharePct != null && r.sharePct !== '') r.sharePct = normalizeSharePct(r.sharePct);
    r.sum = Math.round(r.qty * r.price * normalizeSharePct(r.sharePct) * 100) / 100;
  }

  const fot = sumSectionLines('A');
  const current = sumSectionLines('B');
  const travel = sumSectionLines('C');
  // База налога 55% = ФОТ + пайковые (суточные/пайковые — выплата работнику, облагается).
  // Проживание — компенсация расходов, налогом не облагается, поэтому берём только C1.
  const perDiem = (est.rows || []).reduce((s, r) => {
    if (r.kind !== 'line') return s;
    const isPerDiem = r.id === 'c1' || String(r.code || '').toUpperCase() === 'C1';
    return isPerDiem ? s + num(r.sum) : s;
  }, 0);
  const fotTaxBase = fot + perDiem;
  const fotTax = Math.round(fotTaxBase * p.fot_tax * 100) / 100;
  const personnel = fot + fotTax;
  const transport = sumSectionLines('D');
  const materials = sumSectionLines('E');
  // Оборудование и аренда (G+H) — в прямые затраты; наценка на них не начисляется (1:1).
  const equipmentPurchase = sumSectionLines('G');
  const equipmentRental = sumSectionLines('H');
  const equipment = equipmentPurchase + equipmentRental;
  const equipmentPlanned = (est.rows || []).reduce(
    (s, r) => (r.kind === 'info' && r.section === 'F' ? s + num(r.sum) : s), 0
  );
  // Полная цена закупки/аренды — справочно для директора (не входит в себестоимость).
  const fullSum = (sec) => {
    let s = 0;
    for (const r of est.rows) {
      if (r.kind !== 'line' || r.section !== sec) continue;
      s += num(r.qty) * num(r.price);
    }
    return Math.round(s * 100) / 100;
  };
  const equipmentPurchaseFull = fullSum('G');
  const equipmentRentalFull = fullSum('H');
  const direct = personnel + current + travel + transport + materials + equipment;
  const overhead = Math.round(direct * p.overhead * 100) / 100;
  const contingency = Math.round((direct + overhead) * p.contingency * 100) / 100;
  const cost = direct + overhead + contingency;
  const priceNoVat = Math.round(
    (materials * p.material_markup + equipment + (cost - materials - equipment) * p.markup) * 100
  ) / 100;
  // НДС считаем в ЦЕЛЫХ копейках, а не через float-произведение (D-181).
  // `Math.round(priceNoVat * p.vat * 100) / 100` давал ошибку в 1 копейку на полугранице:
  // 9 785 921,25 × 0,22 = 2 152 902,6750, но float-произведение уходит на 1 ULP ниже половины
  // (215290267.49999997) → Math.round давал .67 вместо .68. Переводим цену в копейки (целое),
  // ставку — в базисные пункты (22 % → 2200), поэтому произведение остаётся целым и точным.
  const priceKop = Math.round(priceNoVat * 100);
  const vatBasisPoints = Math.round(p.vat * 10000);
  const vatAmount = Math.round(priceKop * vatBasisPoints / 10000) / 100;
  const priceWithVat = Math.round((priceKop + Math.round(priceKop * vatBasisPoints / 10000))) / 100;

  // Чистая прибыль после налога на прибыль (D-184).
  // Маржа = цена без НДС − себестоимость; налог на прибыль берём с маржи (если она положительна),
  // чистая = маржа − налог. Ставка `income_tax` — доля (0.25), из settings.income_tax_rate.
  const marginRub = Math.round((priceNoVat - cost) * 100) / 100;
  const incomeTaxAmount = marginRub > 0 ? Math.round(marginRub * p.income_tax * 100) / 100 : 0;
  const netProfit = Math.round((marginRub - incomeTaxAmount) * 100) / 100;

  // Чел-смены: сколько человеко-смен оплачено на проекте (рабочие + мастера, по сменам и суткам).
  // Без этой величины «прибыль на чел/смену» показать нечем — она и есть знаменатель.
  const personShifts = num(p.work_days) * num(p.shifts_per_day)
    * (num(p.workers_per_shift) + num(p.masters_per_shift));
  const profitPerPersonShift = personShifts > 0
    ? Math.round(netProfit / personShifts * 100) / 100
    : null;

  const totalsMap = {
    fot, fot_tax: fotTax, fot_tax_base: fotTaxBase, personnel, current, travel, transport, materials,
    equipment_purchase: equipmentPurchase,
    equipment_rental: equipmentRental,
    equipment,
    equipment_planned: equipmentPlanned,
    equipment_purchase_full: equipmentPurchaseFull,
    equipment_rental_full: equipmentRentalFull,
    direct, overhead, contingency, cost,
    price_no_vat: priceNoVat, vat_amount: vatAmount, price_with_vat: priceWithVat,
    margin_rub: marginRub,
    income_tax_amount: incomeTaxAmount,
    net_profit: netProfit,
    person_shifts: personShifts,
    profit_per_person_shift: profitPerPersonShift
  };

  for (const r of est.rows) {
    if (r.kind === 'subtotal' && r.sumOf) {
      const sec = r.section;
      r.sum = sumSectionLines(sec);
      r.qty = null;
      r.price = null;
    }
    if (r.kind === 'rollup' && r.sumExpr && totalsMap[r.sumExpr] != null) {
      r.sum = totalsMap[r.sumExpr];
      r.qty = null;
      r.price = null;
    }
  }

  est.totals = {
    ...totalsMap,
    vat_pct: Math.round(p.vat * 1000) / 10,
    income_tax_pct: Math.round(p.income_tax * 1000) / 10,
    markup: p.markup,
    margin_pct: Math.round((p.markup - 1) * 1000) / 10
  };

  // Совместимость с UI Quick
  est.items = toFlatItems(est);
  est.subtotal = Math.round(cost);
  est.total_without_vat = Math.round(priceNoVat);
  est.total_with_vat = Math.round(priceWithVat);
  est.vat_pct = est.totals.vat_pct;
  est.vat_sum = Math.round(vatAmount);

  return est;
}

function toFlatItems(est) {
  const items = [];
  for (const r of (est.rows || [])) {
    if (r.kind !== 'line') continue;
    if (!(num(r.sum) > 0) && !(num(r.price) > 0)) continue;
    const share = normalizeSharePct(r.sharePct);
    const item = {
      name: r.name,
      unit: r.unit || '',
      qty: num(r.qty),
      price: num(r.price),
      total: num(r.sum),
      section: r.section,
      code: r.code,
      id: r.id
    };
    if (share < 1) {
      item.share_pct = share;
      item.full_total = Math.round(num(r.qty) * num(r.price) * 100) / 100;
    }
    items.push(item);
  }
  // Виртуальные rollup-строки для старого _calcTotals (сумма items = cost)
  const t = est.totals || {};
  if (t.fot_tax > 0) {
    items.push({ name: `ФОТ-налог (${Math.round((est.params?.fot_tax || 0.55) * 100)}%)`, unit: 'усл.', qty: 1, price: Math.round(t.fot_tax), total: Math.round(t.fot_tax), virtual: true });
  }
  // personnel already includes fot+tax via A lines + virtual tax — but A lines only have fot.
  // Old UI summed all items as cost. So we need: A lines + tax + B + C + D + E + overhead + contingency
  if (t.overhead > 0) {
    items.push({ name: `Накладные (${Math.round((est.params?.overhead || 0) * 100)}%)`, unit: 'усл.', qty: 1, price: Math.round(t.overhead), total: Math.round(t.overhead), virtual: true });
  }
  if (t.contingency > 0) {
    items.push({ name: `Непредвиденные (${Math.round((est.params?.contingency || 0) * 100)}%)`, unit: 'усл.', qty: 1, price: Math.round(t.contingency), total: Math.round(t.contingency), virtual: true });
  }
  return items;
}

function toText(est) {
  if (!est) return '(смета пустая)';
  const e = est.template === 'asgard_v1' ? est : recalcAsgardSmeta(est);
  const p = e.params || {};
  const lines = [];
  lines.push('═══ ПАРАМЕТРЫ (редактируемые) ═══');
  for (const meta of PARAM_LABELS) {
    lines.push(`- ${meta.label}: ${p[meta.key]} ${meta.unit || ''}`);
  }
  lines.push('');
  lines.push('═══ КАЛЬКУЛЯЦИЯ ═══');
  for (const r of e.rows || []) {
    if (r.kind === 'section') {
      lines.push(`\n${r.name}`);
      continue;
    }
    if (r.kind === 'info') {
      const ref = num(r.sum) > 0 ? ` ≈ ${Math.round(r.sum).toLocaleString('ru-RU')} ₽ (справочно, в расходы не входит)` : ' (справочно)';
      lines.push(`  ${r.code || ''} ${r.name}: ${r.qty != null ? r.qty : ''} ${r.unit || ''}${ref}`);
      continue;
    }
    if (r.kind === 'line') {
      const share = normalizeSharePct(r.sharePct);
      const shareTxt = share < 1 ? ` (в себестоимость ${Math.round(share * 1000) / 10}%)` : '';
      lines.push(`  ${r.code || ''} ${r.name}: ${r.qty} ${r.unit || ''} × ${r.price} = ${Math.round(r.sum).toLocaleString('ru-RU')} ₽${shareTxt}${r.override ? ' [правка РП]' : ''}`);
    } else if (r.kind === 'subtotal' || r.kind === 'rollup') {
      lines.push(`  → ${r.name}: ${Math.round(num(r.sum)).toLocaleString('ru-RU')} ₽`);
    }
  }
  const t = e.totals || {};
  lines.push('');
  lines.push(`Итого с/с: ${Math.round(t.cost || 0).toLocaleString('ru-RU')} ₽`);
  lines.push(`КП без НДС (×${p.markup}): ${Math.round(t.price_no_vat || 0).toLocaleString('ru-RU')} ₽`);
  lines.push(`КП с НДС ${Math.round((p.vat || 0) * 100)}%: ${Math.round(t.price_with_vat || 0).toLocaleString('ru-RU')} ₽`);
  lines.push(`Маржа: ${Math.round(t.margin_rub || 0).toLocaleString('ru-RU')} ₽`);
  lines.push(`Налог на прибыль ${Math.round((p.income_tax || 0) * 100)}%: ${Math.round(t.income_tax_amount || 0).toLocaleString('ru-RU')} ₽`);
  lines.push(`ЧИСТАЯ ПРИБЫЛЬ: ${Math.round(t.net_profit || 0).toLocaleString('ru-RU')} ₽`);
  if (t.person_shifts > 0 && t.profit_per_person_shift != null) {
    lines.push(`Прибыль на чел·смену: ${Math.round(t.profit_per_person_shift).toLocaleString('ru-RU')} ₽ (чел·смен: ${t.person_shifts})`);
  }
  return lines.join('\n');
}

function pushAiLines(rows, section, list, defaultUnit) {
  const insertBefore = rows.findIndex((r) => r.section === section && (r.kind === 'subtotal' || (r.kind === 'rollup' && r.code && r.code.endsWith('_TOT'))));
  const idx = insertBefore >= 0 ? insertBefore : rows.length;
  let n = 0;
  for (const raw of list || []) {
    const name = raw.description || raw.name || raw.item || raw.role || '';
    const nameL = String(name).trim().toLowerCase();
    if (!nameL || nameL === '<нет>' || nameL === 'нет' || nameL === '-') continue;
    const qty = num(raw.count ?? raw.qty ?? raw.volume_liters, 1);
    const total = num(raw.total ?? raw.amount);
    const price = num(raw.price ?? raw.unit_price ?? raw.rate_per_day ?? (qty > 0 ? total / qty : 0));
    if (!(total > 0) && !(price > 0)) continue;
    n += 1;
    rows.splice(idx + n - 1, 0, {
      id: `${section.toLowerCase()}_ai_${n}_${Date.now()}`,
      kind: 'line',
      section,
      code: `${section}X${n}`,
      name: String(name).slice(0, 200),
      unit: raw.unit || defaultUnit || 'шт',
      qty,
      price: Math.round(price),
      override: true,
      editable: { qty: true, price: true, name: true }
    });
  }
}

/**
 * Собрать asgard_v1 из validateAndRecomputeMath + ai.estimate.
 */
function composeFromRecomputed(ai, recomputed) {
  const settings = (recomputed && recomputed.settings) || {};
  const calc = (recomputed && recomputed.calculation) || {};
  const totals = (recomputed && recomputed.totals) || {};
  const estAi = (ai && ai.estimate) || {};

  const workDays = num(estAi.work_days ?? settings.work_days, DEFAULT_PARAMS.work_days);
  const roadDays = num(estAi.road_days ?? settings.road_days, DEFAULT_PARAMS.road_days);

  // Вытащим бригаду из personnel
  let workers = DEFAULT_PARAMS.workers_per_shift;
  let masters = DEFAULT_PARAMS.masters_per_shift;
  let rateW = DEFAULT_PARAMS.rate_worker;
  let rateM = DEFAULT_PARAMS.rate_master;
  for (const r of calc.personnel || []) {
    const role = String(r.role || r.item || '').toLowerCase();
    const count = num(r.count, 0);
    const rate = num(r.rate_per_day, 0);
    if (/мастер/.test(role) && count > 0) {
      masters = count;
      if (rate > 0) rateM = rate;
    } else if (/рабоч|слесар|исполн/.test(role) && count > 0) {
      workers = count;
      if (rate > 0) rateW = rate;
    }
  }

  const markup = num(totals.markup_multiplier ?? settings.markup_multiplier ?? estAi.markup_multiplier, DEFAULT_PARAMS.markup);

  const params = mergeParams({
    work_days: workDays,
    road_days: roadDays,
    mob_days: num(settings.mob_days, 4),
    trip_count: num(estAi.trip_count ?? settings.trip_count, 1),
    shifts_per_day: num(settings.shifts_per_day, 2),
    workers_per_shift: workers,
    masters_per_shift: masters,
    rate_worker: rateW,
    rate_master: rateM,
    rate_itr: num(settings.itr_rate_per_day, 10000),
    rate_road: num(settings.road_day_rate ?? settings.per_diem_road, 3000),
    meals: num(settings.meals_per_day ?? settings.per_diem_per_day, 1000),
    lodging: num(settings.lodging_per_night, 1250),
    siz: num(settings.siz_per_person, 15000),
    fot_tax: ratio(settings.fot_tax_pct ?? 55, 0.55),
    overhead: ratio(settings.overhead_pct ?? 10, 0.1),
    contingency: ratio(totals.contingency_pct ?? settings.contingency_pct ?? 5, 0.05),
    markup: markup >= 1 ? markup : 1 + markup,
    vat: ratio(totals.vat_pct ?? settings.vat_pct ?? 22, 0.22),
    income_tax: ratio(settings.income_tax_rate ?? totals.income_tax_pct ?? 25, 0.25)
  });

  let rows = skeletonRows();

  // Заполнить B4/B5/D1 из AI current/transport суммами
  const currentSum = (calc.current_costs || []).reduce((s, r) => s + num(r.total), 0);
  const equip = (calc.current_costs || []).filter((r) => /амортиз|оборуд|авд|установ/i.test(String(r.description || r.name || '')));
  const consum = (calc.current_costs || []).filter((r) => !equip.includes(r));
  const b4 = rows.find((r) => r.id === 'b4');
  const b5 = rows.find((r) => r.id === 'b5');
  if (b4) {
    if (equip.length) {
      b4.price = Math.round(equip.reduce((s, r) => s + num(r.total), 0));
      b4.name = equip.map((r) => r.description || r.name).filter(Boolean).join('; ').slice(0, 180) || b4.name;
      b4.override = true;
    } else if (currentSum > 0) {
      b4.price = Math.round(currentSum * 0.7);
      b4.override = true;
    }
  }
  if (b5) {
    if (consum.length) {
      b5.price = Math.round(consum.reduce((s, r) => s + num(r.total), 0));
      b5.override = true;
    } else if (currentSum > 0 && b4) {
      b5.price = Math.max(0, Math.round(currentSum - num(b4.price)));
      b5.override = true;
    }
  }

  // Travel tickets — добавить как линии C (после c2)
  const travelExtra = (calc.travel || []).filter((r) => {
    const n = String(r.description || r.name || '').toLowerCase();
    return /билет|поезд|авиа|такси|транспорт/.test(n) || (!/пайков|прожив/.test(n) && num(r.total) > 0);
  });
  // Не дублируем пайковые/проживание — они из params
  pushAiLines(
    rows,
    'C',
    travelExtra.filter((r) => !/пайков|прожив/i.test(String(r.description || r.name || ''))),
    'чел'
  );

  pushAiLines(rows, 'D', calc.transport || [], 'рейс');
  pushAiLines(rows, 'E', calc.chemistry || [], 'л');

  // Если AI дал точные чел·смены по ролям — override A1–A3
  for (const r of calc.personnel || []) {
    const role = String(r.role || '').toLowerCase();
    const days = num(r.days, workDays);
    const count = num(r.count, 1);
    const rate = num(r.rate_per_day);
    const total = num(r.total);
    const qty = count * days || (rate > 0 ? total / rate : 0);
    let target = null;
    if (/итр|рп|руковод/.test(role)) target = rows.find((x) => x.id === 'a1');
    else if (/мастер/.test(role)) target = rows.find((x) => x.id === 'a2');
    else if (/рабоч|слесар|исполн/.test(role)) target = rows.find((x) => x.id === 'a3');
    else if (/дорог/.test(role)) target = rows.find((x) => x.id === 'a6');
    else if (/склад|подготов/.test(role)) target = rows.find((x) => x.id === 'a5');
    if (target && qty > 0) {
      target.qty = Math.round(qty * 100) / 100;
      if (rate > 0) target.price = Math.round(rate);
      target.override = true;
      if (r.role) target.name = r.role;
    }
  }

  const meta = {
    title: estAi.title || 'Смета — расчёт себестоимости',
    customer: (ai && ai.customer_name) || '',
    object: estAi.object || '',
    executor: 'ООО «АСГАРД-Сервис»',
    terms: estAi.payment_terms || '',
    work_schedule: estAi.deadline || `${workDays} раб.сут; дорога ${roadDays} дн`
  };

  return recalcAsgardSmeta({ template: 'asgard_v1', meta, params, rows });
}

/**
 * Тестовый эталон Сегежи (цифры из xlsx).
 */
function segezhaFixtureParams() {
  return mergeParams({
    shifts_per_day: 2,
    workers_per_shift: 9,
    masters_per_shift: 1,
    work_days: 18,
    road_days: 2,
    mob_days: 4,
    trip_count: 3,
    rate_worker: 6500,
    rate_master: 8000,
    rate_itr: 10000,
    rate_road: 3000,
    meals: 1000,
    lodging: 1500,
    siz: 15000,
    fot_tax: 0.55,
    overhead: 0.15,
    contingency: 0.1,
    markup: 1.5,
    material_markup: 1.25,
    vat: 0.22,
    income_tax: 0.25
  });
}

root.AsgardSmeta = {
  DEFAULT_PARAMS,
  PARAM_LABELS,
  mergeParams,
  normalizeSharePct,
  normalizeIsoDate,
  addDaysIso,
  skeletonRows,
  mergeSkeletonRows,
  recalcAsgardSmeta,
  composeFromRecomputed,
  toFlatItems,
  toText,
  segezhaFixtureParams,
  evalQtyExpr,
  evalPriceExpr
};
})(typeof window !== 'undefined' ? window : globalThis);
