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
  // Длина смены в часах. Нужна для человеко-часов в техплане; на деньги не влияет.
  shift_hours: 12,
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
  { key: 'shift_hours', label: 'Часов в смене', unit: 'ч', note: 'для человеко-часов' },
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

/* ─────────────────────────── техплан: бригада и МТР ─────────────────────────── */

/**
 * Роли бригады. `rateKey` — параметр ставки в PARAM_LABELS; если у строки
 * бригады задана своя ставка (`rate`), она главнее.
 *
 * Список фиксированный намеренно: свободный ввод роли ломает группировку в
 * ТКП и в отчёте «сколько кого». Экзотика вписывается в поле note.
 */
const CREW_ROLES = [
  { code: 'itr', label: 'ИТР (РП)', rateKey: 'rate_itr' },
  { code: 'master', label: 'Мастер / бригадир', rateKey: 'rate_master' },
  { code: 'worker', label: 'Слесарь', rateKey: 'rate_worker' },
  { code: 'welder', label: 'Сварщик (НАКС)', rateKey: 'rate_worker' },
  { code: 'insulator', label: 'Изолировщик', rateKey: 'rate_worker' },
  { code: 'assembler', label: 'Монтажник', rateKey: 'rate_worker' },
  { code: 'observer', label: 'Наблюдающий', rateKey: 'rate_worker' },
  { code: 'safety', label: 'Специалист ОТ / высота', rateKey: 'rate_itr' },
  { code: 'driver', label: 'Водитель', rateKey: 'rate_worker' },
  // Химик нужен там, где работают реагентами: промывка, пассивация,
  // нейтрализация. ПТО — на приёмке объёмов и скрытых работ.
  { code: 'chemist', label: 'Химик', rateKey: 'rate_itr' },
  { code: 'pto', label: 'ПТО / приёмка', rateKey: 'rate_itr' }
];

const CREW_ROLE_BY_CODE = CREW_ROLES.reduce((m, r) => { m[r.code] = r; return m; }, {});

/** Источники МТР: со склада (с инв. номером), закупка, аренда. */
const MTR_SOURCES = ['warehouse', 'purchase', 'rent'];

function normalizeShiftMode(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === '24/7') return '24/7';
  if (s === '1' || s === '2' || s === '3') return s;
  const n = Math.round(num(s, 0));
  if (n >= 1 && n <= 3) return String(n);
  return '';
}

function normalizeCrew(crew) {
  if (!Array.isArray(crew)) return [];
  const out = [];
  crew.forEach((c, i) => {
    if (!c) return;
    const code = String(c.code || '').trim()
      || (CREW_ROLE_BY_CODE[String(c.roleCode || '').trim()] ? String(c.roleCode).trim() : '');
    const role = String(c.role || c.name || (CREW_ROLE_BY_CODE[code] && CREW_ROLE_BY_CODE[code].label) || '').trim();
    if (!role) return;
    out.push({
      code: code || ('crew_' + (i + 1)),
      role_code: CREW_ROLE_BY_CODE[code] ? code : '',
      role,
      count: Math.max(0, num(c.count, 0)),
      unit: String(c.unit || 'чел·смен'),
      shifts_per_day: num(c.shifts_per_day, 0) > 0 ? num(c.shifts_per_day) : null,
      // Смены роли заданы явно (числом или флагом) — значит это намерение,
      // и режим объекта их не перебивает. Без флага движок множил ИТР на
      // смены объекта: было 9 чел·смен, стало 18 (верификатор 10.11.2026).
      // Прибивание дефолта живёт не здесь, а в сборке сметы из анализа
      // (pm-duty.js пишет shifts_per_day: null) — это и был корень бага.
      shifts_locked: c.shifts_locked === true || num(c.shifts_locked, 0) > 0
        || num(c.shifts_per_day, 0) > 0,
      hours_per_shift: num(c.hours_per_shift, 0) > 0 ? num(c.hours_per_shift) : null,
      rate: (c.rate != null && c.rate !== '') ? num(c.rate) : null,
      source: c.source === 'hire' ? 'hire' : 'staff',
      employee_ids: Array.isArray(c.employee_ids)
        ? c.employee_ids.map((x) => parseInt(x, 10)).filter((x) => x > 0)
        : [],
      note: String(c.note || '')
    });
  });
  return out;
}

