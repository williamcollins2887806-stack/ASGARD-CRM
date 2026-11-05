'use strict';
/**
 * mimir-tender-stages.js — поэтапный анализ и просчёт тендера.
 *
 * Зачем этот сервис (требование заказчика 05.11.2026):
 *   Мимир не должен «вываливать смету» одним прыжком. Он ведёт РП по этапам:
 *   intake → read → clarify → dv → tech → decision → calc_plan → calc_smeta → done.
 *
 *   • clarify — остановился и спросил, если не хватает ТЗ/объёмов. Ответ можно
 *     дать текстом, файлом, «позже» или «продолжить без этого» (waived).
 *   • dv — показывает объёмы не текстом, а как строки сметы: позиция, аппараты,
 *     объём, единица, метод, отложения, технология, источник. Каждую строку
 *     можно согласовать или исправить.
 *   • tech — чем работаем: технология и оснастка по категории.
 *   • decision — подаём / не подаём.
 *   • calc_plan — люди и сроки по каждому аппарату с источником каждой цифры.
 *
 * Состояние живёт в tkp_quick_sessions.stage_state, поэтому закрытие модалки,
 * загрузка документов и возврат продолжают с того же места.
 *
 * Все функции чистые там, где это возможно (preflight, normalizeDv,
 * normalizeCalcPlan), чтобы их можно было проверять без БД.
 */

const STAGES = [
  'intake', 'read', 'clarify', 'dv', 'tech', 'decision',
  'calc_plan', 'calc_smeta', 'done', 'nogo'
];

/**
 * Анализ и просчёт — это РАЗНЫЕ конвейеры, их нельзя держать одной цепочкой.
 *
 * Анализ заканчивается решением «подаём / не подаём». Сметы в анализе нет:
 * РП на этом этапе не считает деньги, он решает, браться ли.
 * Просчёт — отдельный конвейер, который начинается уже после решения «подаём».
 */
const ANALYSIS_STAGES = ['intake', 'read', 'clarify', 'dv', 'tech', 'decision', 'done', 'nogo'];
const CALC_STAGES = ['calc_plan', 'calc_smeta', 'done'];

function isAnalysisStage(s) {
  return ANALYSIS_STAGES.includes(String(s || ''));
}
function isCalcStage(s) {
  return CALC_STAGES.includes(String(s || ''));
}

/** Разрешённые переходы. Вперёд — по одному, назад — к любому пройденному этапу. */
const FORWARD = {
  // intake → dv напрямую: анализ может сразу дать ведомость объёмов,
  // промежуточный «read» в этом случае проходит внутри одного запроса.
  intake: ['read', 'dv', 'clarify', 'nogo'],
  read: ['dv', 'clarify', 'nogo'],
  clarify: ['read', 'dv', 'nogo'],
  dv: ['tech', 'clarify', 'nogo'],
  tech: ['decision', 'dv', 'nogo'],
  // Анализ закрывается решением. В calc_plan ведёт отдельный запуск просчёта.
  decision: ['done', 'tech', 'nogo'],
  calc_plan: ['calc_smeta', 'done'],
  calc_smeta: ['done'],
  // Просчёт запускается из закрытого анализа отдельным действием
  // «Перейти к просчёту» — только если решение «подаём».
  done: ['calc_plan'],
  nogo: []
};

const STAGE_LABELS = {
  intake: 'Приём',
  read: 'Чтение ТЗ',
  clarify: 'Данные',
  dv: 'Объёмы',
  tech: 'Технология',
  decision: 'Решение',
  calc_plan: 'Люди и сроки',
  calc_smeta: 'Смета',
  done: 'Итог',
  nogo: 'Не подаём'
};

function isStage(s) {
  return STAGES.includes(String(s || ''));
}

/**
 * Переход между этапами. Анализ и просчёт — разные конвейеры:
 * внутри каждого идём вперёд по шагам или назад к пройденному,
 * а из анализа в просчёт попасть нельзя — просчёт запускается отдельно.
 */
