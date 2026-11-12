'use strict';
/**
 * visit-plan.js — график заездов из данных анализа. БЕЗ ДЕНЕГ.
 *
 * Задача: одна и та же работа в сентябре и декабре — это ДВЕ позиции и ДВА
 * заезда. Нужно понять, едет бригада на объект один раз на весь объём или
 * приезжает 2–10+ раз, и показать это РП как график (Гант): кто, когда,
 * сколько дней и человеко-часов в каждом заезде.
 *
 * ВАЖНО: здесь НЕ считаются рубли. Деньги (дорога, проживание, пайковые,
 * мобилизация) появляются только в просчёте — там `trip_count` умножает
 * соответствующие строки. Анализ отвечает на вопрос «сколько и когда едем»,
 * просчёт — «сколько это стоит».
 *
 * Источники режима, по приоритету:
 *   1. Модель (`PROMPT-dv-v1.md`) — она читает график в любом виде:
 *      ВОР, отдельный файл «График работ», приложение к ТЗ, таблица, фраза.
 *   2. Детерминированный `schedule-extract.extractVisitPeriods` — подсказка
 *      и страховка, если модель промолчала.
 *   3. Периоды самих позиций ДВ (`period`, `period_start`, `visit_id`).
 * Сомнение или конфликт — `unconfirmed: true` и пробел `schedule_mode`,
 * а не молчаливая догадка.
 */

const scheduleExtract = require('./schedule-extract');

const LUNCH_SHIFT_HOURS = 12;
/** Разрыв ≤ N дней — один заезд (выходные / стык смен). */
const STAY_GAP_DAYS = 3;
/** Доля заполнения календаря, при которой демобилизация бессмысленна. */
const STAY_FILL_RATIO = 0.6;

/**
 * Ключ месяца YYYY-MM из даты или ярлыка периода.
 * Универсально: мойка/сварка/стройка — без привязки к заказчику.
 */
function periodMonthKey(v) {
  const start = String((v && (v.period_start || v.start)) || '').slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(start)) return start;
  const end = String((v && (v.period_end || v.end)) || '').slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(end)) return end;
  const label = String((v && (v.label || v.period)) || '').toLowerCase();
  const months = [
    ['январ', '01'], ['феврал', '02'], ['март', '03'], ['апрел', '04'],
    ['ма[йяею]', '05'], ['июн', '06'], ['июл', '07'], ['август', '08'],
    ['сентябр', '09'], ['октябр', '10'], ['ноябр', '11'], ['декабр', '12']
  ];
  let mm = null;
  for (const [stem, num] of months) {
    if (new RegExp(stem, 'i').test(label)) { mm = num; break; }
  }
  const y = label.match(/(20\d{2})/);
  if (mm && y) return y[1] + '-' + mm;
  if (mm) return 'xxxx-' + mm;
  return null;
}