/**
 * Нормализация перечня работ из ведомости (ДВ / calc_plan.positions).
 *
 * ── Зачем это отдельный вход ────────────────────────────────────────────────
 * Движок сметы собирал себестоимость из бригады и срока: ФОТ = люди × сутки ×
 * ставка. Объём работ в деньгах не участвовал вообще, поэтому тендер на 600
 * позиций и тендер на 6 позиций при одинаковой бригаде давали одну и ту же
 * цену — «600 позиций за 10 млн». Смета обязана расти от объёма работ.
 *
 * Каждая строка ведомости несёт либо готовые трудозатраты (дни × люди), либо
 * объём с единицей и норму. Трудозатраты и есть мера объёма: чем больше работ,
 * тем больше чел·смен, и тем больше себестоимость.
 *
 * Поля строки:
 *   name, unit, volume — что и сколько делаем;
 *   people, days      — сколько людей и суток на позицию (из плана Мимира);
 *   labor_hours       — если заказчик дал готовую трудоёмкость (чел·ч);
 *   norm_code, volume_source — откуда цифра (доказательство, а не догадка).
 */
function normalizeWorks(works) {
  if (!Array.isArray(works)) return [];
  const out = [];
  works.forEach((w, i) => {
    if (!w) return;
    const name = String(w.name || w.work || w.description || '').trim();
    if (!name) return;
    const people = num(w.people, 0);
    const days = num(w.days, 0);
    const laborHours = num(w.labor_hours, 0);
    const volume = w.volume != null && w.volume !== '' ? num(w.volume) : null;
    // Без объёма, трудозатрат и людей позиция не даёт ни срока, ни денег —
    // она остаётся справочной строкой, а не молчаливым нулём в смете.
    out.push({
      id: String(w.id || ('w_' + (i + 1))),
      code: String(w.code || ('W' + (i + 1))),
      name: name.slice(0, 300),
      unit: String(w.unit || '').trim(),
      volume,
      people: people > 0 ? people : null,
      days: days > 0 ? days : null,
      labor_hours: laborHours > 0 ? laborHours : null,
      norm_code: w.norm_code ? String(w.norm_code) : null,
      volume_source: w.volume_source ? String(w.volume_source) : null,
      approved: !!w.approved
    });
  });
  return out;
}

/**
 * Блок «Перечень работ по ведомости» — секция W.
 *
 * Почему справочный блок, а не деньги: себестоимость уже считается по ролям и
 * сроку (A1–A6), где срок = люди × сутки из плана. Если добавить работы ещё и
 * отдельной строкой с ценой, объём задвоится. Здесь важны доказательность и
 * сходимость: РП и ТО видят состав работ, объём, источник объёма, людей и сутки
 * — и могут сверить, что именно этот объём превратился в этот срок и эту цену.
 */
function applyWorksRows(rows, works) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  // Убираем прежний блок W: он собирается заново из актуального перечня.
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const r = list[i];
    if (r && (r.id === 'sec_w' || String(r.section) === 'W')) list.splice(i, 1);
  }
  if (!Array.isArray(works) || !works.length) return list;

  const block = [{ id: 'sec_w', kind: 'section', section: 'W', name: 'W. Перечень работ по ведомости (справочно, объём задаёт срок)' }];
  works.forEach((w) => {
    const days = num(w.days, 0);
    const people = num(w.people, 0);
    const laborHours = num(w.labor_hours, 0) || (people > 0 && days > 0 ? people * days * 8 : 0);
    const parts = [];
    if (w.volume != null) parts.push(`${w.volume} ${w.unit || ''}`.trim());
    if (people > 0 && days > 0) parts.push(`${people} чел × ${days} сут`);
    else if (laborHours > 0) parts.push(`${Math.round(laborHours)} чел·ч`);
    if (w.volume_source) parts.push(`источник: ${w.volume_source}`);
    if (w.norm_code) parts.push(`норма ${w.norm_code}`);
    if (w.labor_hours > 0 && people > 0 && days > 0) {
      parts.push(`трудоёмкость заказчика: ${Math.round(w.labor_hours)} чел·ч`);
    }
    block.push({
      id: 'w_' + w.id,
      kind: 'info',
      section: 'W',
      code: w.code,
      name: w.name,
      unit: w.unit || '',
      qty: w.volume,
      price: null,
      sum: null,
      note: parts.join(' · '),
      editable: { name: true, qty: true, note: true }
    });
  });
  return list.concat(block);
}