function canTransition(from, to) {
  if (!isStage(from) || !isStage(to)) return false;
  if (from === to) return true;
  if (to === 'nogo') return isAnalysisStage(from) || from === 'done';

  // Явно разрешённые переходы проверяем ДО запретов: `done → calc_plan`
  // это отдельный запуск просчёта после закрытого анализа.
  const allowed = FORWARD[from] || [];
  if (allowed.includes(to)) return true;

  // Назад — только внутри своего конвейера.
  const iFrom = STAGES.indexOf(from);
  const iTo = STAGES.indexOf(to);
  if (from === 'done' || from === 'nogo') return false;
  if (isAnalysisStage(from) !== isAnalysisStage(to)) return false;
  return iTo >= 0 && iTo < iFrom;
}

function emptyState() {
  return { v: 1, gaps: [], positions: [], calc: { positions: [] }, decision: null };
}

/** Приводит stage_state к известной схеме, не теряя лишние поля. */
function normalizeState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const out = Object.assign(emptyState(), s);
  out.v = Number(out.v) || 1;
  out.gaps = Array.isArray(out.gaps) ? out.gaps : [];
  out.positions = Array.isArray(out.positions) ? out.positions : [];
  out.calc = out.calc && typeof out.calc === 'object' ? out.calc : { positions: [] };
  out.calc.positions = Array.isArray(out.calc.positions) ? out.calc.positions : [];
  return out;
}

// ── Preflight: чего не хватает (детерминированно, без LLM) ───────────────────

/** Ключи объёма, которые понимает калькулятор. */
const VOLUME_KEYS = [
  'surface_m2', 'tubes', 'length_m', 'circuit_m3', 'volume_m3',
  'qty', 'joints', 'apparatus', 'boilers', 'lifts', 'points', 'sections', 'plates_count'
];

/**
 * Проверяет вход и возвращает список пробелов.
 *
 * @param {object} ctx
 * @param {string} [ctx.tz_text] — текстовое ТЗ (из карточки или описания)
 * @param {Array}  [ctx.documents] — документы с полем text/ocr_text
 * @param {object} [ctx.inputs] — объёмы, если уже известны
 * @param {string} [ctx.start_date], [ctx.end_date] — окно работ
 * @param {object} [ctx.schema] — input_schema_json метода
 * @returns {{gaps: Array, blocking: number, ok: boolean}}
 */
function preflight(ctx) {
  const c = ctx || {};
  const gaps = [];
  const docs = Array.isArray(c.documents) ? c.documents : [];
  const docsWithText = docs.filter((d) => String(d && (d.text || d.ocr_text || d.content) || '').trim().length > 40);
  const tz = String(c.tz_text || '').trim();

  if (!tz && docs.length === 0) {
    gaps.push({
      id: 'tz', kind: 'file_or_text', blocking: true,
      label: 'Нет описания работ и документов',
      why: 'Без ТЗ Мимир не может определить ни объём, ни метод.',
      hint: 'Загрузите ТЗ/ведомость или опишите работы текстом.'
    });
  } else if (docs.length > 0 && docsWithText.length === 0) {
    gaps.push({
      id: 'docs_text', kind: 'file', blocking: false,
      label: 'Документы есть, но текст не распознан',
      why: 'Похоже на сканы или архивы без извлекаемого текста.',
      hint: 'Приложите текстовый PDF/DOCX или опишите объёмы вручную.'
    });
  }

  const inputs = c.inputs && typeof c.inputs === 'object' ? c.inputs : {};
  const hasVolume = VOLUME_KEYS.some((k) => Number(inputs[k]) > 0);
  if (!hasVolume && docsWithText.length === 0) {
    gaps.push({
      id: 'volume', kind: 'text', blocking: true,
      label: 'Нет объёмов работ',
      why: 'Без объёма не считается срок и численность бригады.',
      hint: 'Например: «2 котла по 2 м³, отложения кальций» или «480 трубок Ø25×3».'
    });
  }
  if (Number(inputs.cycles) <= 0 && /cip|chem|промыв/i.test(String(c.method || c.method_code || ''))) {
    gaps.push({
      id: 'cycles', kind: 'text', blocking: false,
      label: 'Не указано число циклов промывки',
      why: 'Считаем по одному циклу — при двух-трёх срок вырастет.',
      hint: 'Если циклов больше одного, укажите сколько.'
    });
  }
  if (!c.start_date && !c.end_date) {
    gaps.push({
      id: 'schedule', kind: 'text', blocking: false,
      label: 'Нет сроков работ',
      why: 'Без окна дат нельзя проверить, влезает ли бригада.',
      hint: 'Можно продолжить без этого — сроки уйдут в риски.'
    });
  }
  if (!String(c.contact || '').trim()) {
    gaps.push({
      id: 'contact', kind: 'text', blocking: false,
      label: 'Нет контакта заказчика',
      why: 'Понадобится для уточнений по объёмам и доступам.',
      hint: 'Необязательно на этом этапе.'
    });
  }

  const blocking = gaps.filter((g) => g.blocking).length;
  return { gaps, blocking, ok: blocking === 0 };
}

