/**
 * ASGARD CRM — техплан просчёта: сроки/заезды, бригада по ролям, МТР.
 * ═══════════════════════════════════════════════════════════════════════════
 * Зачем модуль существует.
 *
 * До него техническая часть просчёта жила «строчками сметы»: «Рабочий
 * (исполнитель)», «АВД 500». Из такой сметы нельзя ответить на вопросы
 * заказчика «сколько человек, кого именно, сколько дней, что за оборудование,
 * со склада или закупаем» — и ТКП выходило однострочным.
 *
 * Что здесь есть:
 *  1. buildTechPlan() — собрать техплан из расчёта Мимира (Quick/Conductor)
 *     и/или из сметы. Ничего не выдумывает: нет данных → пустой массив.
 *  2. matchWarehouse() — подобрать оборудование со склада по названию.
 *     Возвращает КАНДИДАТОВ, а не решение: РП подтверждает.
 *  3. validateTechPlan() — проверить полноту и посчитать человеко-часы.
 *
 * Деньги техплан не считает: суммы живут в смете (asgard-smeta.js).
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const smeta = require('./asgard-smeta');

/* ─────────────────────────── утилиты ─────────────────────────── */

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback);
}

function txt(v) {
  return String(v == null ? '' : v).trim();
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Нормализовать название для сравнения: нижний регистр, ё→е,
 * только буквы/цифры. «АВД-500» и «авд 500» дают одну строку.
 */
function normName(s) {
  return txt(s).toLowerCase().replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ').trim();
}

/** Токены названия без коротких служебных слов. */
function tokens(s) {
  return normName(s).split(' ').filter((t) => t.length >= 3);
}

/* ─────────────────── сроки и график ─────────────────── */

/**
 * Собрать `schedule`. Источники по приоритету:
 *  1. schedule из расчёта Мимира;
 *  2. params сметы (work_days, trip_count, shifts_per_day, shift_hours);
 *  3. meta сметы (work_start_plan, work_duration_days).
 */
function buildSchedule(aiEstimate, est, ctx) {
  const ai = (aiEstimate && typeof aiEstimate === 'object') ? aiEstimate : {};
  const params = (est && est.params) || {};
  const meta = (est && est.meta) || {};
  const c = ctx || {};
  const aiSch = (ai.schedule && typeof ai.schedule === 'object') ? ai.schedule
    : ((ai.tech_plan && ai.tech_plan.schedule) || {});

  const workDays = num(aiSch.work_days, 0) || num(ai.work_days, 0)
    || num(meta.work_duration_days, 0) || num(params.work_days, 0) || null;

  return {
    // Дата старта бывает в schedule, tech_plan.schedule, meta сметы, прямо в
    // estimate (Quick) и в карточке работы/тендера — последнее главнее, потому
    // что это факт из закупки, а не догадка модели.
    start_plan: smeta.normalizeIsoDate(c.work_start_plan)
      || smeta.normalizeIsoDate(aiSch.start_plan)
      || smeta.normalizeIsoDate(ai.start_plan)
      || smeta.normalizeIsoDate(ai.work_start_plan)
      || smeta.normalizeIsoDate(meta.work_start_plan)
      || null,
    work_days: workDays,
    trip_count: num(aiSch.trip_count, 0) || num(ai.trip_count, 0) || num(params.trip_count, 1) || 1,
    shift_mode: txt(aiSch.shift_mode) || String(num(params.shifts_per_day, 0) || '') || '',
    shift_hours: num(aiSch.shift_hours, 0) || num(params.shift_hours, 0) || 12,
    trips: arr(aiSch.trips).map((t) => ({
      from: txt(t && t.from),
      to: txt(t && t.to),
      days: num(t && t.days, 0)
    })).filter((t) => t.from || t.to || t.days)
  };
}

/* ─────────────────── бригада ─────────────────── */

/**
 * Бригада из расчёта Мимира.
 *
 * Мимир отдаёт её в трёх видах (исторически):
 *  - `calculation.personnel[]` — [{ role, count, rate_per_day, days, total }];
 *  - `crew_breakdown` — { executors_per_shift, masters_per_shift, itr, ... };
 *  - Conductor `crew_plan.crew[]` — [{ name, role, ... }] (поимённо).
 *
 * Все три сводим к одному виду. Роль распознаём через classifyMobileRole;
 * нераспознанную роль не выбрасываем, а оставляем как есть (`role_code: ''`),
 * чтобы РП сам назначил — молча потерять человека нельзя.
 */
function buildCrew(aiEstimate) {
  const ai = (aiEstimate && typeof aiEstimate === 'object') ? aiEstimate : {};
  const calc = (ai.calculation && typeof ai.calculation === 'object') ? ai.calculation : {};
  const out = [];
  const push = (role, count, extra) => {
    const c = num(count, 0);
    if (!(c > 0)) return;
    const roleTxt = txt(role) || 'Бригада';
    const code = smeta.classifyMobileRole(roleTxt);
    out.push(Object.assign({
      code: code || ('crew_' + (out.length + 1)),
      role_code: code,
      role: roleTxt,
      count: c,
      shifts_per_day: null,
      hours_per_shift: null,
      rate: null,
      source: 'staff',
      employee_ids: [],
      note: ''
    }, extra || {}));
  };

  // 1) Поимённый или структурированный состав.
  const structured = arr(ai.crew).length ? arr(ai.crew)
    : (arr(ai.crew_plan && ai.crew_plan.crew) || []);
  structured.forEach((c) => {
    if (!c) return;
    const roleTxt = c.role || c.position || c.name;
    const code = smeta.classifyMobileRole(roleTxt);
    push(roleTxt, c.count || 1, {
      role_code: code,
      // ИТР и специалист ОТ заступают на одну смену в сутки, даже если работы
      // идут в две-три: иначе ИТР «удваивается» и ФОТ разъезжается с расчётом.
      // Флаг shifts_locked обязателен: движок сметы уважает смены роли только
      // при нём, иначе режим объекта (2–3 смены) перебивает канон «ИТР = 1».
      shifts_per_day: num(c.shifts_per_day, 0) > 0
        ? num(c.shifts_per_day)
        : (['itr', 'safety'].includes(code) ? 1 : null),
      shifts_locked: num(c.shifts_per_day, 0) > 0 || ['itr', 'safety'].includes(code),
      rate: c.rate != null ? num(c.rate) : null,
      employee_ids: Array.isArray(c.employee_ids) ? c.employee_ids
        : (c.employee_id ? [c.employee_id] : []),
      note: txt(c.note)
    });
  });

  // 2) calculation.personnel[] (Quick).
  if (!out.length) {
    arr(calc.personnel).forEach((p) => {
      if (!p) return;
      const roleTxt = p.role || p.position;
      const code = smeta.classifyMobileRole(roleTxt);
      push(roleTxt, p.count || p.people || 1, {
        role_code: code,
        shifts_per_day: ['itr', 'safety'].includes(code) ? 1 : null,
        rate: p.rate_per_day != null ? num(p.rate_per_day) : null,
        note: txt(p.comment)
      });
    });
  }

  // 3) crew_breakdown (v4-схема) — агрегаты, если ничего подробнее нет.
  if (!out.length) {
    const bd = ai.crew_breakdown || (ai.tech_plan && ai.tech_plan.crew_breakdown) || {};
    push('ИТР (РП)', bd.itr != null ? bd.itr : (bd.itr_count || 0));
    push('Мастер / бригадир', bd.masters_per_shift || bd.foremen_per_shift || 0);
    push('Слесарь', bd.executors_per_shift || 0);
    push('Наблюдающий', bd.observers_per_shift || 0);
    push('Спасатель', bd.rescuers_per_shift || 0);
  }

  // 4) Совсем нет данных — берём из параметров сметы (как считалось раньше).
  if (!out.length) {
    const p = (aiEstimate && aiEstimate.params) || {};
    push('ИТР (РП)', 1);
    push('Мастер / бригадир', num(p.masters_per_shift, 0));
    push('Слесарь', num(p.workers_per_shift, 0));
  }
  // Схлопнуть одинаковые роли (Мимир любит повторять «Слесарь» строками).
  const merged = [];
  out.forEach((c) => {
    const key = (c.role_code || '') + '|' + normName(c.role);
    const hit = merged.find((m) => m.__key === key);
    if (hit) {
      hit.count += c.count;
      if (!hit.rate && c.rate) hit.rate = c.rate;
      hit.employee_ids = hit.employee_ids.concat(c.employee_ids);
      return;
    }
    merged.push(Object.assign({ __key: key }, c));
  });
  return merged.map((m) => { delete m.__key; return m; });
}

/* ─────────────────── МТР ─────────────────── */

/**
 * Список МТР из расчёта Мимира.
 *
 * Источники: `tech_plan.mtr[]`, `equipment_needed[]`, `ai.equipment_status`.
 * Склад Мимир не назначает сам (AP5 отключил это из-за ложных совпадений) —
 * назначение делает matchWarehouse(), а подтверждает РП.
 */
function buildMtr(aiEstimate) {
  const ai = (aiEstimate && typeof aiEstimate === 'object') ? aiEstimate : {};
  const tp = (ai.tech_plan && typeof ai.tech_plan === 'object') ? ai.tech_plan : {};
  const out = [];
  const add = (name, qty, extra) => {
    if (!txt(name)) return;
    out.push(Object.assign({
      code: 'mtr_' + (out.length + 1),
      name: txt(name),
      inventory_number: '',
      equipment_id: null,
      qty: num(qty, 1) || 1,
      unit: 'шт',
      source: 'purchase',
      purpose: '',
      price: null,
      note: ''
    }, extra || {}));
  };

  arr(tp.mtr).forEach((m) => {
    if (!m) return;
    add(m.name || m.item, m.qty || m.quantity, {
      inventory_number: txt(m.inventory_number || m.inventory_no),
      equipment_id: m.equipment_id ? parseInt(m.equipment_id, 10) : null,
      unit: txt(m.unit) || 'шт',
      source: ['warehouse', 'purchase', 'rent'].includes(txt(m.source)) ? txt(m.source) : 'purchase',
      purpose: txt(m.purpose),
      price: m.price != null ? num(m.price) : null,
      note: txt(m.note)
    });
  });

  // ── mtr_suggestions: контракт модели анализа ─────────────────────────────
  // Модель на этапе анализа возвращает материалы/оборудование в `mtr_suggestions`
  // (промпт PROMPT-dv-v1 просит именно это поле). Нормализатор их сохраняет, но
  // buildMtr читал только `ai_meta.*` — контракт не совпадал, и перечень МТР
  // терялся на переходе «анализ → просчёт». Теперь это равноправный источник.
  arr(ai.mtr_suggestions).forEach((m) => {
    if (!m) return;
    const name = m.name || m.item;
    if (!txt(name)) return;
    if (out.some((x) => normName(x.name) === normName(name))) return;
    add(name, m.qty || m.quantity, {
      unit: txt(m.unit) || 'шт',
      purpose: txt(m.purpose),
      // 'typical' — типовой расходник, 'doc' — из документов тендера.
      // Для сметы оба означают закупку; склад подберётся matchWarehouse.
      source: 'purchase',
      note: txt(m.source === 'typical' ? 'типовой расходник' : 'из документов')
    });
  });

  if (!out.length) {
    const needed = arr(ai.equipment_needed).length ? arr(ai.equipment_needed)
      : arr(ai.equipment_status && ai.equipment_status.to_purchase);
    needed.forEach((e) => {
      if (!e) return;
      add(e.item || e.name, e.quantity || e.qty, {
        purpose: txt(e.purpose),
        price: e.price != null ? num(e.price) : null,
        source: ['warehouse', 'purchase', 'rent'].includes(txt(e.source)) ? txt(e.source) : 'purchase'
      });
    });
  }
  // GAP-4: purchases_needed из анализа/просчёта Мимира
  const purchasesNeeded = arr(ai.purchases_needed).length
    ? arr(ai.purchases_needed)
    : arr(ai.analysis && ai.analysis.purchases_needed);
  purchasesNeeded.forEach((e) => {
    if (!e) return;
    const name = e.item || e.name;
    if (!txt(name)) return;
    if (out.some((m) => normName(m.name) === normName(name))) return;
    add(name, e.quantity || e.qty, {
      purpose: txt(e.purpose || e.reason),
      price: e.price != null ? num(e.price) : (e.cost != null ? num(e.cost) : null),
      source: ['warehouse', 'purchase', 'rent'].includes(txt(e.source)) ? txt(e.source) : 'purchase',
      unit: txt(e.unit) || 'шт'
    });
  });
  return out;
}

/**
 * Подобрать оборудование со склада.
 *
 * Почему кандидат, а не решение: прошлая попытка автоматического матчинга
 * (AP5) была отключена — она подставляла «похожее» оборудование и врала
 * в смете. Здесь другой контракт: возвращаем строку склада + степень
 * совпадения, РП подтверждает одним кликом или отклоняет.
 *
 * @param {Array} mtr — позиции МТР
 * @param {Array} stock — строки склада: { id, name, inventory_number, quantity, unit }
 * @returns {Array} те же позиции с полями match: {score, equipment_id, inventory_number, name} | null
 */
function matchWarehouse(mtr, stock) {
  const rows = arr(stock);
  return arr(mtr).map((m) => {
    const mt = tokens(m.name);
    if (!mt.length) return Object.assign({}, m, { match: null });

    let best = null;
    rows.forEach((s) => {
      const st = tokens(s.name);
      if (!st.length) return;
      let hit = 0;
      mt.forEach((t) => {
        if (st.some((x) => x === t || x.startsWith(t) || t.startsWith(x))) hit += 1;
      });
      if (!hit) return;
      const score = hit / Math.max(mt.length, st.length);
      // Порог 0.5: «АВД 500» ↔ «АВД высокого давления 500» = 2/4 токенов → проходит.
      // «Насос» ↔ «Насос дренажный» = 1/2 → проходит. «АВД» ↔ «Компрессор» — нет.
      if (score < 0.5) return;
      if (!best || score > best.score) {
        best = {
          score: Math.round(score * 100) / 100,
          equipment_id: s.id || null,
          inventory_number: txt(s.inventory_number),
          name: txt(s.name),
          qty_available: s.quantity != null ? num(s.quantity) : null,
          unit: txt(s.unit) || 'шт'
        };
      }
    });

    return Object.assign({}, m, { match: best });
  });
}

/* ─────────────────── сборка и проверка ─────────────────── */

/**
 * Собрать техплан.
 *
 * @param {object} p
 * @param {object} [p.estimate] — расчёт Мимира (estimate_draft / ai_meta)
 * @param {object} [p.smeta] — смета asgard_v1 (для сроков и параметров)
 * @param {Array} [p.stock] — склад (getWarehouseStock), для кандидатов
 * @param {object} [p.ctx] — { work_start_plan, work_end_plan } из карточки
 * @param {string} [p.filledBy] — 'mimir' | 'rp' | 'ai_tkp'
 */
function buildTechPlan(p) {
  const o = p || {};
  const est = o.smeta && typeof o.smeta === 'object' ? o.smeta : {};
  const schedule = buildSchedule(o.estimate, est, o.ctx);
  // Бригада из сметы — источник правды, если она там уже есть (РП правил её
  // на вкладке «Бригада и МТР», или её собрал Мимар). Расчёт Мимира
  // используется только когда сметной бригады нет.
  let crew;
  if (Array.isArray(est.crew) && est.crew.length) {
    crew = smeta.normalizeCrew(est.crew);
  } else {
    crew = buildCrew(Object.assign({ params: est.params }, o.estimate || {}));
  }
  let mtr = buildMtr(o.estimate);
  if (!mtr.length && Array.isArray(est.mtr) && est.mtr.length) {
    mtr = smeta.normalizeMtr(est.mtr);
  }
  if (Array.isArray(o.stock) && o.stock.length) mtr = matchWarehouse(mtr, o.stock);

  // Кандидат склада сохраняется как предложение, но source остаётся 'purchase':
  // решение принимает РП. Иначе система сама «возьмёт» чужое оборудование,
  // а это ровно тот дефект, из-за которого AP5 отключали.
  mtr = mtr.map((m) => {
    if (!m.match) return m;
    return Object.assign({}, m, {
      suggested: {
        equipment_id: m.match.equipment_id,
        inventory_number: m.match.inventory_number,
        name: m.match.name,
        score: m.match.score,
        qty_available: m.match.qty_available
      }
    });
  });

  const plan = {
    schedule,
    crew,
    mtr,
    man_hours_total: null,
    filled_by: txt(o.filledBy) || 'mimir',
    updated_at: new Date().toISOString()
  };
  plan.man_hours_total = computeManHours(plan, est.params);
  return plan;
}

/** Человеко-часы по техплану. */
function computeManHours(plan, params) {
  const p = params || {};
  const sch = (plan && plan.schedule) || {};
  const days = num(sch.work_days, 0);
  const shifts = num(sch.shift_mode, 0) || num(p.shifts_per_day, 0) || 1;
  const hours = num(sch.shift_hours, 0) || num(p.shift_hours, 0) || 12;
  const crew = arr(plan && plan.crew);
  if (!(days > 0) || !crew.length) return null;
  let total = 0;
  crew.forEach((c) => {
    const roleShifts = num(c.shifts_per_day, 0) || shifts;
    total += num(c.count) * days * roleShifts * hours;
  });
  return Math.round(total * 100) / 100;
}

/**
 * Проверить полноту техплана.
 *
 * Возвращает {ok, missing[], warnings[]}. `ok:false` НЕ блокирует просчёт:
 * РП должен увидеть, чего не хватает, и дозаполнить. Блокировать сохранение
 * деньгами здесь нельзя — техплан обогащение, а не источник суммы.
 */
function validateTechPlan(plan) {
  const p = plan || {};
  const sch = p.schedule || {};
  const crew = arr(p.crew);
  const mtr = arr(p.mtr);
  const missing = [];
  const warnings = [];

  if (!num(sch.work_days, 0)) missing.push('schedule.work_days');
  if (!txt(sch.shift_mode)) missing.push('schedule.shift_mode');
  if (!num(sch.shift_hours, 0)) missing.push('schedule.shift_hours');
  if (!crew.length) missing.push('crew');
  if (!mtr.length) missing.push('mtr');

  crew.forEach((c, i) => {
    if (!(num(c.count, 0) > 0)) warnings.push('crew[' + i + ']: не указано количество');
    if (!txt(c.role)) warnings.push('crew[' + i + ']: не указана роль');
    if (!c.role_code) warnings.push('crew[' + i + ']: роль «' + txt(c.role) + '» не распознана — выберите из списка');
  });

  mtr.forEach((m, i) => {
    if (!txt(m.name)) warnings.push('mtr[' + i + ']: пустое название');
    if (m.source === 'warehouse' && !txt(m.inventory_number)) {
      warnings.push('mtr[' + i + ']: со склада, но без инвентарного номера');
    }
    if (m.source === 'purchase' && !txt(m.purpose) && !txt(m.note)) {
      warnings.push('mtr[' + i + ']: закупка без назначения — непонятно, зачем');
    }
  });

  const computed = computeManHours(p, {});
  const declared = p.man_hours_total != null ? num(p.man_hours_total) : null;
  if (computed != null && declared != null && Math.abs(computed - declared) > 1) {
    warnings.push('man_hours_total расходится с составом бригады: '
      + declared + ' ≠ ' + computed);
  }

  return { ok: missing.length === 0, missing, warnings };
}

/**
 * Перенести техплан в смету так, чтобы recalc построил строки A/F.
 * Идемпотентно: повторный вызов с тем же планом даёт тот же результат.
 */
function applyToSmeta(est, plan) {
  const src = Object.assign({}, est || {});
  const p = plan || {};
  if (p.schedule) src.schedule = p.schedule;
  if (arr(p.crew).length) src.crew = arr(p.crew);
  if (arr(p.mtr).length) src.mtr = arr(p.mtr);
  if (p.schedule && num(p.schedule.work_days, 0) > 0) {
    src.params = Object.assign({}, src.params || {}, { work_days: num(p.schedule.work_days) });
  }
  if (p.schedule && num(p.schedule.shift_hours, 0) > 0) {
    src.params = Object.assign({}, src.params || {}, { shift_hours: num(p.schedule.shift_hours) });
  }
  // `shift_mode` бывает '24/7', а num('24/7') = 0 — режим молча терялся.
  // Понимаем и строку, и число (см. normalizeShiftMode в движке сметы).
  const shiftModeRaw = String((p.schedule && p.schedule.shift_mode) == null ? '' : p.schedule.shift_mode).trim();
  const shiftModeNum = shiftModeRaw === '24/7' ? 2 : num(shiftModeRaw, 0);
  if (shiftModeNum > 0) {
    src.params = Object.assign({}, src.params || {}, { shifts_per_day: shiftModeNum });
  }
  // GAP-10: даты работ → meta (письмо / Excel / модалка)
  const start = txt(p.schedule && (p.schedule.start_plan || p.schedule.work_start_plan));
  if (start) {
    src.meta = Object.assign({}, src.meta || {}, {
      work_start_plan: start,
      work_duration_days: num(p.schedule.work_days, 0) || (src.meta && src.meta.work_duration_days) || null
    });
  } else if (p.schedule && num(p.schedule.work_days, 0) > 0) {
    src.meta = Object.assign({}, src.meta || {}, {
      work_duration_days: num(p.schedule.work_days)
    });
  }
  return smeta.recalcAsgardSmeta(src);
}

/** Есть ли в техплане хоть что-то содержательное. */
function hasContent(plan) {
  const p = plan || {};
  return arr(p.crew).length > 0
    || arr(p.mtr).length > 0
    || num(p.schedule && p.schedule.work_days, 0) > 0;
}

module.exports = {
  buildTechPlan,
  buildSchedule,
  buildCrew,
  buildMtr,
  matchWarehouse,
  computeManHours,
  validateTechPlan,
  applyToSmeta,
  hasContent,
  _internal: { normName, tokens }
};