function normalizeMtr(mtr) {
  if (!Array.isArray(mtr)) return [];
  const out = [];
  mtr.forEach((m, i) => {
    if (!m) return;
    const name = String(m.name || m.equipment || '').trim();
    if (!name) return;
    const src = String(m.source || '').trim();
    out.push({
      code: String(m.code || '').trim() || ('mtr_' + (i + 1)),
      name,
      inventory_number: String(m.inventory_number || m.inventory_no || '').trim(),
      equipment_id: m.equipment_id != null && m.equipment_id !== '' ? parseInt(m.equipment_id, 10) || null : null,
      qty: Math.max(0, num(m.qty, 1)) || 1,
      unit: String(m.unit || 'шт'),
      source: MTR_SOURCES.includes(src) ? src : (m.equipment_id ? 'warehouse' : 'purchase'),
      purpose: String(m.purpose || '').trim(),
      price: (m.price != null && m.price !== '') ? num(m.price) : null,
      note: String(m.note || '')
    });
  });
  return out;
}

function normalizeSchedule(schedule, params) {
  const s = (schedule && typeof schedule === 'object') ? schedule : {};
  const trips = Array.isArray(s.trips)
    ? s.trips.map((t) => ({
      from: String((t && t.from) || '').trim(),
      to: String((t && t.to) || '').trim(),
      days: Math.max(0, num(t && t.days, 0))
    })).filter((t) => t.from || t.to || t.days)
    : [];
  return {
    start_plan: normalizeIsoDate(s.start_plan) || normalizeIsoDate(params && params.start_plan) || null,
    // Срок берём и из params: модалка хранит его там (work_days), а объект
    // schedule часто пустой. Без этой подстановки график во ВСЕХ сметах
    // оказывался с work_days: null — карточка просчёта показывала «срок не
    // задан», хотя срок посчитан и лежит в params (найдено 09.11.2026).
    work_days: num(s.work_days, 0) || num(params && params.work_days, 0) || null,
    trip_count: num(s.trip_count, 0) || num(params && params.trip_count, 0) || null,
    shift_mode: normalizeShiftMode(s.shift_mode) || normalizeShiftMode(params && params.shifts_per_day) || '',
    shift_hours: num(s.shift_hours, 0) || num(params && params.shift_hours, 0) || null,
    trips
  };
}

/** Ставка строки бригады: своя → параметр роли → ставка рабочего. */
function crewRate(c, p) {
  if (c.rate != null) return c.rate;
  const def = CREW_ROLE_BY_CODE[c.role_code];
  const key = def && def.rateKey;
  if (key && p[key] != null) return num(p[key]);
  return num(p.rate_worker);
}

/** Сколько человек в смене по техплану (для СИЗ/пайковых и подписей). */
function crewPerShift(crew, p) {
  if (!crew || !crew.length) return num(p.workers_per_shift) + num(p.masters_per_shift);
  // Сумма людей по ролям. Раньше здесь было `count × (s / shifts)`: при
  // shifts_per_day = 3 и роли с shifts_per_day = 2 получалось 6 × (2/3) = 4,
  // то есть численность «сжималась» и человеко-часы физически не могли вырасти.
  // Человек в смене — это человек в смене; режим влияет на сутки, не на людей.
  let total = 0;
  crew.forEach((c) => {
    total += num(c.count);
  });
  return total;
}

/**
 * Роль Мимира/старой сметы → код роли из CREW_ROLES.
 * Нужна, когда бригада приходит текстом («слесарь-универсал», «мастер»,
 * «сварщик НАКС»), а не структурой. Возвращает '' если роль не распознана —
 * такую строку нельзя молча записывать в «слесаря».
 */