/** Отметить пробел как закрытый ответом. */
function resolveGap(state, gapId, patch) {
  const s = normalizeState(state);
  const g = s.gaps.find((x) => x.id === gapId);
  if (!g) return s;
  Object.assign(g, patch || {}, { resolved: true });
  return s;
}

/** «Продолжить без этого» — не закрывает, а помечает waived и уводит в риски. */
function waiveGap(state, gapId) {
  const s = normalizeState(state);
  const g = s.gaps.find((x) => x.id === gapId);
  if (!g) return s;
  if (g.blocking) {
    const err = new Error(`Пробел «${g.label}» обязательный — без него расчёт невозможен`);
    err.statusCode = 400;
    throw err;
  }
  g.waived = true;
  g.resolved = true;
  return s;
}

// ── ДВ: позиции ─────────────────────────────────────────────────────────────

function isFinitePositive(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

/**
 * Нормализует позиции ДВ из ответа модели.
 * Правила:
 *   • объём > 0 и единица — обязательны, иначе позиция уходит в needs_input;
 *   • category/method не выдумываются: если метода нет в каталоге — needs_classification;
 *   • позиции без категории не выбрасываются молча, РП должен их увидеть.
 *
 * @param {object} ai — ответ модели ({ positions, objects, decision_recommend })
 * @param {object} catalog — { categories: [{ code, methods_json }] }
 */
function normalizeDv(ai, catalog) {
  const raw = ai && typeof ai === 'object' ? ai : {};
  const list = Array.isArray(raw.positions) ? raw.positions : [];
  const objectsRaw = Array.isArray(raw.objects) ? raw.objects : [];
  const cats = (catalog && Array.isArray(catalog.categories)) ? catalog.categories : [];

  const methodExists = (cat, method) => {
    if (!cat) return false;
    const row = cats.find((c) => c.code === cat);
    if (!row) return false;
    const ms = Array.isArray(row.methods_json) ? row.methods_json : [];
    if (!method) return ms.length > 0 ? false : true;
    return ms.some((m) => m.code === method);
  };

  const positions = list.map((p, i) => {
    const cat = p.category_code || p.category || null;
    const method = p.method_code || p.method || null;
    const volume = Number(p.volume);
    const unit = String(p.unit || '').trim();
    const knownCategory = !cat || cats.some((c) => c.code === cat);
    const knownMethod = !cat ? false : methodExists(cat, method);

    const problems = [];
    if (!isFinitePositive(volume)) problems.push('объём не указан');
    if (!unit) problems.push('единица не указана');
    if (!cat) problems.push('категория не определена');
    else if (!knownCategory) problems.push(`категории «${cat}» нет в справочнике`);
    else if (!knownMethod) problems.push(`метода «${method || '—'}» нет в категории`);

    const posObjects = (Array.isArray(p.objects) ? p.objects : [])
      .map((o) => ({
        tag: String(o.tag || o.name || '').trim() || null,
        type: o.type || null,
        size: o.size || null,
        qty: Number(o.qty) || 1
      }))
      .filter((o) => o.tag || o.type);

    return {
      id: p.id || `p${i + 1}`,
      name: String(p.name || '').trim() || '(без названия)',
      category_code: cat,
      method_code: method,
      volume: isFinitePositive(volume) ? volume : null,
      unit,
      fouling: ['light', 'medium', 'heavy'].includes(String(p.fouling)) ? p.fouling : null,
      tech_equip: String(p.tech_equip || p.technology || '').trim() || null,
      tech_status: p.tech_status === 'rp' ? 'rp' : 'ai',
      source_ref: p.source_ref && typeof p.source_ref === 'object'
        ? { document: p.source_ref.document || null, fragment: p.source_ref.fragment || null }
        : (p.source_ref ? { document: String(p.source_ref), fragment: null } : null),
      confidence: Number.isFinite(Number(p.confidence)) ? Number(p.confidence) : null,
      approved: !!p.approved,
      rp_note: p.rp_note || null,
      needs_classification: problems.length > 0,
      problems
    };
  });

  // Аппараты, привязанные к позиции по имени или по id.
  for (const o of objectsRaw) {
    const target = o.position_id
      ? positions.find((p) => p.id === o.position_id)
      : positions.find((p) => p.name === o.position_name);
    if (!target) continue;
    target.objects = target.objects || [];
    target.objects.push({
      tag: String(o.tag || '').trim() || null,
      type: o.type || null,
      size: o.size || null,
      qty: Number(o.qty) || 1
    });
  }

  return {
    decision_recommend: ['go', 'no_go', 'need_info'].includes(raw.decision_recommend)
      ? raw.decision_recommend : 'need_info',
    positions,
    questions_for_customer: Array.isArray(raw.questions_for_customer)
      ? raw.questions_for_customer.filter(Boolean).map(String) : [],
    blocked: positions.filter((p) => p.needs_classification).length
  };
}

/** Правка одной позиции РП (объём/метод/технология). */
function applyPositionPatch(state, positionId, patch) {
  const s = normalizeState(state);
  const p = s.positions.find((x) => x.id === positionId);
  if (!p) {
    const err = new Error(`Позиция ${positionId} не найдена`);
    err.statusCode = 404;
    throw err;
  }
  const allow = ['volume', 'unit', 'category_code', 'method_code', 'fouling', 'tech_equip', 'rp_note', 'approved'];
  for (const k of allow) {
    if (patch && patch[k] !== undefined) p[k] = patch[k];
  }
  if (patch && (patch.tech_equip !== undefined || patch.technology !== undefined)) {
    p.tech_status = 'rp';
  }
  // Пересчитываем блокировку: правка могла снять проблему.
  p.problems = [];
  if (!isFinitePositive(p.volume)) p.problems.push('объём не указан');
  if (!p.unit) p.problems.push('единица не указана');
  if (!p.category_code) p.problems.push('категория не определена');
  p.needs_classification = p.problems.length > 0;
  return s;
}

/** Готов ли этап к завершению: у всех позиций есть метод, объём и технология. */
function canFinishTech(state) {
  const s = normalizeState(state);
  const bad = s.positions.filter((p) => p.needs_classification
    || !p.category_code || !isFinitePositive(p.volume) || !String(p.tech_equip || '').trim());
  return {
    ok: s.positions.length > 0 && bad.length === 0,
    blocked: bad.map((p) => ({ id: p.id, name: p.name, problems: p.problems || [] })),
    total: s.positions.length
  };
}

// ── План просчёта: люди, сроки, параллельность ──────────────────────────────

/**
 * Нормализует план просчёта.
 *
 * Сроки НЕ складываются последовательно: аппараты внутри одной параллельной
 * группы идут одновременно, поэтому сутки группы = максимум, а не сумма.
 * Источник каждой цифры обязателен — иначе РП не поймёт, откуда взялось.
 */
function normalizeCalcPlan(ai, opts) {
  const raw = ai && typeof ai === 'object' ? ai : {};
  const list = Array.isArray(raw.positions) ? raw.positions : [];
  const maxPosts = Number(opts && opts.max_parallel_posts) || 2;

  const positions = list.map((p, i) => {
    const people = Number(p.people) > 0 ? Number(p.people) : null;
    const days = Number(p.days) > 0 ? Number(p.days) : null;
    const source = ['norm', 'expert', 'analog', 'history'].includes(p.source) ? p.source : 'expert';
    return {
      id: p.id || `c${i + 1}`,
      position_id: p.position_id || null,
      apparatus: p.apparatus || null,
      name: String(p.name || '').trim() || '(без названия)',
      people,
      days,
      shifts: Number(p.shifts) > 0 ? Number(p.shifts) : null,
      shift_hours: Number(p.shift_hours) > 0 ? Number(p.shift_hours) : null,
      parallel_group: p.parallel_group != null ? String(p.parallel_group) : '0',
      equipment: Array.isArray(p.equipment) ? p.equipment : [],
      source,
      source_ref: p.source_ref || null,
      explain: String(p.explain || '').trim() || null,
      approved: !!p.approved,
      problems: [
        !people ? 'не указано число людей' : null,
        !days ? 'не указан срок' : null,
        source === 'expert' && !String(p.explain || '').trim() ? 'экспертная оценка без обоснования' : null
      ].filter(Boolean)
    };
  });

  // Параллельные группы: сутки = максимум внутри группы, между группами — сумма.
  const groups = new Map();
  for (const p of positions) {
    if (!(p.days > 0)) continue;
    const g = p.parallel_group;
    groups.set(g, Math.max(groups.get(g) || 0, p.days));
  }
  let workDays = 0;
  for (const d of groups.values()) workDays += d;
  workDays = Math.round(workDays * 100) / 100;

  // Наибольшая группа не может превышать число постов.
  const oversized = [...groups.entries()].filter(([, d]) => d > 0).length > maxPosts;

  const peopleTotal = positions.reduce((s, p) => s + (p.people || 0), 0);
  const manHours = positions.reduce(
    (s, p) => s + (p.people || 0) * (p.days || 0) * (p.shifts || 2) * (p.shift_hours || 12),
    0
  );

  return {
    positions,
    work_days: workDays || null,
    road_days: Number(raw.road_days) > 0 ? Number(raw.road_days) : null,
    people_total: peopleTotal,
    man_hours: Math.round(manHours),
    groups: [...groups.entries()].map(([g, d]) => ({ group: g, days: d })),
    warnings: [
      oversized ? `параллельных групп больше, чем постов (${maxPosts}) — срок может быть нереалистичным` : null,
      positions.some((p) => p.source === 'expert')
        ? 'часть сроков — экспертная оценка, не из справочника' : null
    ].filter(Boolean),
    blocked: positions.filter((p) => p.problems.length > 0).length
  };
}

/** Проверка окна дат: влезает ли план в календарь тендера. */
function checkDateWindow(plan, windowDays) {
  const w = Number(plan && plan.work_days) || 0;
  const road = Number(plan && plan.road_days) || 0;
  const n = Number(windowDays);
  if (!(n > 0)) return { ok: true, checked: false, reason: 'окно дат не задано' };
  const total = w + road;
  return {
    ok: total <= n,
    checked: true,
    required: total,
    available: n,
    message: total <= n
      ? `план ${total} сут влезает в ${n} кал. дней`
      : `план ${total} сут НЕ влезает в ${n} кал. дней (перерасход ${Math.round((total - n) * 100) / 100})`
  };
}

/**
 * Вопросы для звонка клиенту на основе ТЗ.
 *
 * Требование заказчика: анализ должен сам напомнить позвонить и подсказать,
 * что спросить — не общими словами, а по конкретному ТЗ (объёмы, доступы, сроки).
 * Если телефона в ТЗ нет — честно показываем «телефон не указан».
 */
function callQuestionsFromDv(dv, ctx) {
  const out = [];
  const c = ctx || {};
  const positions = (dv && dv.positions) || [];

  for (const p of positions) {
    if (!isFinitePositive(p.volume)) {
      out.push(`Уточнить объём по позиции «${p.name}»: сколько именно (единица — ${p.unit || 'не указана'})?`);
    }
    if (p.needs_classification || !p.method_code) {
      out.push(`Каким способом чистить «${p.name}» — химия, гидродинамика или механика? От этого зависит срок и цена.`);
    }
    if (!p.fouling) {
      out.push(`Насколько сильное загрязнение у «${p.name}» — рыхлое, среднее или плотное (камень, накипь)?`);
    }
  }

  if (!c.start_date || !c.end_date) {
    out.push('В какие даты можно работать и есть ли ограничение по остановке оборудования?');
  }
  out.push('Нужен ли наряд-допуск и кто его оформляет — мы или заказчик? Есть ли требования по допускам (высота, газ, НАКС)?');
  out.push('Кто предоставляет воду, электроэнергию и место под ёмкости для сточных вод?');
  out.push('Куда сливать отработанный раствор — есть ли у заказчика нейтрализация или вывоз?');
  out.push('Есть ли постоянный подрядчик на этих работах и по какой цене он работает сейчас?');

  const questions = Array.isArray(dv && dv.questions_for_customer) ? dv.questions_for_customer : [];
  for (const q of questions) {
    const t = String(q || '').trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 10);
}

/** Контакт заказчика из ТЗ: телефон, имя, окно звонка. */
function extractContact(text) {
  const src = String(text || '');
  // Телефон: только явные форматы, не любые цифры из текста.
  const phoneMatch = src.match(
    /(?:\+7|8)[\s\-(]{0,2}\d{3}[\s\-)]{0,2}\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/
  );
  const nameMatch = src.match(
    /(?:контактное лицо|контакт|представитель заказчика|главный инженер|механик|мастер|начальник)[:\s]+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2})/i
  );
  // Окно звонка: только если рядом есть время или дни недели, иначе не выдумываем.
  const windowMatch = src.match(
    /(?:звонить|при[её]м звонков|связь)[^\n.]{0,50}(?:\d{1,2}[:\-]\d{2}|с\s*\d{1,2}\s*до\s*\d{1,2}|пн|вт|ср|чт|пт)/i
  );
  return {
    phone: phoneMatch ? phoneMatch[0].replace(/\s+/g, ' ').trim() : null,
    name: nameMatch ? nameMatch[1].trim() : null,
    window: windowMatch ? windowMatch[0].trim().slice(0, 80) : null
  };
}

