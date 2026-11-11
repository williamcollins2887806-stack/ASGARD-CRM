'use strict';
/**
 * crew-plan.js — состав бригады по позиции и по тендеру.
 *
 * ── Проблема, которую решает ───────────────────────────────────────────────
 * Численность не выводилась ниоткуда: `people` приходил от модели, а состав
 * жёстко достраивался как «1 мастер + 4 слесаря» (CREW_SIZE = 5). В результате
 * 20 человек на позицию давали 4 слесаря и растянутый срок, а наблюдающий
 * ставился «1 на бригаду» вместо «1 на исполнителя внутри аппарата».
 *
 * ── Принцип ───────────────────────────────────────────────────────────────
 * Численность — ПРОИЗВОДНАЯ от объёма и нормы, а не вход. Модель может дать
 * оценку, но она помечается как оценка. Приоритет источников:
 *   норма → ТЗ → геометрия → история → веб → оценка модели → правка РП
 * Правка РП (`crew_locked`) выше всех и не перезаписывается.
 *
 * ── Универсальность ───────────────────────────────────────────────────────
 * Все признаки допуска — данные позиции (`work_scope`, `hazard`), а не regex
 * по названию. Пока поле пустое, работает прежняя эвристика как фолбэк —
 * иначе химпромывка осталась бы без химика (регресс).
 */

/** Роли, которые входят в базовую бригаду (инвариант Σ qty = PS). */
const BASE_ROLES = ['master', 'worker'];

/** Спецроли: дополнительная работа сверх нормы, идут в смету сверх PS. */
const SPECIAL_ROLES = ['welder', 'chemist', 'insulator', 'assembler', 'driver', 'pto', 'safety', 'observer'];

/** Подписи ролей для сметы. */
const ROLE_LABEL = {
  itr: 'ИТР (РП)',
  master: 'Мастер / бригадир',
  worker: 'Слесарь',
  welder: 'Сварщик (НАКС)',
  insulator: 'Изолировщик',
  assembler: 'Монтажник',
  driver: 'Водитель',
  observer: 'Наблюдающий',
  safety: 'Специалист ОТ',
  chemist: 'Химик',
  pto: 'ПТО / приёмка'
};

/** Признаки опасности по умолчанию для типа работ. */
const HAZARD_PATTERNS = [
  ['ozp', /(^|[^а-яё])(озп|замкнут[а-яё]*\s+пространств|внутри\s+аппарат|люк[-\s]?лаз)/i],
  ['gas', /(газоопасн|сероводород|h2s|газоанализатор|нкпр)/i],
  ['fire', /(огнев[а-яё]*\s+работ|сварк|резк|наплавк)/i],
  ['height', /(на\s+высот|леса|подмост|верхолаз)/i],
  ['chem', /(кислот|щелоч|реагент|ингибитор|пассивац|нейтрализ)/i]
];

/**
 * Нормализует массив опасностей из ответа модели.
 * @param {*} raw — строка, массив или null
 * @returns {string[]}
 */