function classifyMobileRole(rawRole) {
  const s = String(rawRole == null ? '' : rawRole).toLowerCase().replace(/ё/g, 'е');
  if (!s.trim()) return '';
  if (/наблюдающ|озп|огневой/.test(s)) return 'observer';
  if (/сварщик|накс/.test(s)) return 'welder';
  if (/изолировщ|термоизол/.test(s)) return 'insulator';
  if (/монтажник|сборщик/.test(s)) return 'assembler';
  if (/водител/.test(s)) return 'driver';
  if (/охрана труда|высот|промбезопасн|промышленн|специалист по от/.test(s)) return 'safety';
  if (/мастер|бригадир|прораб|начальник участка/.test(s)) return 'master';
  if (/итр|инженер|менеджер|руководител/.test(s)) return 'itr';
  if (/слесар|рабоч|исполнит|универсал|оператор|чистильщик/.test(s)) return 'worker';
  return '';
}

/**
 * Короткая сводка техплана для карточек и ТКП: только факты.
 * Возвращает null, если техплана нет — вызывающая сторона решает, что показать.
 */
function describeTechPlan(est) {
  const src = est || {};
  const crew = Array.isArray(src.crew) ? src.crew : [];
  const mtr = Array.isArray(src.mtr) ? src.mtr : [];
  const sch = (src.schedule && typeof src.schedule === 'object') ? src.schedule : {};
  const totals = src.totals || {};
  if (!crew.length && !mtr.length && !sch.work_days) return null;

  const byRole = {};
  crew.forEach((c) => {
    const key = c.role || 'Прочее';
    byRole[key] = (byRole[key] || 0) + num(c.count);
  });

  return {
    work_days: sch.work_days != null ? num(sch.work_days) : null,
    trip_count: sch.trip_count != null ? num(sch.trip_count) : null,
    shift_mode: sch.shift_mode || '',
    shift_hours: sch.shift_hours != null ? num(sch.shift_hours) : null,
    start_plan: sch.start_plan || null,
    man_hours: totals.man_hours != null ? num(totals.man_hours) : null,
    headcount: crew.reduce((s, c) => s + num(c.count), 0),
    roles: Object.keys(byRole).map((role) => ({ role, count: byRole[role] })),
    mtr_count: mtr.length,
    mtr_warehouse: mtr.filter((m) => m.source === 'warehouse').length,
    mtr_purchase: mtr.filter((m) => m.source === 'purchase').length,
    mtr_rent: mtr.filter((m) => m.source === 'rent').length,
    crew,
    mtr
  };
}

/**
 * Разложить техплан по строкам сметы.
 *
 * Правила:
 *  - бригада закрывает строки A1–A6: если в crew[] есть роль из CREW_ROLES,
 *    строка получает количество из техплана (count × смены × сутки) и свою ставку;
 *  - дополнительные роли (сварщик, изолировщик, монтажник, наблюдающий, водитель)
 *    добавляются отдельными строками секции A сразу после A3 — их не было в
 *    скелете, и раньше они либо терялись, либо прятались в «Рабочий»;
 *  - секция F пересобирается из mtr[] (перечень оборудования, справочно).
 *
 * Совместимость: пустой crew[] → строки A остаются на qtyExpr (старый расчёт),
 * пустой mtr[] → секция F остаётся как была (шаблонная строка F1).
 */