// ── Работа с БД ─────────────────────────────────────────────────────────────

async function loadStage(db, sessionUid) {
  const { rows } = await db.query(
    `SELECT session_uid, tender_id, stage, stage_state, stage_version
       FROM tkp_quick_sessions WHERE session_uid = $1`,
    [sessionUid]
  );
  if (!rows[0]) {
    const err = new Error('Сессия не найдена');
    err.statusCode = 404;
    throw err;
  }
  const r = rows[0];
  return {
    session_uid: r.session_uid,
    tender_id: r.tender_id,
    stage: r.stage || 'intake',
    state: normalizeState(r.stage_state),
    version: Number(r.stage_version) || 0
  };
}

/**
 * Сохраняет состояние этапа. `expectedVersion` — optimistic lock:
 * две вкладки не затрут правки друг друга (несовпадение → 409).
 */
async function saveStage(db, sessionUid, { stage, state, expectedVersion } = {}) {
  const cur = await loadStage(db, sessionUid);
  if (expectedVersion != null && Number(expectedVersion) !== cur.version) {
    const err = new Error('Этап изменён в другой вкладке — обновите страницу');
    err.statusCode = 409;
    throw err;
  }
  const nextStage = stage || cur.stage;
  if (!isStage(nextStage)) {
    const err = new Error(`Неизвестный этап: ${nextStage}`);
    err.statusCode = 400;
    throw err;
  }
  if (!canTransition(cur.stage, nextStage)) {
    const err = new Error(`Нельзя перейти с «${cur.stage}» на «${nextStage}»`);
    err.statusCode = 400;
    throw err;
  }
  const nextState = normalizeState(state || cur.state);
  const { rows } = await db.query(
    `UPDATE tkp_quick_sessions
        SET stage = $2, stage_state = $3::jsonb, stage_version = stage_version + 1,
            stage_updated_at = NOW(), updated_at = NOW()
      WHERE session_uid = $1
      RETURNING stage, stage_state, stage_version`,
    [sessionUid, nextStage, JSON.stringify(nextState)]
  );
  return {
    stage: rows[0].stage,
    state: normalizeState(rows[0].stage_state),
    version: Number(rows[0].stage_version)
  };
}

module.exports = {
  STAGES,
  ANALYSIS_STAGES,
  CALC_STAGES,
  isAnalysisStage,
  isCalcStage,
  STAGE_LABELS,
  canTransition,
  isStage,
  emptyState,
  normalizeState,
  preflight,
  resolveGap,
  waiveGap,
  normalizeDv,
  applyPositionPatch,
  canFinishTech,
  callQuestionsFromDv,
  extractContact,
  normalizeCalcPlan,
  checkDateWindow,
  loadStage,
  saveStage
};