function normalizeHazard(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(/[,;|]/);
  const out = [];
  for (const x of arr) {
    const v = String(x || '').toLowerCase().trim();
    if (!v) continue;
    const hit = ['ozp', 'gas', 'fire', 'height', 'chem'].find((h) => v === h || v.startsWith(h));
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/**
 * Область работ: внутри аппарата или снаружи.
 * @param {object} pos
 * @returns {'inside'|'outside'|'unknown'}
 */
function resolveWorkScope(pos) {
  const p = pos || {};
  const explicit = String(p.work_scope || '').toLowerCase().trim();
  if (explicit === 'inside' || explicit === 'outside') return explicit;

  const hay = [p.name, p.tech_equip, p.method_name, p.category_name].filter(Boolean).join(' ').toLowerCase();
  if (!hay) return 'unknown';

  // Явные признаки снаружи — проверяем ПЕРВЫМИ: «аппарат воздушного
  // охлаждения» чистят снаружи, хотя слово «аппарат» есть.
  // ВАЖНО: \w в JS не матчит кириллицу, поэтому класс [а-яё], а не \w.
  if (/аво|воздушн[а-яё]*\s+охлажд|градирн|оребрен|наружн|снаружи/.test(hay)) return 'outside';
  if (/внутри|внутренн|днищ|люк[-\s]?лаз|бункер|резервуар|ёмкост|емкост|котл|барабан|колодец|приям|канал/.test(hay)) return 'inside';
  return 'unknown';
}

/**
 * Опасности позиции: сначала явное поле, затем фолбэк по тексту.
 * Пока `hazard` пуст, эвристика работает — иначе был бы регресс.
 *
 * @param {object} pos
 * @returns {{hazard:string[], source:'field'|'heuristic'|'none'}}
 */
function resolveHazard(pos) {
  const p = pos || {};
  const field = normalizeHazard(p.hazard);
  if (field.length) return { hazard: field, source: 'field' };

  const hay = [p.name, p.tech_equip, p.method_name].filter(Boolean).join(' ');
  if (!hay) return { hazard: [], source: 'none' };
  const found = [];
  for (const [code, re] of HAZARD_PATTERNS) {
    if (re.test(hay)) found.push(code);
  }
  return { hazard: found, source: found.length ? 'heuristic' : 'none' };
}

/**
 * Численность базовой бригады (исполнители + мастер).
 *
 * Приоритет: правка РП → норма → объём → оценка модели.
 *
 * @param {object} p
 * @param {object} p.position — позиция ДВ
 * @param {object} [p.norm] — результат нормы: { crew: { master, exec } }
 * @param {number} [p.crew_span=5] — человек в бригаде
 * @param {number} [p.master_span=4] — слесарей на мастера
 * @returns {{exec:number, master:number, source:string, locked:boolean}}
 */
function resolveBaseCrew(p) {
  const o = p || {};
  const pos = o.position || {};
  const crewSpan = Math.max(2, Number(o.crew_span) || 5);
  const masterSpan = Math.max(1, Number(o.master_span) || 4);

  // Правка РП: не перезаписываем никогда.
  if (pos.crew_locked) {
    const exec = Number(pos.people) > 0 ? Number(pos.people) : null;
    const master = Number(pos.master) > 0 ? Number(pos.master) : null;
    if (exec) {
      return {
        exec,
        master: master || Math.max(1, Math.ceil(exec / masterSpan)),
        source: 'rp',
        locked: true
      };
    }
  }

  // Норма: состав из crew_json.
  const normCrew = o.norm && o.norm.crew;
  if (normCrew) {
    const exec = Number(normCrew.exec) > 0 ? Number(normCrew.exec) : null;
    const master = Number(normCrew.master) > 0 ? Number(normCrew.master) : null;
    if (exec) {
      return {
        exec,
        master: master || Math.max(1, Math.ceil(exec / masterSpan)),
        source: 'norm',
        locked: false
      };
    }
  }

  // Объём: `people` от модели — ЧИСЛО ИСПОЛНИТЕЛЕЙ по позиции (требование
  // заказчика 06.11: «бригада = 1 мастер + 4 слесаря»). Мастер считается
  // СВЕРХ указанных людей, а сама бригада не меньше crew_span.
  //
  // Путаница, которую здесь легко внести: `people` три раза понимали по-
  // разному — как исполнителей, как всю бригаду и как максимум. Ниже
  // закреплено одно значение: ИСПОЛНИТЕЛИ. Тогда people=3 при crew_span=5
  // даёт бригаду 1+4=5 (до штатной численности), а people=10 — 2+8=10.
  const people = Number(pos.people) > 0 ? Number(pos.people) : null;
  if (people) {
    // Требование заказчика 06.11: бригада = 1 мастер + 4 слесаря (5 человек).
    // `people` от модели — численность бригады ЦЕЛИКОМ, включая мастера.
    //
    // Раньше `people` считалось числом ИСПОЛНИТЕЛЕЙ: 5 человек давали
    // 1 мастера + 5 слесарей = 6, раскладка становилась 2+4 при штатных 1+4,
    // и people_total рос с 17 до 32 на одном плане.
    //
    // Если людей БОЛЬШЕ штатной бригады (people=10), это две бригады по 5,
    // а не одна из 10: заказчик требует бригады по 5.
    const crewSpanN = Math.max(2, crewSpan);
    if (people <= crewSpanN) {
      // Меньше нормы не бывает: 3 человека всё равно едут бригадой из 5.
      return {
        exec: crewSpanN - 1,
        master: 1,
        source: pos.crew_source || 'model',
        locked: false
      };
    }
    // Кратно штатной бригаде: 10 человек = 2 бригады по 5.
    const brigades = Math.max(1, Math.round(people / crewSpanN));
    return {
      exec: (crewSpanN - 1) * brigades,
      master: brigades,
      source: pos.crew_source || 'model',
      locked: false
    };
  }

  // Ничего нет — базовая бригада по умолчанию, но это видно по source.
  const exec = Math.max(1, crewSpan - 1);
  return {
    exec,
    master: 1,
    source: 'default',
    locked: false
  };
}

/**
 * Спецроли по признакам допуска.
 *
 * Наблюдающий: 1:1 к исполнителям ВНУТРИ аппарата (приказ 902н), а не «1 на
 * бригаду». Дежурный снаружи при газоопасных — отдельная роль.
 *
 * @param {object} p
 * @param {number} p.exec
 * @param {string} p.scope
 * @param {string[]} p.hazard
 * @param {number} [p.observer_ratio=1]
 * @param {number} [p.duplier_ratio=1]
 * @returns {Array<{role_code:string, count:number, reason:string}>}
 */
function resolveSpecialRoles(p) {
  const o = p || {};
  const exec = Math.max(0, Number(o.exec) || 0);
  const scope = String(o.scope || 'unknown');
  const hazard = Array.isArray(o.hazard) ? o.hazard : [];
  const obsRatio = Number(o.observer_ratio) > 0 ? Number(o.observer_ratio) : 1;
  const dupRatio = Number(o.duplier_ratio) > 0 ? Number(o.duplier_ratio) : 1;

  const out = [];
  const needsObserver = hazard.includes('ozp') || scope === 'inside';
  if (needsObserver && exec > 0) {
    out.push({
      role_code: 'observer',
      count: Math.max(1, Math.ceil(exec * obsRatio)),
      reason: scope === 'inside' ? 'работа внутри аппарата (наряд-допуск)' : 'ОЗП'
    });
  }
  if (hazard.includes('gas') && exec > 0) {
    out.push({
      role_code: 'safety',
      count: Math.max(1, Math.ceil(exec * dupRatio)),
      reason: 'газоопасные работы — дежурный снаружи'
    });
  }
  if (hazard.includes('fire') && exec > 0) {
    out.push({ role_code: 'welder', count: 1, reason: 'огневые/сварочные работы' });
  }
  if (hazard.includes('chem')) {
    out.push({ role_code: 'chemist', count: 1, reason: 'работы с реагентами' });
  }
  return out;
}

/**
 * Полный состав по позиции.
 *
 * @param {object} p
 * @returns {object}
 */
function planPositionCrew(p) {
  const o = p || {};
  const pos = o.position || {};

  const base = resolveBaseCrew({
    position: pos,
    norm: o.norm,
    crew_span: o.crew_span,
    master_span: o.master_span
  });
  const scopeInfo = resolveWorkScope(pos);
  const hazInfo = resolveHazard(pos);

  const specials = resolveSpecialRoles({
    exec: base.exec,
    scope: scopeInfo,
    hazard: hazInfo.hazard,
    observer_ratio: o.observer_ratio,
    duplier_ratio: o.duplier_ratio
  });

  const roles = [
    { role_code: 'master', count: base.master },
    { role_code: 'worker', count: base.exec },
    ...specials.map((s) => ({ role_code: s.role_code, count: s.count, reason: s.reason }))
  ];

  const baseCount = roles
    .filter((r) => BASE_ROLES.includes(r.role_code))
    .reduce((s, r) => s + r.count, 0);
  const specialCount = roles
    .filter((r) => SPECIAL_ROLES.includes(r.role_code))
    .reduce((s, r) => s + r.count, 0);

  return {
    roles,
    // Базовая бригада — то, что входит в инвариант Σ qty = PS.
    base_people: baseCount,
    special_people: specialCount,
    // Пик на смену: все, кто работает одновременно.
    people_shift: baseCount + specialCount,
    // Источники — чтобы РП видел, откуда цифра.
    crew_source: base.source,
    crew_locked: base.locked,
    work_scope: scopeInfo,
    hazard: hazInfo.hazard,
    hazard_source: hazInfo.source,
    // Человеко-часы, если известны: единственный вход для срока.
    mh: Number(pos.mh) > 0 ? Number(pos.mh) : null
  };
}

/**
 * Уровень тендера: ИТР и ПТО — один на объект, а не в каждой бригаде.
 *
 * @param {object} p
 * @param {number} p.positions
 * @param {number} p.crews
 * @param {number} [p.pto_threshold=10]
 * @returns {Array<{role_code:string, count:number, reason:string}>}
 */
function planTenderCrew(p) {
  const o = p || {};
  const positions = Math.max(0, Number(o.positions) || 0);
  const crews = Math.max(1, Number(o.crews) || 1);
  const ptoThreshold = Math.max(1, Number(o.pto_threshold) || 10);

  const out = [{ role_code: 'itr', count: 1, reason: 'один ИТР на все бригады' }];
  if (positions >= ptoThreshold) {
    out.push({ role_code: 'pto', count: 1, reason: 'приёмка объёмных работ' });
  }
  return out;
}

/**
 * Сводка по тендеру: сколько людей в смене и на объекте.
 *
 * @param {object} p
 * @returns {object}
 */
function summarizeCrew(p) {
  const o = p || {};
  const positions = Array.isArray(o.positions) ? o.positions : [];
  const plans = positions.map((pos) => planPositionCrew({
    position: pos,
    norm: pos && pos.norm,
    crew_span: o.crew_span,
    master_span: o.master_span,
    observer_ratio: o.observer_ratio,
    duplier_ratio: o.duplier_ratio
  }));

  // Пиковая смена = максимум по позициям (работы идут по очереди), а не сумма.
  const peopleShiftPeak = plans.reduce((m, x) => Math.max(m, x.people_shift), 0);
  const baseMax = plans.reduce((m, x) => Math.max(m, x.base_people), 0);
  const specialMax = plans.reduce((m, x) => Math.max(m, x.special_people), 0);

  // Признаки по всему тендеру — для уровня тендера (химик один на объект).
  const allHazard = new Set();
  plans.forEach((x) => x.hazard.forEach((h) => allHazard.add(h)));
  const scopes = plans.map((x) => x.work_scope);
  const insideAny = scopes.includes('inside');

  return {
    plans,
    people_shift_peak: peopleShiftPeak,
    base_people_peak: baseMax,
    special_people_peak: specialMax,
    hazard: [...allHazard],
    inside_any: insideAny,
    locked_count: plans.filter((x) => x.crew_locked).length,
    // Сколько позиций оценены «по умолчанию» — РП должен их проверить.
    default_count: plans.filter((x) => x.crew_source === 'default').length
  };
}

module.exports = {
  BASE_ROLES,
  SPECIAL_ROLES,
  ROLE_LABEL,
  normalizeHazard,
  resolveWorkScope,
  resolveHazard,
  resolveBaseCrew,
  resolveSpecialRoles,
  planPositionCrew,
  planTenderCrew,
  summarizeCrew
};