function daysBetween(aIso, bIso) {
  if (!aIso || !bIso) return null;
  const a = Date.parse(String(aIso).slice(0, 10));
  const b = Date.parse(String(bIso).slice(0, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function calendarWorkDaysInRange(start, end) {
  const s = Date.parse(String(start || '').slice(0, 10));
  const e = Date.parse(String(end || '').slice(0, 10));
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  // Примерно 5/7 календарных суток — рабочие.
  const cal = Math.round((e - s) / 86400000) + 1;
  return Math.max(1, Math.round(cal * 5 / 7));
}

/**
 * Склеить смежные периоды в заезды-пребывания.
 * Период ВОР ≠ автоматически выезд: месяц на 25 суток работ — один заезд.
 *
 * @param {Array} visits — сырые заезды (по периодам)
 * @returns {Array} кластеры
 */
function clusterAdjacentVisits(visits) {
  const list = (Array.isArray(visits) ? visits : [])
    .map((v, i) => Object.assign({}, v, {
      _sort: periodMonthKey(v) || String(v.period_start || '') || ('z' + i)
    }))
    .sort((a, b) => String(a._sort).localeCompare(String(b._sort)));
  if (list.length <= 1) {
    return list.map((v, i) => {
      const out = Object.assign({}, v);
      delete out._sort;
      out.id = out.id || ('v' + (i + 1));
      return out;
    });
  }

  const clusters = [];
  let cur = null;
  for (const v of list) {
    const clean = Object.assign({}, v);
    delete clean._sort;
    if (!cur) {
      cur = Object.assign({}, clean, {
        id: clean.id || 'v1',
        period_labels: [clean.label].filter(Boolean),
        position_ids: Array.isArray(clean.position_ids) ? clean.position_ids.slice() : [],
        positions: Array.isArray(clean.positions) ? clean.positions.slice() : []
      });
      clusters.push(cur);
      continue;
    }
    const gap = daysBetween(cur.period_end, clean.period_start);
    const curKey = periodMonthKey(cur);
    const nextKey = periodMonthKey(clean);
    let consecutiveMonths = false;
    if (curKey && nextKey && /^\d{4}-\d{2}$/.test(curKey) && /^\d{4}-\d{2}$/.test(nextKey)) {
      const [y1, m1] = curKey.split('-').map(Number);
      const [y2, m2] = nextKey.split('-').map(Number);
      consecutiveMonths = (y2 * 12 + m2) - (y1 * 12 + m1) === 1;
    }
    const mergedStart = cur.period_start || clean.period_start;
    const mergedEnd = clean.period_end || cur.period_end;
    const workDays = (Number(cur.work_days) || 0) + (Number(clean.work_days) || 0);
    const calWd = calendarWorkDaysInRange(mergedStart, mergedEnd);
    const filled = calWd > 0 && workDays > 0 ? workDays / calWd : 0;
    const shouldMerge = (gap != null && gap >= 0 && gap <= STAY_GAP_DAYS)
      || (consecutiveMonths && (filled >= STAY_FILL_RATIO || !(Number(clean.work_days) > 0)));

    if (shouldMerge) {
      cur.period_end = clean.period_end || cur.period_end;
      if (!cur.period_start) cur.period_start = clean.period_start;
      cur.period_labels = (cur.period_labels || []).concat(clean.label ? [clean.label] : []);
      cur.label = (cur.period_labels || []).filter(Boolean).join(' → ') || cur.label;
      cur.position_ids = (cur.position_ids || []).concat(clean.position_ids || []);
      cur.positions = (cur.positions || []).concat(clean.positions || []);
      cur.work_days = workDays > 0 ? Math.round(workDays * 10) / 10 : cur.work_days;
      const ph = (Number(cur.person_hours) || 0) + (Number(clean.person_hours) || 0);
      if (ph > 0) cur.person_hours = ph;
      cur.people_peak = Math.max(Number(cur.people_peak) || 0, Number(clean.people_peak) || 0) || cur.people_peak;
    } else {
      cur = Object.assign({}, clean, {
        id: 'v' + (clusters.length + 1),
        period_labels: [clean.label].filter(Boolean),
        position_ids: Array.isArray(clean.position_ids) ? clean.position_ids.slice() : [],
        positions: Array.isArray(clean.positions) ? clean.positions.slice() : []
      });
      clusters.push(cur);
    }
  }
  return clusters.map((c, i) => {
    c.id = c.id || ('v' + (i + 1));
    if (Array.isArray(c.positions) && c.positions.length) {
      return summarizeVisit(c);
    }
    return c;
  });
}

/** Группировка позиций по заездам. */
function groupPositionsByVisit(positions) {
  const list = Array.isArray(positions) ? positions : [];
  const groups = new Map();

  for (let i = 0; i < list.length; i += 1) {
    const p = list[i] || {};
    // Ключ заезда: явный visit_id главнее, потом период.
    let key = String(p.visit_id || '').trim();
    if (!key) {
      const label = String(p.period || '').trim();
      const start = String(p.period_start || '').trim();
      key = label || start;
    }
    if (!key) key = '__none__';

    if (!groups.has(key)) {
      groups.set(key, {
        id: p.visit_id || `v${groups.size + 1}`,
        label: String(p.period || '').trim() || null,
        period_start: p.period_start || null,
        period_end: p.period_end || null,
        position_ids: [],
        positions: []
      });
    }
    const g = groups.get(key);
    g.positions.push(p);
    if (p.id != null) g.position_ids.push(String(p.id));
    g.period_start = g.period_start || p.period_start || null;
    g.period_end = g.period_end || p.period_end || null;
    if (!g.label && p.period) g.label = String(p.period).trim();
  }

  return [...groups.values()].map((g, idx) => {
    if (!g.label) {
      g.label = g.period_start
        ? `с ${g.period_start}`
        : 'без указанного срока';
    }
    if (!g.id || g.id === '__none__') g.id = `v${idx + 1}`;
    return g;
  });
}

/**
 * Трудоёмкость позиции в человеко-часах. Если норма дала work_days и состав
 * бригады — считаем по ним; иначе по объёму, если единица позволяет.
 * Никаких ставок: только часы.
 */
function positionPersonHours(p) {
  const pos = p || {};
  const days = Number(pos.days) || Number(pos.norm && pos.norm.work_days) || null;
  const people = Number(pos.people)
    || Number(pos.norm && pos.norm.crew && (pos.norm.crew.master + pos.norm.crew.exec))
    || null;
  if (days > 0 && people > 0) {
    const shifts = Number(pos.shifts) > 0 ? Number(pos.shifts) : 2;
    return days * people * shifts * LUNCH_SHIFT_HOURS;
  }
  const laborHours = Number(pos.labor_hours) || null;
  if (laborHours > 0) return laborHours;
  return null;
}

function positionWorkDays(p) {
  const pos = p || {};
  const direct = Number(pos.days);
  if (direct > 0) return direct;
  const fromNorm = Number(pos.norm && pos.norm.work_days);
  if (fromNorm > 0) return fromNorm;
  const hours = Number(pos.labor_hours);
  if (hours > 0) {
    const people = Math.max(1, Number(pos.people) || 5);
    const shifts = Number(pos.shifts) > 0 ? Number(pos.shifts) : 2;
    return hours / (people * shifts * LUNCH_SHIFT_HOURS);
  }
  return null;
}

function positionPeoplePeak(p) {
  const pos = p || {};
  const people = Number(pos.people);
  if (people > 0) return people;
  const crew = pos.norm && pos.norm.crew;
  if (crew) {
    const n = (Number(crew.master) || 0) + (Number(crew.exec) || 0);
    if (n > 0) return n;
  }
  return null;
}

/** Сводка по одному заезду: дни, люди, чел·ч, позиции. */
function summarizeVisit(g) {
  const positions = g.positions || [];
  let workDays = 0;
  let personHours = 0;
  let peoplePeak = 0;
  let missingDays = 0;
  let missingHours = 0;

  for (const p of positions) {
    const d = positionWorkDays(p);
    if (d > 0) workDays += d; else missingDays += 1;
    const h = positionPersonHours(p);
    if (h > 0) personHours += h; else missingHours += 1;
    const people = positionPeoplePeak(p);
    if (people > peoplePeak) peoplePeak = people;
  }

  return {
    id: g.id,
    label: g.label,
    period_start: g.period_start || null,
    period_end: g.period_end || null,
    position_ids: g.position_ids,
    positions: positions.length,
    work_days: workDays > 0 ? Math.round(workDays * 10) / 10 : null,
    people_peak: peoplePeak > 0 ? peoplePeak : null,
    person_hours: personHours > 0 ? Math.round(personHours) : null,
    // Сколько позиций без нормы/срока — РП видит, чему верить нельзя.
    incomplete_positions: missingDays || missingHours ? Math.max(missingDays, missingHours) : 0
  };
}

/**
 * Решение о режиме заездов.
 *
 * @param {object} p
 * @param {Array} p.positions — позиции ДВ
 * @param {string} p.text — ТЗ + документы (для детерминированных подсказок)
 * @param {object} p.modelPlan — ответ модели: { schedule_mode, visits, trip_count }
 * @param {object} p.schedule — результат extractSchedule (срок, режим)
 * @returns {{mode, trip_count, visits, source, unconfirmed, conflicts, basis}}
 */
function buildVisitPlan(p) {
  const o = p || {};
  const positions = Array.isArray(o.positions) ? o.positions : [];
  const modelPlan = o.modelPlan || {};
  const docHints = scheduleExtract.extractVisitPeriods(o.text || '');
  const schedule = o.schedule || {};

  const conflicts = [];

  // ── 1. Что говорит модель ────────────────────────────────────────────────
  const modelMode = ['continuous', 'visits', 'unknown'].includes(String(modelPlan.schedule_mode))
    ? String(modelPlan.schedule_mode)
    : null;
  const modelVisits = Array.isArray(modelPlan.visits) ? modelPlan.visits : [];
  const modelTripCount = Number(modelPlan.trip_count) > 0 ? Math.round(Number(modelPlan.trip_count)) : null;

  // ── 2. Что говорит детерминированный разбор ──────────────────────────────
  const docMode = docHints.mode;
  const docVisits = docHints.visits || [];

  // ── 3. Что говорят сами позиции ──────────────────────────────────────────
  const posGroups = groupPositionsByVisit(positions);
  const posWithPeriod = positions.filter((x) => x && (x.visit_id || x.period || x.period_start));
  const posMode = posGroups.length >= 2 && posWithPeriod.length > 0 ? 'visits'
    : (positions.length > 0 && posWithPeriod.length === 0 ? null : 'unknown');

  // ── Приоритет источников ─────────────────────────────────────────────────
  // Модель главнее: она читает документы любого вида. НО её «unknown» — это
  // не решение, а отказ: если детерминированный разбор или сами позиции ДВ
  // уже нашли график, использовать их. Иначе «не определил» перебивало
  // реальные месяцы из документов, и trip_count падал до 1
  // (дефект D4 верификатора 10.11.2026).
  const modelDecided = modelMode && modelMode !== 'unknown';
  const docsDecided = docMode && docMode !== 'unknown';
  const posDecided = posMode && posMode !== 'unknown';

  let mode;
  let source;
  if (modelDecided) {
    mode = modelMode;
    source = 'model';
  } else if (docsDecided) {
    mode = docMode;
    source = 'docs';
  } else if (posDecided) {
    mode = posMode;
    source = 'positions';
  } else {
    mode = 'unknown';
    source = 'none';
  }
  // Если модель сказала «unknown», а документы дали ответ — это не конфликт
  // источников, а отказ модели; пишем пометку для прозрачности.
  if (modelMode === 'unknown' && mode !== 'unknown') {
    conflicts.push({
      kind: 'model_unknown_docs_resolved',
      message: `Модель не определила режим, но документы дают «${mode}». Принят разбор документов.`
    });
  }

  // ТЗ главнее ВОР: если документы требуют непрерывной остановки, а ВОР
  // разбит по месяцам — едем непрерывно, а разбивку показываем справочно.
  const continuousInTz = schedule.mode === 'stop'
    || /остановочн[а-яё]*\s+ремонт|во\s+время\s+остановк/i.test(String(o.text || ''));
  if (continuousInTz && positions.length > 0 && mode !== 'continuous') {
    conflicts.push({
      kind: 'tz_vs_vor',
      message: 'ТЗ говорит о работах в остановку (непрерывно), а в документах есть разбивка по периодам. '
        + 'Режим принят «непрерывный», разбивка показана справочно.',
      resolved_as: 'continuous'
    });
    mode = 'continuous';
    source = 'docs_tz';
  }

  // ── Согласование числа заездов ───────────────────────────────────────────
  let visits = [];
  if (mode === 'visits') {
    if (modelVisits.length) {
      visits = modelVisits.map((v, i) => ({
        id: String(v.id || `v${i + 1}`),
        label: String(v.label || v.period || `Заезд ${i + 1}`).slice(0, 80),
        period_start: v.period_start || null,
        period_end: v.period_end || null,
        position_ids: Array.isArray(v.position_ids) ? v.position_ids.map(String) : []
      }));
    } else if (posGroups.length && posWithPeriod.length) {
      visits = posGroups.map((g) => summarizeVisit(g));
    } else if (docVisits.length) {
      visits = docVisits.map((v, i) => ({
        id: `v${i + 1}`,
        label: v.label || `Заезд ${i + 1}`,
        period_start: v.start || null,
        period_end: v.end || null,
        position_ids: [],
        positions: null,
        work_days: null,
        people_peak: null,
        person_hours: null
      }));
    }

    // mode=visits без содержимого — запрещено: fallback на периоды позиций,
    // иначе unknown + вопрос РП (не пустой visits[]).
    if (!visits.length && posGroups.length && posWithPeriod.length) {
      visits = posGroups.map((g) => summarizeVisit(g));
      conflicts.push({
        kind: 'visits_empty_fallback_periods',
        message: 'Список заездов был пуст — собрали по периодам позиций ДВ.'
      });
    }
    if (!visits.length && positions.length) {
      mode = 'unknown';
      source = source === 'model' ? 'model_empty_visits' : source;
      conflicts.push({
        kind: 'visits_empty',
        message: 'Режим «несколько выездов», но заезды не удалось собрать. Нужен ответ РП.'
      });
      visits = [summarizeVisit({
        id: 'v1',
        label: 'режим не подтверждён',
        position_ids: positions.map((x) => String(x.id)).filter(Boolean),
        positions: positions.slice()
      })];
    } else {
      visits = attachPositionsToVisits(visits, positions);
      // Период ≠ выезд: склеиваем смежные окна в заезды-пребывания.
      visits = clusterAdjacentVisits(visits);
    }
  } else if (mode === 'continuous') {
    // Периоды ВОР остаются подписями внутри одного заезда.
    const periodLabels = [...new Set(
      positions.map((x) => String(x.period || '').trim()).filter(Boolean)
    )].slice(0, 24);
    visits = [summarizeVisit({
      id: 'v1',
      label: periodLabels.length
        ? ('один непрерывный заезд · ' + periodLabels.join(', '))
        : 'один непрерывный заезд',
      period_start: null,
      period_end: null,
      position_ids: positions.map((x) => String(x.id)).filter(Boolean),
      positions: positions.slice(),
      period_labels: periodLabels
    })];
  } else {
    // unknown: показываем одну группу «весь объём», но помечаем вопросом.
    visits = positions.length
      ? [summarizeVisit({
        id: 'v1',
        label: 'режим не подтверждён',
        position_ids: positions.map((x) => String(x.id)).filter(Boolean),
        positions: positions.slice()
      })]
      : [];
  }

  const tripCount = mode === 'visits'
    ? Math.max(1, visits.length || modelTripCount || 1)
    : 1;

  // ── Конфликты и неопределённость ─────────────────────────────────────────
  if (mode === 'unknown') {
    conflicts.push({
      kind: 'mode_unknown',
      message: 'Режим заездов не определён: в документах нет графика и числа выездов. '
        + 'Нужен ответ РП/заказчика — один непрерывный заезд или несколько.'
    });
  }
  if (docMode !== 'unknown' && modelMode && docMode !== modelMode) {
    conflicts.push({
      kind: 'model_vs_docs',
      message: `Модель определила «${modelMode}», документы — «${docMode}». Принят вариант модели.`
    });
  }
  if (mode === 'visits' && modelTripCount && visits.length && modelTripCount !== visits.length) {
    conflicts.push({
      kind: 'trip_count_mismatch',
      message: `Модель назвала ${modelTripCount} заездов, из данных получилось ${visits.length}. Принято ${visits.length}.`
    });
  }

  // unknown ИЛИ visits_empty (mode=visits без содержимого) — вопрос РП.
  const unconfirmed = mode === 'unknown'
    || conflicts.some((c) => c && (c.kind === 'visits_empty' || c.kind === 'visits_empty_fallback_periods'));

  // Итоговые числа для шапки графика.
  const totalWorkDays = visits.reduce((s, v) => s + (Number(v.work_days) || 0), 0);
  const totalPersonHours = visits.reduce((s, v) => s + (Number(v.person_hours) || 0), 0);

  return {
    mode,
    trip_count: tripCount,
    visits,
    source,
    unconfirmed,
    conflicts,
    basis: {
      model_mode: modelMode,
      docs_mode: docMode,
      positions_mode: posMode,
      tz_continuous: continuousInTz,
      doc_months: docHints.months || [],
      explicit_trip_count: docHints.explicit_trip_count || null,
      schedule_days: schedule.days || null
    },
    totals: {
      visits: visits.length,
      work_days: totalWorkDays > 0 ? Math.round(totalWorkDays * 10) / 10 : null,
      person_hours: totalPersonHours > 0 ? Math.round(totalPersonHours) : null,
      positions: positions.length
    },
    // Цитаты из документов — доказательство, откуда взяты периоды.
    quotes: (docHints.quotes || []).slice(0, 8)
  };
}

/** Привязать позиции к заездам по датам/месяцам, если модель не дала position_ids. */
function attachPositionsToVisits(visits, positions) {
  if (!Array.isArray(visits) || !visits.length) return visits;
  const list = Array.isArray(positions) ? positions : [];
  const free = list.filter((p) => p && p.id != null);
  const assigned = new Set();
  for (const v of visits) {
    for (const id of v.position_ids || []) assigned.add(String(id));
  }

  return visits.map((v) => {
    if (Array.isArray(v.position_ids) && v.position_ids.length) {
      // Уже размечено моделью — добираем сводку из позиций.
      const own = list.filter((p) => p && v.position_ids.includes(String(p.id)));
      const sum = summarizeVisit({
        id: v.id, label: v.label,
        period_start: v.period_start, period_end: v.period_end,
        position_ids: v.position_ids, positions: own
      });
      return Object.assign({}, v, sum, { label: v.label });
    }
    // Размечаем по месяцу периода.
    const own = free.filter((p) => {
      if (assigned.has(String(p.id))) return false;
      return sameVisitWindow(p, v);
    });
    own.forEach((p) => assigned.add(String(p.id)));
    const sum = summarizeVisit({
      id: v.id,
      label: v.label,
      period_start: v.period_start,
      period_end: v.period_end,
      position_ids: own.map((p) => String(p.id)),
      positions: own
    });
    return Object.assign({}, v, sum);
  });
}

function sameVisitWindow(p, v) {
  const pStart = String(p.period_start || '').slice(0, 7);
  const vStart = String(v.period_start || '').slice(0, 7);
  if (pStart && vStart && pStart === vStart) return true;
  const pLabel = String(p.period || '').toLowerCase();
  const vLabel = String(v.label || '').toLowerCase();
  if (pLabel && vLabel && (pLabel === vLabel || vLabel.includes(pLabel) || pLabel.includes(vLabel))) {
    return true;
  }
  return false;
}

module.exports = {
  buildVisitPlan,
  groupPositionsByVisit,
  summarizeVisit,
  clusterAdjacentVisits,
  periodMonthKey,
  STAY_GAP_DAYS,
  STAY_FILL_RATIO
};