function applyTechPlanRows(rows, crew, mtr, p) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const hasCrew = Array.isArray(crew) && crew.length > 0;
  const hasMtr = Array.isArray(mtr) && mtr.length > 0;
  // МТР удалили: строки, созданные из МТР, нельзя оставлять в себестоимости.
  // Убираем только их (tech_from === 'mtr'), шаблонные строки не трогаем.
  if (!hasMtr) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const r = list[i];
      if (r && r.tech_from === 'mtr') list.splice(i, 1);
    }
  }
  if (!hasCrew && !hasMtr) return list;

  const shifts = num(p.shifts_per_day) || 1;
  const days = num(p.work_days);

  if (hasCrew) {
    const byRole = {};
    crew.forEach((c) => {
      if (!c.role_code) return;
      // Одна роль может прийти несколькими строками (по бригадам). Суммируем
      // людей, иначе «2 бригады по 4 слесаря» превращались в одну бригаду 4.
      if (byRole[c.role_code]) {
        byRole[c.role_code] = {
          ...byRole[c.role_code],
          count: num(byRole[c.role_code].count) + num(c.count),
          shifts_per_day: byRole[c.role_code].shifts_per_day || c.shifts_per_day
        };
      } else {
        byRole[c.role_code] = Object.assign({}, c);
      }
    });

    // Режим из шапки техплана. Правка «Смен в сутки» должна доезжать до строк A,
    // даже если в crew[] лежит старое значение: пока РП не задал смены роли ЯВНО
    // (флаг shifts_locked), действует режим объекта.
    const headerShifts = num(p.shifts_per_day) || 1;

    // A1–A4: подставить количество и ставку из техплана.
    list.forEach((r) => {
      if (!r || r.kind !== 'line' || String(r.section) !== 'A') return;
      const roleCode = r.crewRole || (String(r.code) === 'A1' ? 'itr'
        : String(r.code) === 'A2' ? 'master'
          : String(r.code) === 'A3' ? 'worker'
            : String(r.code) === 'A4' ? 'safety' : '');
      if (!roleCode) return;
      const c = byRole[roleCode];
      if (!c) return;
      // Явно заданные смены роли уважаем; иначе режим объекта (см. выше).
      const roleShifts = (c.shifts_locked && num(c.shifts_per_day) > 0)
        ? num(c.shifts_per_day)
        : headerShifts;
      const perRoleDays = days * roleShifts;
      const qty = num(c.count) * perRoleDays;
      r.qty = Math.round(qty * 1000) / 1000;
      r.price = crewRate(c, p);
      r.override = true;
      r.tech_from = 'crew';
      r.note = c.note || r.note || '';
      if (c.count > 0) r.name = c.role || r.name;
    });

    // Дополнительные роли — новыми строками после A3.
    const extra = crew.filter((c) => c.role_code
      && ['welder', 'insulator', 'assembler', 'observer', 'driver', 'chemist', 'pto'].includes(c.role_code));
    if (extra.length) {
      const present = new Set(list.map((r) => r && r.crewRole).filter(Boolean));
      const a3Idx = list.findIndex((r) => r && String(r.code) === 'A3');
      const insertAt = a3Idx >= 0 ? a3Idx + 1 : list.findIndex((r) => r && String(r.section) === 'A');
      const fresh = [];
      // Одна строка на роль, даже если бригад несколько.
      const byExtra = {};
      extra.forEach((c) => {
        if (!byExtra[c.role_code]) byExtra[c.role_code] = Object.assign({}, c, { count: 0 });
        byExtra[c.role_code].count += num(c.count);
        if (c.shifts_locked && num(c.shifts_per_day) > 0) {
          byExtra[c.role_code].shifts_locked = true;
          byExtra[c.role_code].shifts_per_day = num(c.shifts_per_day);
        }
      });
      Object.values(byExtra).forEach((c, i) => {
        if (present.has(c.role_code)) return;
        const roleShifts = (c.shifts_locked && num(c.shifts_per_day) > 0) ? num(c.shifts_per_day) : headerShifts;
        fresh.push({
          id: 'a_crew_' + c.role_code,
          kind: 'line',
          section: 'A',
          code: 'A3.' + (i + 1),
          name: c.role,
          unit: 'чел·смен',
          qty: Math.round(num(c.count) * days * roleShifts * 1000) / 1000,
          price: crewRate(c, p),
          override: true,
          tech_from: 'crew',
          crewRole: c.role_code,
          note: c.note || '',
          editable: { qty: true, price: true, name: true }
        });
      });
      const at = insertAt >= 0 ? insertAt : list.length;
      list.splice(at, 0, ...fresh);
    }
  }

  if (hasMtr) {
    // Убрать прежние строки перечня (в т.ч. шаблонную F1) и собрать из mtr.
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const r = list[i];
      if (!r) continue;
      if (String(r.section) === 'F' && (r.kind === 'info' || r.kind === 'line')) list.splice(i, 1);
    }
    const secFIdx = list.findIndex((r) => r && r.kind === 'section' && String(r.section) === 'F');
    const fresh = mtr.map((m, i) => ({
      id: 'f_mtr_' + (m.code || i),
      kind: 'info',
      section: 'F',
      code: 'F' + (i + 1),
      name: m.name,
      unit: m.unit || 'шт',
      qty: num(m.qty) || 1,
      price: m.price != null ? m.price : 0,
      inventory_number: m.inventory_number || '',
      equipment_id: m.equipment_id || null,
      mtr_source: m.source,
      note: m.purpose || m.note || '',
      tech_from: 'mtr',
      editable: { qty: true, price: true, name: true, note: true }
    }));
    if (secFIdx >= 0) list.splice(secFIdx + 1, 0, ...fresh);
    else list.push(...fresh);
  }

  return list;
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
      crewRole: 'itr', qtyExpr: 'itr_days', priceExpr: 'rate_itr', editable: { qty: true, price: true, name: true } },
    { id: 'a2', kind: 'line', section: 'A', code: 'A2', name: 'Мастер', unit: 'чел·смен',
      crewRole: 'master', qtyExpr: 'master_shifts', priceExpr: 'rate_master', editable: { qty: true, price: true, name: true } },
    { id: 'a3', kind: 'line', section: 'A', code: 'A3', name: 'Рабочий (исполнитель)', unit: 'чел·смен',
      crewRole: 'worker', qtyExpr: 'worker_shifts', priceExpr: 'rate_worker', editable: { qty: true, price: true, name: true } },
    { id: 'a4', kind: 'line', section: 'A', code: 'A4', name: 'Специалист ОТ / высота', unit: 'чел·смен',
      crewRole: 'safety', qty: 0, priceExpr: 'rate_itr', editable: { qty: true, price: true, name: true } },
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
 * Наценка на себестоимость по её величине.
 *
 * ── Почему три ступени ────────────────────────────────────────────────────
 * Единая наценка плохо работает на разных масштабах. Мелкий тендер
 * (до 5 млн) несёт почти те же постоянные издержки продажи и управления,
 * что и крупный, поэтому в процентах они тяжелее — нужна наценка выше.
 * Крупный тендер (свыше 15 млн) идёт на конкурентном рынке, где 50 % сверху
 * просто не пройдут по цене.
 *
 *    до 5 000 000 ₽      → ×1.75
 *    5 000 000–15 000 000 → ×1.50
 *    свыше 15 000 000    → ×1.45
 *
 * Границы — по СЕБЕСТОИМОСТИ (прямые + накладные + непредвиденные), а не по
 * цене: наценка применяется к ней, поэтому определять ступень по цене было бы
 * циклической зависимостью.
 *
 * @param {number} cost — себестоимость в рублях
 * @returns {number} коэффициент наценки
 */
/**
 * Наценка 1.5 из старого дефолта против осознанного выбора.
 *
 * Старый фронт подставлял markup: 1.5 в params автоматически. Отличить это
 * от «РП решил взять 1.5» по величине нельзя, поэтому договорились о флаге:
 * модалка, где РП реально выбирает наценку, ставит markup_chosen: 1.
 *
 * @param {object} rawParams
 * @returns {boolean} true — это наследие, а не решение человека
 */
function isLegacyDefaultMarkup(rawParams) {
  const p = rawParams || {};
  if (num(p.markup_chosen, 0) > 0) return false;
  const v = num(p.markup != null ? p.markup : p.markup_multiplier, 0);
  return Math.abs(v - 1.5) < 0.001;
}

function tieredMarkup(cost) {
  const c = Number(cost) || 0;
  if (c <= 0) return 1.5;
  if (c < 5000000) return 1.75;
  if (c <= 15000000) return 1.5;
  return 1.45;
}

/**
 * Пересчёт сметы. Мутирует копию.
 */
function recalcAsgardSmeta(estimate) {
  const est = JSON.parse(JSON.stringify(estimate || {}));
  est.template = 'asgard_v1';

  // ── Какая наценка ЗАДАНА ЯВНО ─────────────────────────────────────────────
  // Отличаем «РП задал коэффициент руками» от «подставился дефолт».
  //
  // КОРЕНЬ (найдено верификатором): модалка засевает params из DEFAULT_PARAMS,
  // где markup = 1.5. Проверка «markup != null» считала это ручным вводом, и
  // ступенчатая наценка не включалась НИКОГДА: малая смета 1.88 млн шла по
  // 1.5 вместо 1.75, теряя ~470 тыс. в цене.
  //
  // Признак «задано руками» — ЯВНОЕ присутствие ключа в params. Модалка
  // засевает DEFAULT_PARAMS целиком, поэтому её значение нельзя отличить от
  // ручного по величине. Решение: модалка НЕ должна присылать дефолтную
  // наценку (см. rp_calc_modal.js — seed больше не копирует markup).
  // Тогда любое присланное значение = ручной ввод, и его уважаем.
  const rawParams = (estimate && estimate.params) || {};
  const hasMarkupKey = rawParams.markup != null || rawParams.markup_multiplier != null;
  let explicitMarkup = num(
    (rawParams.markup != null ? rawParams.markup : rawParams.markup_multiplier), 0
  );
  // Процентную форму нормализуем ЗДЕСЬ, а не только в mergeParams: иначе
  // явная ветка обходила нормализацию и markup=50 давал ×50 (найдено
  // верификатором: цена 61.5 млн вместо 1.85 млн).
  if (explicitMarkup > 10) explicitMarkup = explicitMarkup / 100 + 1;
  // Замок: наценка уже посчитана при прошлом пересчёте — не пересчитываем,
  // иначе цена «плывёт» между карточкой и письмом.
  const lockedMarkup = num(rawParams.markup_locked, 0) > 0;
  // ── Дефолт старого кода — НЕ ручной ввод ────────────────────────────────
  // Историческая причина массовой недооценки (09.11.2026): старый фронт
  // подставлял в params дефолт `markup: 1.5`. Бэкенд видел ключ и считал это
  // выбором РП, поэтому ступень не применялась: 16 из 20 смет с
  // себестоимостью < 5 млн шли по 1.5 вместо 1.75 — недобор до 1 млн на смету.
  //
  // Важно не перепутать это с ОСОЗНАННЫМ 1.5: тест-эталон Киров Тайр задаёт
  // markup: 1.5 руками и требует именно его. Отличить можно по флагу: фронт,
  // который реально даёт РП выбрать наценку, ставит `markup_chosen: 1`.
  // Наследие старого кода такого флага не ставит — и получает ступень.
  const chosenByHuman = num(rawParams.markup_chosen, 0) > 0;
  const hasExplicit = lockedMarkup || chosenByHuman || (hasMarkupKey && explicitMarkup > 0 && !isLegacyDefaultMarkup(rawParams));

  est.params = mergeParams(est.params);
  const p = est.params;

  // Техплан: бригада, МТР, график. Нормализуем ДО строк — из него строятся A и F.
  est.crew = normalizeCrew(est.crew);
  est.mtr = normalizeMtr(est.mtr);
  est.schedule = normalizeSchedule(est.schedule, p);
  // Перечень работ из ведомости. Деньги идут через роли (A) и срок — работы
  // задают СРОК (люди × сутки), а не вторую себестоимость. Поэтому строки
  // ведомости справочные (kind: 'info'), в суммы не входят.
  est.works = normalizeWorks(est.works);

  if (!Array.isArray(est.rows) || !est.rows.length) {
    est.rows = skeletonRows();
  } else {
    est.rows = mergeSkeletonRows(est.rows);
  }
  est.rows = applyTechPlanRows(est.rows, est.crew, est.mtr, p);
  est.rows = applyWorksRows(est.rows, est.works);

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

  // ── Динамическая наценка по себестоимости ─────────────────────────────────
  // Раньше наценка была единой (1.5). На крупных тендерах это завышает цену:
  // 50 % сверху на 30 млн даёт маржу, которую заказчик не примет, а на мелких
  // наоборот — 50 % не покрывают накладные расходы продажи.
  //
  // Пороги — общее правило расчёта, а не настройка под конкретный тендер:
  //   • до 5 млн      — ×1.75 (мелкие: риск и накладные выше);
  //   • 5–15 млн      — ×1.50 (средние, базовый уровень);
  //   • свыше 15 млн  — ×1.45 (крупные: конкуренция жёстче, маржа тоньше).
  //
  // ЯВНАЯ настройка имеет приоритет: если в params передан `markup` или
  // `markup_multiplier`, коэффициент задан руками (РП или тест) и ступень
  // не применяется. Иначе расчёт молча перебивал бы ручной ввод.
  const effectiveMarkup = hasExplicit ? explicitMarkup : tieredMarkup(cost);
  const pM = { ...p, markup: effectiveMarkup };
  // Фиксируем фактическую наценку в params + ставим замок. Без этого каждый
  // пересчёт сохранённой сметы заново решал бы ступень и цена «плыла»
  // (найдено верификатором: расхождение 307 548 ₽ между карточкой и письмом).
  est.params.markup = effectiveMarkup;
  // Замок ставим ТОЛЬКО когда наценку выбрал человек. Для ступени замка нет:
  // иначе дефолт застывает и при изменении себестоимости ступень не пересчитать.
  if (hasExplicit) est.params.markup_locked = 1;
  const priceNoVat = Math.round(
    (materials * pM.material_markup + equipment + (cost - materials - equipment) * pM.markup) * 100
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
  //
  // Источник — строки A1–A3 после applyTechPlanRows, то есть `count × сутки × смены`
  // из РЕАЛЬНОЙ бригады. Раньше считали от `params.workers_per_shift`, а строки — от
  // `crew[]`: при правке смены знаменатель менялся, а строки A стояли на месте,
  // и «человеко-смены не пересчитываются» (баг 10.11.2026).
  //
  // Фолбэк на параметры обязателен: сметы, собранные по параметрам (без
  // структурной бригады, см. composeFromRecomputed), иначе получали 0 и теряли
  // KPI «прибыль на чел·смену» в модалке, письме директору и тексте сметы.
  const personShiftsFromRows = (est.rows || []).reduce((s, r) => {
    if (!r || r.kind !== 'line' || String(r.section) !== 'A') return s;
    if (r.crewRole !== 'worker' && r.crewRole !== 'master') return s;
    return s + num(r.qty);
  }, 0);
  const personShifts = personShiftsFromRows > 0
    ? personShiftsFromRows
    : (num(p.work_days) * num(p.shifts_per_day)
      * (num(p.workers_per_shift) + num(p.masters_per_shift)));
  const profitPerPersonShift = personShifts > 0
    ? Math.round(netProfit / personShifts * 100) / 100
    : null;

  // Человеко-часы: из техплана, если бригада задана структурно; иначе из параметров.
  const peoplePerShift = crewPerShift(est.crew, p);
  const shiftHours = num(p.shift_hours) > 0 ? num(p.shift_hours) : 12;
  // ── Человеко-часы: сумма по РОЛЯМ, а не «все × режим объекта» ─────────────
  // Формула "work_days × shifts_per_day × люди × часы" считает каждую роль по
  // режиму объекта. Но у ИТР и специалиста ОТ смены фиксированы (1 в сутки),
  // и такой пересчёт давал им лишние смены: 1836 → 1944 ч, ИТР «удваивался»
  // (верификатор 10.11.2026). Считаем по тем же сменам, что стоят в строках A:
  // Σ (qty роли × часы смены). Это ровно те трудозатраты, за которые платим.
  const manHoursFromCrew = (est.crew || []).reduce((s, c) => {
    const roleShifts = (c.shifts_locked && num(c.shifts_per_day) > 0)
      ? num(c.shifts_per_day)
      : (num(p.shifts_per_day) || 1);
    const roleHours = num(c.hours_per_shift) > 0 ? num(c.hours_per_shift) : shiftHours;
    return s + num(c.count) * num(p.work_days) * roleShifts * roleHours;
  }, 0);
  const manHours = Math.round(
    (manHoursFromCrew > 0
      ? manHoursFromCrew
      : num(p.work_days) * num(p.shifts_per_day) * peoplePerShift * shiftHours) * 100
  ) / 100;
  const crewHeadcount = (est.crew || []).reduce((s, c) => s + num(c.count), 0) || peoplePerShift;

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
    man_hours: manHours,
    crew_headcount: crewHeadcount,
    crew_roles: (est.crew || []).length,
    mtr_count: (est.mtr || []).length,
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
    markup: pM.markup,
    margin_pct: Math.round((pM.markup - 1) * 1000) / 10
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

module.exports = {
  DEFAULT_PARAMS,
  PARAM_LABELS,
  CREW_ROLES,
  MTR_SOURCES,
  mergeParams,
  normalizeSharePct,
  normalizeIsoDate,
  addDaysIso,
  normalizeCrew,
  normalizeMtr,
  normalizeWorks,
  normalizeSchedule,
  classifyMobileRole,
  describeTechPlan,
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
