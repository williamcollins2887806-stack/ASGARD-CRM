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

  // Повторный разбор закрытой карточки: из done/nogo возвращаемся в анализ.
  // Без этого переиспользованная сессия на `done` роняет stage/analyze в 500
  // «Нельзя перейти с done на dv», и перепрогон после правок невозможен
  // (прод 10.11.2026, #2138). Возврат разрешён только в анализ, не в просчёт:
  // просчёт по-прежнему запускается отдельным действием.
  if ((from === 'done' || from === 'nogo') && isAnalysisStage(to)) return true;

  // Назад — только внутри своего конвейера.
  const iFrom = STAGES.indexOf(from);
  const iTo = STAGES.indexOf(to);
  if (from === 'done' || from === 'nogo') return false;
  if (isAnalysisStage(from) !== isAnalysisStage(to)) return false;
  return iTo >= 0 && iTo < iFrom;
}

function emptyState() {
  return { v: 1, gaps: [], positions: [], calc: { positions: [] }, decision: null, mtr_suggestions: [] };
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
  // МТР из анализа: без этого поля перечень терялся на записи состояния.
  out.mtr_suggestions = Array.isArray(out.mtr_suggestions) ? out.mtr_suggestions : [];
  if (out.calc && !Array.isArray(out.calc.mtr)) out.calc.mtr = [];
  // График заездов: без явного сохранения терялся при normalizeState, и
  // просчёт получал trip_count = 1 вместо реального числа выездов.
  if (!out.visit_plan || typeof out.visit_plan !== 'object') out.visit_plan = null;
  if (out.visit_plan && !Array.isArray(out.visit_plan.visits)) out.visit_plan.visits = [];
  if (!['continuous', 'visits', 'unknown'].includes(String(out.visit_mode))) {
    out.visit_mode = out.visit_plan ? out.visit_plan.mode || null : null;
  }
  out.trip_count = Number(out.trip_count) > 0
    ? Number(out.trip_count)
    : (out.visit_plan && Number(out.visit_plan.trip_count) > 0
      ? Number(out.visit_plan.trip_count) : null);
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

  // ── Документы есть, но считать нечего ────────────────────────────────────
  // Бывает, что текст распознан (договор, формы, ТЗ без цифр), а позиций для
  // расчёта в нём нет: ни объёмов, ни трудоёмкости. Раньше такой анализ
  // запускался, модель возвращала пустую ДВ, и РП не понимал, чего не хватает.
  //
  // Блокируем не «молча», а с точным списком: что именно запросить у
  // заказчика. Анализ при этом остаётся открытым — РП дописывает цифры в
  // чат или поле, и работа продолжается.
  if (docsWithText.length > 0) {
    const allText = docsWithText
      .map((d) => String(d.text || d.ocr_text || d.content || ''))
      .join('\n');
    // Объём: число с единицей измерения (м3, м2, т, шт, п.м).
    const hasVolumeInText = /\d+(?:[.,]\d+)?\s*(?:м3|м³|м2|м²|куб|кв\.?\s*м|т\b|тонн|шт|п\.?м|пог\.?м|кг|л\b|литр)/i.test(allText);
    // Трудоёмкость: «1800 мин», «30 чел·ч» — заказчик сам посчитал норму.
    const hasLaborInText = /\d{2,}\s*(?:мин|час|ч\b|чел[·.\-]?\s*ч|человеко[-\s]?час|чел[·.\-]?\s*дн)/i.test(allText);

    if (!hasVolumeInText && !hasLaborInText && !hasVolume) {
      gaps.push({
        id: 'no_quantities',
        kind: 'file_or_text',
        blocking: true,
        label: 'В документах нет ни объёмов, ни трудоёмкости',
        why: 'Текст распознан, но посчитать нечего: ни м²/м³/т, ни человеко-часов. '
          + 'Без этого срок и бригада будут выдуманными.',
        hint: 'Запросите у заказчика объёмы (ведомость/дефектный акт) или трудоёмкость в часах. '
          + 'Можно вписать в чат — анализ продолжится с этими цифрами.'
      });
    }
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

/**
 * Определяет категорию и метод по названию позиции и единице измерения.
 *
 * Зачем: модель нестабильна — в одном прогоне ставит категорию всем 11
 * позициям, в другом ни одной (проверено на проде 06.11). Позиция без
 * категории не получает норму и не попадает в смету, поэтому нужен
 * детерминированный запасной путь.
 *
 * Правила намеренно узкие: лучше оставить пусто (РП разберётся), чем
 * приписать неверную норму.
 */
function guessCategory(p) {
  const name = String((p && p.name) || '').toLowerCase();
  const tech = String((p && (p.tech_equip || p.technology)) || '').toLowerCase();
  const unit = String((p && p.unit) || '').toLowerCase();
  const t = name + ' ' + tech;
  const isM2 = /м²|м2|кв\.?\s*м/.test(unit);
  const isM3 = /м³|м3|куб/.test(unit);

  const has = (re) => re.test(t);

  // Сварка и ремонт — раньше металла: «заварка течи на баке» это сварка.
  if (has(/сварк|заварк|наплавк|сварочн|стык\s+труб|шов/)) {
    return { category_code: 'repair_weld', method_code: 'weld' };
  }
  // Теплоизоляция.
  if (has(/изоляц|изолиров|теплоизоляц|минват|скорлуп/)) {
    return { category_code: 'insulation', method_code: 'pipe' };
  }
  // Трубопроводы (по длине).
  if (has(/трубопровод|труба\s+ду|dn\s*\d|гидроиспытан|опрессов|пассивац\s+труб/) && !has(/трубн\w*\s+пуч|трубк/)) {
    return { category_code: 'pipelines', method_code: 'hydro' };
  }
  // Градирни и инженерные системы.
  if (has(/градирн|драйкулер|сухая\s+градирн|вентиляторн\s+градирн|чиллер/)) {
    return { category_code: 'towers_hvac', method_code: isM2 ? 'tower' : 'heating' };
  }
  // Промывка технологических КОЛОНН и башен: площадь орошения в м² —
  // это towers_hvac.tower. Тендер 2145 (НПЗ Панчево): 17 позиций
  // «Автоматизированная водяная промывка колонны DA-301, 93.09 м²»
  // остались без категории, потому что «колонна» ловилась только как
  // вентиляция. Сербское название (Pranje kolona) — латиницей.
  if (has(/колонн|колона|kolon|башн|скруббер|абсорбер/)
      && isM2
      && has(/промыв|очистк|зачистк|орошени|pranj|čišćenj|ciscenj|чистк/)) {
    return { category_code: 'towers_hvac', method_code: 'tower' };
  }
  // Вентиляция и канализация.
  if (has(/вентиляц|воздуховод|канализац|канал|приямок|колодец|жироуловител/)) {
    return { category_code: 'vent_sewer', method_code: 'sewer' };
  }
  // Котлы.
  if (has(/котёл|котел|котлоагрегат|квгм|дквр|пп-\d|птвм|утилизатор|экономайзер/)) {
    if (has(/хим|кислот|щелоч|реагент|промыв/)) return { category_code: 'boilers', method_code: 'chem' };
    if (has(/гидроиспыт|опрессов|гидравлич/)) return { category_code: 'boilers', method_code: 'hydro' };
    return { category_code: 'boilers', method_code: 'mech' };
  }
  // Пластинчатые теплообменники.
  if (has(/пластин|разборн\w*\s+теплообмен|паяльн\w*\s+теплообмен/)) {
    if (has(/хим|cip|безразборн|промыв/)) return { category_code: 'plates', method_code: 'chem_cip' };
    return { category_code: 'plates', method_code: 'hydro_dis' };
  }
  // Трубные пучки и конденсаторы.
  if (has(/трубн[а-яё]*\s+пуч|трубк|конденсатор|подогревател|маслоохладител|теплообменник/)) {
    // ГМО (шарошки) проверяем ДО «трубки»: иначе общая ветка съедает ГМО.
    if (has(/гмо|шарошк/)) return { category_code: 'tubes', method_code: 'gmo' };
    if (has(/хим|кислот|промыв/)) return { category_code: 'tubes', method_code: 'chem' };
    return { category_code: 'tubes', method_code: 'gdo' };
  }
  // АВО.
  if (has(/аво|аппарат\w*\s+воздушн\w*\s+охлажд|оребрен/)) {
    return { category_code: 'avo', method_code: isM2 ? 'outer' : 'tubes' };
  }
  // ЗИА (закалочно-испарительный аппарат) — кожухотрубный теплообменник
  // в производстве аммиака. Тендер 2148: «Гидроструйная чистка ЗИА BORZIG
  // (24 шт.), Schmidt'sche (8 шт.)» осталось без категории, хотя по
  // конструкции это трубный пучок. Аббревиатура в правилах отсутствовала.
  //
  // ВАЖНО про единицу: «24 апп.» — это число АППАРАТОВ, а не трубок.
  // Норма tubes.gdo считает трубки, поэтому такой объём надо пересчитать
  // через паспорт (площадь → трубки) или запросить у РП. Ставим tubes,
  // но needs_input сработает сам: без tubes в inputs норма попросит данные.
  if (has(/(^|[^а-яё])зиа([^а-яё]|$)|закалочно[-\s]?испарительн/)) {
    return { category_code: 'tubes', method_code: 'gdo' };
  }
  // Ёмкости, резервуары, бункеры, баки.
  if (has(/резервуар|ёмкост|емкост|бак\b|бункер|бпмф|бпво|бо[вв]|рвс|цистерн|отстойник|мерник/)) {
    return { category_code: 'vessels', method_code: 'clean' };
  }
  // Химконтуры и CIP.
  if (has(/химконтур|cip|циркуляц\w*\s+контур|промывк\w*\s+контур/)) {
    return { category_code: 'chem_circuits', method_code: 'cip' };
  }
  // По единице: м³ без текста — ёмкость, м² — поверхность нагрева.
  if (isM3) return { category_code: 'vessels', method_code: 'clean' };
  return null;
}

function isFinitePositive(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

/** Мягкая дата из ответа модели: ISO / ДД.ММ.ГГГГ / ГГГГ-ММ → YYYY-MM-DD или null. */
function normalizeLooseDate(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3] || '01'}`;
  const ru = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (ru) {
    return `${ru[3]}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}`;
  }
  return null;
}

/**
 * Сколько заездов следует из периодов позиций ДВ.
 * Одинаковая мойка в сентябре и декабре → два заезда, а не один.
 */
function deriveVisitCount(positions) {
  const list = Array.isArray(positions) ? positions : [];
  const keys = new Set();
  for (const p of list) {
    if (!p) continue;
    const k = String(
      p.visit_id || p.period || p.period_start || p.when || p.timing || ''
    ).toLowerCase().replace(/\s+/g, ' ').trim();
    if (k) keys.add(k);
  }
  return keys.size > 0 ? keys.size : 1;
}

/**
 * Трудосутки и человеко-часы ПО ЗАЕЗДАМ (P2, 12.11.2026).
 *
 * Зачем: РП видит в карточке «срок 407 суток» и читает это как «кампания
 * идёт 407 дней подряд». На деле это трудосутки всего объёма при текущем
 * числе бригад — знаменатель ФОТ и проживания в смете.
 *
 * Ничего в смету не пишем. Считаем только разрез:
 *   • доля заезда = его человеко-часы / общий MH;
 *   • work_days заезда = work_days × доля (Σ == итог, расход только округление);
 *   • проверка «влезает ли заезд в своё окно» — по ЕГО окну, а не по общему
 *     сроку минус все дороги.
 *
 * @param {object} p
 * @param {Array} p.visits — заезды с position_ids/period_start/period_end
 * @param {Array} p.positions — позиции плана (для доли по MH)
 * @param {number} p.totalWorkDays — итоговые трудосутки всего объёма
 * @param {number} p.mobDays
 * @param {number} p.roadDays
 * @returns {{perVisit:Array, perTrip:number|null, total:number|null,
 *            windowCheck:Array}}
 */
function distributeWorkDaysByVisits(p) {
  const o = p || {};
  const visits = Array.isArray(o.visits) ? o.visits : [];
  const positions = Array.isArray(o.positions) ? o.positions : [];
  const totalWorkDays = Number(o.totalWorkDays);
  const empty = { perVisit: [], perTrip: null, total: null, windowCheck: [] };
  if (!visits.length) return empty;
  if (!(totalWorkDays > 0)) {
    // Срок неизвестен — разрез не выдумываем, но заезды отдаём.
    return {
      perVisit: visits.map((v) => ({ id: v.id, label: v.label, work_days: null, person_hours: null })),
      perTrip: null,
      total: null,
      windowCheck: []
    };
  }

  const mhOf = (x) => {
    const direct = Number(x && x.mh);
    if (direct > 0) return direct;
    const hours = Number(x && x.labor_hours);
    if (hours > 0) return hours;
    const people = Number(x && x.people) || 0;
    const days = Number(x && x.days) || 0;
    const shift = Number(x && x.shift_hours) || 12;
    return people > 0 && days > 0 ? people * days * shift : 0;
  };
  const mhById = new Map();
  let mhAll = 0;
  for (const pos of positions) {
    const m = mhOf(pos);
    if (m > 0) {
      mhAll += m;
      if (pos.id != null) mhById.set(String(pos.id), m);
    }
  }

  const shares = visits.map((v) => {
    const ids = Array.isArray(v.position_ids) ? v.position_ids.map(String) : [];
    let mh = 0;
    for (const id of ids) mh += mhById.get(id) || 0;
    return { visit: v, idList: ids, mh };
  });

  const mhAssigned = shares.reduce((s, x) => s + x.mh, 0);
  // Знаменатель долей — РАЗМЕЧЕННЫЕ человеко-часы, а не весь MH.
  // Иначе неразмеченные позиции уходили бы остатком одному заезду: на 2138
  // размечено 146 позиций из 675, и первый заезд получал 24 % при 407 сутках
  // итога — цифры в карточке противоречили друг другу.
  // Если разметки нет вовсе — делим поровну.
  const even = mhAssigned <= 0;
  const evenShare = 1 / shares.length;

  // Округление: трудосутки в 0,1 — как work_days в плане. Остаток отдаём
  // самому КРУПНОМУ заезду (а не последнему по порядку): так доля не
  // искажается тем, в каком порядке модель перечислила выезды.
  const rawDays = shares.map((s) => {
    const share = even ? evenShare : s.mh / mhAssigned;
    return { share, days: totalWorkDays * share };
  });
  const rounded = rawDays.map((x) => Math.round(x.days * 10) / 10);
  const sumRounded = rounded.reduce((a, b) => a + b, 0);
  const diff = Math.round((totalWorkDays - sumRounded) * 10) / 10;
  if (diff !== 0 && rounded.length) {
    let biggest = 0;
    for (let i = 1; i < rounded.length; i += 1) {
      if (rounded[i] > rounded[biggest]) biggest = i;
    }
    rounded[biggest] = Math.round((rounded[biggest] + diff) * 10) / 10;
  }

  const perVisit = shares.map((s, i) => ({
    id: s.visit.id,
    label: s.visit.label,
    period_start: s.visit.period_start || null,
    period_end: s.visit.period_end || null,
    positions: s.idList.length || null,
    work_days: rounded[i],
    person_hours: s.mh > 0 ? Math.round(s.mh) : null,
    share_pct: Math.round(rawDays[i].share * 1000) / 10
  }));

  // Проверка окна ПО КАЖДОМУ заезду: сутки работ + мобилизация + дорога
  // туда-обратно должны влезть в окно именно этого периода. Раньше сравнивали
  // общий срок со сроком заказчика — и один «длинный» заезд прятался за
  // другими.
  const mob = Math.max(0, Number(o.mobDays) || 0);
  const road = Math.max(0, Number(o.roadDays) || 0);
  const windowCheck = perVisit.map((v) => {
    const need = (Number(v.work_days) || 0) + mob + 2 * road;
    const win = calendarDaysBetween(v.period_start, v.period_end);
    if (!(win > 0)) {
      return {
        id: v.id, label: v.label, required: Math.round(need * 10) / 10,
        available: null, ok: null, checked: false,
        message: 'окно заезда не задано — проверить нечем'
      };
    }
    const ok = need <= win;
    return {
      id: v.id, label: v.label,
      required: Math.round(need * 10) / 10,
      available: win,
      ok,
      checked: true,
      message: ok
        ? `заезд ${Math.round(need * 10) / 10} сут влезает в ${win} кал. дней`
        : `заезд НЕ влезает: нужно ${Math.round(need * 10) / 10} сут при окне ${win} кал. дней`
    };
  });

  return {
    perVisit,
    perTrip: Math.round((totalWorkDays / shares.length) * 100) / 100,
    total: Math.round(perVisit.reduce((s, v) => s + (Number(v.work_days) || 0), 0) * 10) / 10,
    windowCheck
  };
}

/** Календарных дней между датами (включительно), null если дат нет. */
function calendarDaysBetween(startIso, endIso) {
  const s = String(startIso || '').slice(0, 10);
  const e = String(endIso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return null;
  const a = Date.parse(s + 'T00:00:00Z');
  const b = Date.parse(e + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * Откуда взят объём позиции — доказательство для РП.
 *
 * Требование 07.11.2026: пользователь должен видеть, откуда цифра —
 * из ВОР, из ТЗ, из паспорта оборудования или введена руками.
 */
const VOLUME_SOURCES = {
  vor: 'Ведомость объёмов заказчика',
  tz: 'Техническое задание',
  passport: 'Паспорт оборудования',
  'passport-web': 'Паспорт из открытых источников',
  history: 'История по заказчику',
  geometry: 'Досчёт по геометрии аппарата',
  rp: 'Введено РП',
  // Карточка анализа пишет `manual`, когда позицию добавил РП руками.
  // Без этого значения бейдж источника выводился сырым словом «manual».
  manual: 'Введено РП',
  none: 'Источник не определён'
};

function normalizeVolumeSource(p) {
  const o = p || {};
  const explicit = String(o.volume_source || o.source || '').trim().toLowerCase();
  if (VOLUME_SOURCES[explicit]) return explicit;

  // Паспортное обогащение ставит passport — оно важнее догадок модели.
  if (o.passport && o.passport.brand) {
    return o.passport.source === 'web' ? 'passport-web' : 'passport';
  }

  // Модель указала документ — определяем по его имени.
  const doc = String((o.source_ref && (o.source_ref.document || o.source_ref)) || '');
  if (doc) {
    const d = doc.toLowerCase();
    if (/ведомост|дефектн|вор\b|объ[её]м/.test(d)) return 'vor';
    if (/техническ|тех.?зада|тз\b|задан/.test(d)) return 'tz';
    if (/истори|прошл|архив/.test(d)) return 'history';
  }

  // Есть фрагмент цитаты — значит взято из документа, но из какого не ясно.
  if (o.source_ref && o.source_ref.fragment) return 'tz';

  // Объём введён РП (позиция помечена как правленая).
  if (o.tech_status === 'rp') return 'rp';

  return 'none';
}

/**
 * Человеческое доказательство: что именно подтверждает объём.
 * Это то, что РП читает в карточке, а не сырой JSON.
 */
function buildVolumeProof(p) {
  const o = p || {};
  const src = normalizeVolumeSource(o);
  const parts = [];

  if (src === 'passport' || src === 'passport-web') {
    const brand = (o.passport && o.passport.brand) || (o.conversion_params && o.conversion_params.brand);
    const note = (o.passport && o.passport.note) || '';
    if (brand) parts.push(`марка ${brand}`);
    if (note) parts.push(note);
    if (o.passport && o.passport.source === 'web') parts.push('источник: открытые данные');
  }

  if (o.source_ref) {
    const doc = o.source_ref.document;
    const frag = o.source_ref.fragment;
    if (doc) parts.push(`документ: ${String(doc).slice(0, 80)}`);
    if (frag) parts.push(`цитата: «${String(frag).slice(0, 160)}»`);
  }

  // Параметры пересчёта — тоже доказательство: по ним считался объём.
  // Модель присылает их как в корне позиции, так и в conversion_params,
  // поэтому смотрим оба места (иначе доказательство теряло толщину).
  const cp = Object.assign({}, o, o.conversion_params || {});
  const conv = [];
  if (cp.thickness_mm) conv.push(`толщина ${cp.thickness_mm} мм`);
  if (cp.density_t_m3) conv.push(`плотность ${cp.density_t_m3} т/м³`);
  if (cp.dn_mm) conv.push(`Ø${cp.dn_mm} мм`);
  if (cp.length_m) conv.push(`длина ${cp.length_m} м`);
  if (cp.area_per_plate_m2) conv.push(`площадь пластины ${cp.area_per_plate_m2} м²`);
  if (conv.length) parts.push('пересчёт: ' + conv.join(', '));

  if (o.measured_unit && o.measured_value) {
    parts.push(`в документах: ${o.measured_value} ${o.measured_unit}`);
  }

  if (o.problem) parts.push(String(o.problem).slice(0, 200));

  return parts.length ? parts.join(' · ') : null;
}

/** confidence: слово или число → слово. */
function normalizeConfidence(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (['high', 'medium', 'low'].includes(s)) return s;
  if (['высокая', 'высокий'].includes(s)) return 'high';
  if (['средняя', 'средний'].includes(s)) return 'medium';
  if (['низкая', 'низкий'].includes(s)) return 'low';
  const n = Number(v);
  if (Number.isFinite(n)) {
    if (n >= 0.75) return 'high';
    if (n >= 0.45) return 'medium';
    return 'low';
  }
  return null;
}

/**
 * Нижняя оценка числа позиций по документам.
 *
 * Нужна как признак «модель явно недобрала»: в ведомости на 673 строки
 * ответ из 5 укрупнённых позиций — это провал разбора, а не полный ответ.
 * Считаем строки таблиц, похожие на позиции работ: начинаются с номера
 * или содержат единицу измерения с числом.
 */
function estimateExpectedPositions(documents) {
  const list = Array.isArray(documents) ? documents : [];
  const texts = [];

  for (const d of list) {
    const name = String((d && (d.original_name || d.name)) || '');
    // Только документы, где реально бывают перечни работ.
    //
    // ВАЖНО: \b в JavaScript определён только для ASCII-\w, поэтому «вор\b»
    // и «тз\b» НЕ срабатывают в кириллических именах — «ВОР.xlsx», «ВОР №1»,
    // «ТЗ.pdf» не считались источниками перечня, и порог полноты отключался
    // ровно на самых частых именах файлов. Границы задаём явно.
    if (!/(^|[^а-яё])(вор|тз)([^а-яё]|$)|ведомост|дефектн|объ[её]м|перечень|спецификац|техническ/i.test(name)) continue;

    const text = String((d && (d.text || d.ocr_text)) || '');
    if (text.length < 200) continue;
    texts.push(text);
  }

  return countTableRowsInText(texts);
}

/**
 * Считает строки таблиц в готовом тексте — БЕЗ фильтра по имени файла.
 *
 * Нужна, когда роль документа уже определена вызывающим кодом (например по
 * `doc-role.js`), и повторная проверка имени только вредит: ВОР, названный
 * «Приложение 1.xlsx» (частая практика у Апатита и в тендере 2133), отсекался
 * бы второй раз и порог полноты молча отключался.
 *
 * @param {string[]} texts — фрагменты текста (по одному на документ)
 * @returns {number} ожидаемое число позиций или 0
 */
function countTableRowsInText(texts) {
  const list = Array.isArray(texts) ? texts : [];
  return countTableRowsDetailed(list).estimate;
}

/**
 * Считает строки таблиц и возвращает обе величины: реальное число строк и
 * нижнюю оценку числа позиций.
 *
 * Две величины нужны потому, что они служат разным целям:
 *   • estimate (строки / 2) — порог добора: он должен быть ЗАНИЖЕН, чтобы
 *     цикл не останавливался слишком рано;
 *   • rows (реальное число строк) — признак неполноты: сравнивать с оценкой
 *     нельзя, иначе получится то же самое число, что в пороге добора, и флаг
 *     будет зеркалом условия выхода, а не независимой метрикой.
 *
 * @param {string[]} texts
 * @returns {{rows: number, estimate: number}}
 */
function countTableRowsDetailed(texts) {
  const list = Array.isArray(texts) ? texts : [];
  const all = [];
  for (const raw of list) {
    const text = String(raw || '');
    if (text.length < 200) continue;
    all.push(text);
  }
  if (!all.length) return { rows: 0, estimate: 0 };

  // ── Основной способ: нумерация позиций ───────────────────────────────────
  // Любая ведомость нумерует позиции 1, 2, 3, … N. Это единственное свойство,
  // которое не зависит ни от единицы измерения, ни от формата файла, ни от
  // разделителя колонок:
  //   «| 1 | Очистка | м3 | 340 |»   (xlsx через ExcelJS)
  //   «1\nОчистка\nм3\n340»          (docx через mammoth — ячейка = строка)
  //   «1,Очистка,м3,340»             (csv через SheetJS)
  //   «1. Очистка — 340 м»           (текстовый ТЗ)
  //
  // Двенадцать проходов верификатора ушли на то, чтобы перечислить форматы
  // (м, компл, Гкал, т, шапка таблицы, маркеры списка). Перечисление
  // бесконечно: новый заказчик — новый формат. Нумерация не бесконечна.
  //
  // Дополнительно это решает дубли: один перечень, пришедший двумя
  // документами, даёт последовательность 1..N дважды, но САМАЯ ДЛИННАЯ
  // последовательность остаётся N — удвоения нет.
  const numbered = longestNumberedRun(all);
  if (numbered >= 8) return { rows: numbered, estimate: numbered };

  // ── Резервный способ: строки с объёмом и единицей ───────────────────────
  // Если нумерации нет (редкие ведомости без колонки №), считаем строки,
  // где рядом стоят число и единица измерения.
  return { rows: countRowsByUnits(all), estimate: countRowsByUnits(all) };
}

/**
 * Длина самой длинной последовательности 1, 2, 3, … в начале строк.
 *
 * Номера позиций идут подряд, поэтому длиннейшая возрастающая цепочка
 * с шагом 1 и есть число позиций. Строки любого вида подходят: берём первое
 * числовое значение в строке, если оно стоит в начале (после пробелов,
 * разделителей или маркера списка).
 *
 * @param {string[]} texts
 * @returns {number}
 */
function longestNumberedRun(texts) {
  const nums = [];
  for (const text of texts) {
    const rawLines = String(text).split(/\r?\n/);
    for (let i = 0; i < rawLines.length; i += 1) {
      const line = rawLines[i].trim();
      if (!line) continue;
      // Первое число в начале строки: «1 | …», «1. …», «1) …», «| 1 | …», «1,…».
      const m = /^[\s|•·\-—–*()\[\]]*(\d{1,4})(?![\d])/.exec(line);
      if (!m) continue;
      const n = Number(m[1]);
      if (!(n >= 1 && n <= 9999)) continue;

      // В формате «ячейка = строка» (docx через mammoth) объём тоже стоит
      // отдельной строкой и выглядит как номер. Отличаем по контексту:
      // номер позиции идёт ПЕРЕД текстом описания, а объём — перед следующим
      // номером. Значит, номер позиции — тот, за которым идёт строка с буквами.
      const rest = line.slice(m[0].length).trim();
      if (rest && /[а-яёa-z]/i.test(rest)) {
        // «1 Очистка» / «1,Очистка» — номер и текст в одной строке.
        // НО: пункт требований ТЗ выглядит так же («1. Требование к работам»).
        // Отличаем по объёму: у позиции ведомости в строке есть число
        // количества или единица измерения. Без этого ТЗ на 300 пунктов
        // давало 300 «позиций» и раздувало ожидание.
        if (hasQuantityOrUnit(rest) || hasQuantityOrUnit(line)) nums.push(n);
        continue;
      }
      const nextText = nextNonEmptyLine(rawLines, i + 1);
      if (nextText && /[а-яёa-z]/i.test(nextText)) nums.push(n);
      // Иначе это объём, единица или служебная строка — не номер позиции.
    }
  }
  if (nums.length < 8) return 0;

  // Ищем самую длинную цепочку n, n+1, n+2, … Идём по возрастанию и считаем
  // серии; повторы одного номера (дубль перечня) продолжают текущую серию,
  // а не начинают новую — поэтому удвоения не происходит.
  const sorted = nums.slice().sort((a, b) => a - b);
  let best = 0;
  let prev = sorted[0];
  let count = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const v = sorted[i];
    if (v === prev) continue;              // повтор — не растим, не сбрасываем
    if (v === prev + 1) { prev = v; count += 1; continue; }
    // Разрыв: фиксируем серию и начинаем новую.
    if (count > best) best = count;
    prev = v;
    count = 1;
  }
  if (count > best) best = count;
  return best >= 8 ? best : 0;
}

/** Следующая непустая строка после указанной. */
function nextNonEmptyLine(lines, from) {
  for (let i = from; i < lines.length; i += 1) {
    const s = String(lines[i] || '').trim();
    if (s) return s;
  }
  return '';
}

/**
 * Есть ли в строке количество или единица измерения.
 *
 * Нужно, чтобы отличить позицию ведомости от пункта требований ТЗ: и то и
 * другое начинается с номера, но у позиции рядом стоит объём.
 */
function hasQuantityOrUnit(s) {
  const t = String(s || '');
  // Число с единицей: «340 м3», «12,5 т», «250 п.м».
  if (/\d+(?:[.,]\d+)?\s*(?:м2|м3|м²|м³|куб|кв\.?\s*м|пог|п\.?\s*м|м\.?\s*п|шт|кг|т(?![а-яё])|тонн|компл|Гкал|литр|л(?![а-яё])|км|м(?![а-яё]))/i.test(t)) return true;
  // Колонки с единицей и числом отдельно.
  const cells = t.split(/[|,;\t]/).map((x) => x.trim()).filter(Boolean);
  const hasUnit = cells.some((x) => /^(м2|м3|м²|м³|куб|кв\.?\s*м|пог\.?\s*м|п\.?\s*м|м\.?\s*п|шт\.?|кг|т|тн|тонн|компл|Гкал|литр|л|км|м|труб|трубки)$/i.test(x));
  const hasNum = cells.some((x) => /^\d{1,6}(?:[.,]\d+)?$/.test(x));
  return hasUnit && hasNum;
}

/**
 * Резервный счёт: строки, где есть и число, и единица измерения.
 * Используется, только если нумерации в документе нет.
 */
function countRowsByUnits(texts) {
  let lines = 0;
  for (const raw of texts) {
    const text = String(raw || '');
    let headerUnit = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.length > 2000) continue;

      if (!headerUnit
        && /(объ[её]м|количеств|кол-?во)/i.test(line)
        && /(м2|м3|м²|м³|куб|кв\.?\s*м|тонн|т(?![а-яё])|шт|кг|пог|компл|Гкал|литр|л(?![а-яё]))/i.test(line)) {
        headerUnit = true;
      }

      const cleaned = line.replace(/^[\s|•·\-—–*()0-9.)\]]+/, '');
      if (/^(в\s*т\.?\s*ч\.?|в\s*том\s+числе|итог|всего|прим|примечан)/i.test(cleaned)) continue;

      const hasUnitNear = /\d+(?:[.,]\d+)?\s*(?:м2|м3|м²|м³|куб\.?\s*м|кв\.?\s*м|пог\.?\s*м|п\.?\s*м|м\.?\s*п\.?|шт\.?|кг|т(?![а-яё])|тонн|компл|Гкал|литр|л(?![а-яё])|км|м(?![а-яё]))/i.test(line);
      const cells = line.split(/[|,;\t]/).map((s) => s.trim()).filter(Boolean);
      const cellsUnit = cells.some((s) => /^(м2|м3|м²|м³|куб\.?\s*м|кв\.?\s*м|пог\.?\s*м|м\.?\s*п\.?|шт\.?|кг|т|тн|тонн|труб|трубки|компл|Гкал|литр|л|км|м)$/i.test(s))
        && cells.some((s) => /^\d{1,6}(?:[.,]\d+)?$/.test(s));
      const hasNumber = cells.some((s) => /^\d{1,6}(?:[.,]\d+)?$/.test(s));

      if (hasUnitNear || cellsUnit || (headerUnit && hasNumber)) lines += 1;
    }
  }
  return lines >= 8 ? lines : 0;
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
/**
 * Отпечаток позиции для дедупликации.
 *
 * Дефект 07.11 (тендер 2138): модель отдаёт одну и ту же позицию повторами —
 * «теплообменник 2104L» встречался 39 раз, всего 224 дубля из 364 позиций.
 * Ключ включает название, объём и единицу: разные аппараты с одинаковым
 * объёмом различаются названием, а настоящий повтор совпадает целиком.
 */
/**
 * Ключ дедупликации позиции.
 *
 * ── Почему нельзя только по названию ───────────────────────────────────────
 * В ведомостях часто одна и та же работа по РАЗНЫМ аппаратам: «Гидрочистка
 * трубок» для Т-1, Т-2 и Т-3 — это три позиции, а не одна. Раньше ключ
 * состоял из названия, объёма и единицы, и аппарат в него не входил: при
 * совпадении объёмов разные аппараты схлопывались в один, и позиции терялись.
 *
 * Теперь в ключ входят:
 *   • название (нормализованное, без кавычек);
 *   • объём и единица;
 *   • ТЕГ аппарата из objects («Т-1», «РВС-5000», «К-2»);
 *   • СРОК / период (сентябрь ≠ декабрь): одна и та же мойка в разные месяцы
 *     — это РАЗНЫЕ позиции и разные заезды, их нельзя схлопывать.
 *
 * @param {object} p — позиция ДВ
 * @returns {string}
 */
function dupKey(p) {
  const o = p || {};
  const name = String(o.name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[«»"'`]/g, '')
    .trim()
    .slice(0, 160);
  // Тег аппарата: первый непустой из objects. Именно он отличает «та же
  // работа по другому аппарату».
  const objects = Array.isArray(o.objects) ? o.objects : [];
  const tag = objects
    .map((x) => String((x && (x.tag || x.type)) || '').toLowerCase().trim())
    .filter(Boolean)
    .sort()
    .join(',');
  const vol = o.volume == null ? '—' : String(o.volume).trim();
  const unit = String(o.unit || '').toLowerCase().trim();
  // Период заезда: «сентябрь 2027», «март», «2027-09», visit_id.
  // Без него сентябрь и декабрь схлопывались в одну строку, и график
  // заездов (trip_count) терял реальные выезды.
  const period = String(
    o.period || o.when || o.timing || o.schedule_window
      || o.period_start || o.visit_id || o.visit || ''
  )
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${name}|${vol}|${unit}|${tag}|${period}`;
}

/**
 * Уникальный id позиции.
 *
 * Модель нумерует позиции с 1 в КАЖДОМ ответе. При доборе по порциям это
 * даёт повторы: `p1` из первой порции и `p1` из второй — разные позиции с
 * одинаковым id. Раньше id строился из индекса, и на 2000 позициях
 * уникальных оставалось 250: связи «позиция → план → смета» рвались, и
 * часть позиций выпадала из расчёта.
 *
 * @param {string|number|null} rawId — id из ответа модели
 * @param {Set<string>} used — уже выданные id (мутируется)
 * @param {number} index — порядковый номер в текущей порции
 * @returns {string}
 */
function uniquePositionId(rawId, used, index) {
  const base = rawId != null && String(rawId).trim() ? String(rawId).trim() : `p${index + 1}`;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  // Занято — добавляем суффикс, пока не найдём свободный.
  let n = 2;
  let candidate = `${base}-${n}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  used.add(candidate);
  return candidate;
}

function normalizeDv(ai, catalog) {
  const raw = ai && typeof ai === 'object' ? ai : {};
  const listSrc = Array.isArray(raw.positions) ? raw.positions : [];

  // ── Уникальные id позиций ────────────────────────────────────────────────
  // Модель нумерует позиции с 1 в каждом ответе. При разборе порциями это
  // даёт повторы id между порциями, и связи «позиция → план → смета» рвутся.
  // Набор общий на весь вызов normalizeDv (то есть на весь документ).
  const usedIds = new Set();

  // ── Дедупликация ──────────────────────────────────────────────────────────
  // Дефект 07.11 (тендер 2138): модель отдаёт одну и ту же позицию повторами —
  // «теплообменник 2104L» встречался 39 раз, всего 224 дубля из 364 позиций.
  // Дедупликация нужна именно здесь, а не только при доборе: дубли приходят
  // и внутри одного ответа модели.
  // Ключ — название + объём + единица + тег аппарата.
  const seenPos = new Set();
  const list = [];
  for (const p of listSrc) {
    if (!p || typeof p !== 'object') continue;
    const k = dupKey(p);
    if (seenPos.has(k)) continue;
    seenPos.add(k);
    list.push(p);
  }

  const objectsRaw = Array.isArray(raw.objects) ? raw.objects : [];
  const cats = (catalog && Array.isArray(catalog.categories)) ? catalog.categories : [];

  const methodExists = (cat, method) => {
    if (!cat) return false;
    const row = cats.find((c) => c.code === cat);
    if (!row) return false;
    const ms = Array.isArray(row.methods_json) ? row.methods_json : [];    if (!method) return ms.length > 0 ? false : true;
    return ms.some((m) => m.code === method);
  };

  const positions = list.map((p, i) => {
    // Категория: берём у модели, но если она её не поставила (модель
    // нестабильна — проверено 06.11: 11/11 в одном прогоне и 0/11 в другом),
    // определяем по названию и единице. Пустая категория = позиция без нормы
    // и без денег, поэтому детерминированный подбор обязателен.
    let cat = p.category_code || p.category || null;
    let method = p.method_code || p.method || null;
    if (!cat) {
      const guess = guessCategory(p);
      if (guess) { cat = guess.category_code; method = method || guess.method_code; }
    }
    // Человеческие названия: код видит только РП в справочнике, в таблице
    // должно быть «Химическая промывка», а не `vessels.clean`.
    const catRow = cat ? cats.find((c) => c.code === cat) : null;
    const catName = (catRow && (catRow.title || catRow.name)) || null;
    const methodRow = (catRow && Array.isArray(catRow.methods_json))
      ? catRow.methods_json.find((m) => m && m.code === method) : null;
    const methodName = (methodRow && (methodRow.label || methodRow.name || methodRow.title)) || null;
    const volume = Number(p.volume);
    const unit = String(p.unit || '').trim();

    // Защита от подмены: модель иногда кладёт в volume ТРУДОЁМКОСТЬ,
    // а не объём («50 чел·ч» вместо «50 м³», тендер 2143 Hi Pro).
    // Трудоёмкость в поле объёма ломает весь расчёт, поэтому отсекаем.
    const unitLooksLikeLabor = /чел[·.\-]?\s*ч|чел[·.\-]?\s*см|чел[·.\-]?\s*дн|нормо[·.\-]?час|ч\/|час/i.test(unit);
    const volumeIsLabor = unitLooksLikeLabor && !/^(м|м2|м²|м3|м³|т|шт|труб|пластин|стык|цикл|п\.?м)$/i.test(unit);
    const knownCategory = !cat || cats.some((c) => c.code === cat);
    const knownMethod = !cat ? false : methodExists(cat, method);

    const problems = [];
    if (!isFinitePositive(volume)) problems.push('объём не указан');
    // ── Трудоёмкость вместо объёма — это НЕ ошибка ────────────────────────
    // Заказчик иногда сам считает норму: «зачистка 1800 мин» = 30 чел·ч.
    // Физического объёма нет, но и задача посчитать есть: берём его часы,
    // делим на смену и получаем срок и число людей. Справочник норм при этом
    // не используется — норму уже дал заказчик.
    //
    // Раньше это помечалось проблемой «нужен объём работ», и анализ
    // остановить было нечем: РП видел красный флаг там, где всё в порядке
    // (тендер 2143 Hi Pro — только трудоёмкость в минутах).
    if (unitLooksLikeLabor) {
      // Не проблема. Ниже считаем по часам.
      // Но РП должен видеть, что цифра в объёме — это ТРУДОЁМКОСТЬ, а не
      // объём: иначе «50 чел·ч» выглядит как потерянный объём.
      problems.push('в объёме указана трудоёмкость (чел·ч), а не объём — считаем по часам');
    }
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
      // id позиции. Он обязан быть УНИКАЛЬНЫМ между раундами и порциями:
      // модель нумерует позиции с 1 в каждом ответе, поэтому `p1` из первого
      // раунда и `p1` из второго — это РАЗНЫЕ позиции. Раньше id получался
      // из индекса в текущей порции, и на 2000 позициях оставалось 250
      // уникальных: связи «позиция → план → смета» рвались, часть позиций
      // не попадала в расчёт.
      //
      // Теперь: сначала id из ответа (если он не занят), иначе уникальный с
      // учётом уже выданных.
      id: uniquePositionId(p.id, usedIds, i),
      name: String(p.name || '').trim() || '(без названия)',
      category_code: cat,
      method_code: method,
      category_name: catName,
      method_name: methodName,
      volume: isFinitePositive(volume) && !unitLooksLikeLabor ? volume : null,
      unit,
      // ── Альтернативные единицы (V472) ────────────────────────────────────
      // Как объём задан в ВОР на самом деле: «1750 м²», «1353 т», «12 дюймов».
      // Норма считает в своей единице, поэтому храним и измеренное, и параметры
      // пересчёта (толщина, плотность), чтобы РП мог их поправить.
      measured_unit: unit || null,
      measured_value: isFinitePositive(volume) && !unitLooksLikeLabor ? volume : null,
      // Трудоёмкость из поля объёма: сохраняем отдельно, чтобы не потерять
      // часы заказчика. volume при этом остаётся null — это НЕ объём.
      labor_hours_input: unitLooksLikeLabor && isFinitePositive(volume) ? volume : null,
      is_labor_input: !!unitLooksLikeLabor,
      conversion_params: {
        thickness_mm: Number(p.thickness_mm) > 0 ? Number(p.thickness_mm) : null,
        density_t_m3: Number(p.density_t_m3) > 0 ? Number(p.density_t_m3) : null,
        dn_mm: Number(p.dn_mm) > 0 ? Number(p.dn_mm) : null,
        length_m: Number(p.length_m) > 0 ? Number(p.length_m) : null,
        area_per_plate_m2: Number(p.area_per_plate_m2) > 0 ? Number(p.area_per_plate_m2) : null,
        deposit_type: String(p.deposit_type || '').trim() || null
      },
      conversion_note: null,
      fouling: ['light', 'medium', 'heavy'].includes(String(p.fouling)) ? p.fouling : null,
      tech_equip: String(p.tech_equip || p.technology || '').trim() || null,
      tech_status: p.tech_status === 'rp' ? 'rp' : 'ai',
      source_ref: p.source_ref && typeof p.source_ref === 'object'
        ? { document: p.source_ref.document || null, fragment: p.source_ref.fragment || null }
        : (p.source_ref ? { document: String(p.source_ref), fragment: null } : null),

      // ── Откуда взят объём (требование РП 07.11.2026) ───────────────────
      // РП должен видеть доказательство: объём из ВОР, из ТЗ, по паспорту
      // оборудования или досчитан самим РП. Без этого цифра не проверяема.
      //   vor      — ведомость объёмов / дефектная ведомость заказчика;
      //   tz       — объём прямо написан в техническом задании;
      //   passport — паспортные данные марки (справочник или веб-поиск);
      //   history  — из истории по этому заказчику;
      //   geometry — досчёт по геометрии аппарата (S/(π·d·L));
      //   rp       — ввёл РП вручную;
      //   none     — источник не определён, требует проверки.
      volume_source: normalizeVolumeSource(p),
      volume_proof: buildVolumeProof(p),

      // confidence приходит словом ('high'|'medium'|'low') или числом.
      // Раньше строковое значение отбрасывалось в null, и РП не видел,
      // что позиция посчитана по паспорту, а не по ВОР.
      confidence: normalizeConfidence(p.confidence),
      // Аппараты позиции: тег («Т-1», «РВС-5000») отличает ту же работу по
      // разным аппаратам. Без этого поля дедупликация схлопывала их в одну,
      // и позиции терялись (D-дефект: dupKey не видел тег).
      objects: posObjects,
      // ── Когда делаем (график заездов) ───────────────────────────────────
      // Одна мойка в сентябре и та же в декабре — две позиции. Поле period
      // держит человеческий ярлык («сентябрь 2027»), period_start/end —
      // ISO-даты если есть, visit_id связывает позиции одного заезда.
      period: String(p.period || p.when || p.timing || '').trim().slice(0, 80) || null,
      period_start: normalizeLooseDate(p.period_start || p.start_date || p.date_from),
      period_end: normalizeLooseDate(p.period_end || p.end_date || p.date_to),
      visit_id: String(p.visit_id || p.visit || '').trim().slice(0, 40) || null,
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
    // ── График заездов (ответ модели) ───────────────────────────────────────
    // Модель читает график в ЛЮБОМ виде: ВОР, отдельный файл, пункт ТЗ,
    // таблица, фраза «в сентябре и декабре». Единого шаблона нет, поэтому
    // режим и заезды просит именно модель, а schedule-extract страхует.
    schedule_mode: ['continuous', 'visits', 'unknown'].includes(String(raw.schedule_mode))
      ? String(raw.schedule_mode) : null,
    visits: (Array.isArray(raw.visits) ? raw.visits : [])
      .filter((v) => v && typeof v === 'object')
      .map((v, i) => ({
        id: String(v.id || `v${i + 1}`).slice(0, 40),
        label: String(v.label || v.period || `Заезд ${i + 1}`).slice(0, 80),
        period_start: normalizeLooseDate(v.period_start || v.start),
        period_end: normalizeLooseDate(v.period_end || v.end),
        position_ids: Array.isArray(v.position_ids) ? v.position_ids.map(String) : []
      })),
    trip_count: Number(raw.trip_count) > 0 ? Math.round(Number(raw.trip_count)) : null,
    // ── МТР: модель предлагает расходники по документам ──────────────────
    // Промпт просит `mtr_suggestions`, модалка анализа их ждёт и раскладывает
    // в техплан, но ЭТА функция их выбрасывала: РП видел «Перечень не
    // заполнен» на каждом тендере (найдено 09.11.2026). Нормализуем здесь,
    // чтобы контракт промпт → БД → модалка был замкнут.
    mtr_suggestions: (Array.isArray(raw.mtr_suggestions) ? raw.mtr_suggestions : [])
      .filter((m) => m && String(m.name || '').trim())
      .map((m) => {
        // Источник важен для сметы: со склада — бесплатно для закупки,
        // покупка — отдельная строка затрат. Раньше всё сводилось к doc/typical,
        // и «на складе есть» и «надо купить» выглядели одинаково.
        const src = String(m.source || '').toLowerCase();
        const source = src === 'warehouse' ? 'warehouse'
          : src === 'purchase' ? 'purchase'
            : src === 'typical' ? 'typical' : 'doc';
        return {
          name: String(m.name).trim().slice(0, 200),
          qty: Number(m.qty) > 0 ? Number(m.qty) : null,
          unit: String(m.unit || '').trim().slice(0, 20) || null,
          purpose: String(m.purpose || '').trim().slice(0, 200) || null,
          source
        };
      }),
    // Поля для карточки ТО. Раньше промпт их не просил, и РП видел пустые
    // «Суть для ТО», «Риски», «Выполнимость» — приходилось заполнять руками.
    summary: String(raw.summary || '').trim() || null,
    volume_summary: String(raw.volume_summary || '').trim() || null,
    feasibility: ['yes', 'no', 'conditional'].includes(String(raw.feasibility))
      ? raw.feasibility : null,
    feasibility_note: String(raw.feasibility_note || '').trim() || null,
    competition: ['low', 'medium', 'high', 'unknown'].includes(String(raw.competition))
      ? raw.competition : null,
    risks: String(raw.risks || '').trim() || null,
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
  const allow = ['volume', 'unit', 'category_code', 'method_code', 'fouling', 'tech_equip', 'rp_note', 'approved',
    // Альтернативные единицы: РП может поправить толщину, плотность и диаметр.
    'thickness_mm', 'density_t_m3', 'dn_mm', 'length_m', 'area_per_plate_m2', 'deposit_type'];
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
  const maxPosts = Math.max(1, Number(opts && opts.max_parallel_posts) || 2);

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
      // Человеко-часы по норме: если есть, срок считается из инварианта MH,
      // даже когда модель не дала суток (иначе work_days = null).
      mh: Number(p.mh) > 0 ? Number(p.mh) : null,
      // Признаки условий работ: определяют наблюдающего и спецроли.
      work_scope: p.work_scope || null,
      hazard: Array.isArray(p.hazard) ? p.hazard : null,
      // Описание работ: по нему crew-plan отличает химию от механики.
      // Без переноса этих полей «кислота с ингибитором» терялась, и химик
      // добавлялся только если реагент угадывался в НАЗВАНИИ позиции —
      // а названия бывают обезличенными («Поз. 108-С»).
      tech_equip: p.tech_equip || p.equipment_note || null,
      method_name: p.method_name || null,
      category_name: p.category_name || null,
      category_code: p.category_code || null,
      foul_type: p.foul_type || p.fouling || null,
      // Базис нормы: gross-норма уже содержит внутрисменные потери.
      // Без переноса флаг теряется, и потери вычитаются повторно.
      norm_basis: p.norm_basis || (p.norm && p.norm.norm_basis) || null,
      crew_locked: !!p.crew_locked,
      // Объекты — из них считаются ФРОНТЫ (сколько бригад встанет
      // одновременно). Без переноса fronts=1 на любой ведомости, бригада
      // одна, а срок складывается как сумма суток всех позиций (516 суток
      // на 621 позицию вместо реальных ~90).
      objects: Array.isArray(p.objects) ? p.objects : null,
      // Число объектов отдельным полем: массив — это состав, а сколько их
      // бывает числом от модели / objects_count. Без него fronts=1.
      objects_count: (() => {
        if (Array.isArray(p.objects)) {
          const q = p.objects.reduce((a, o) => a + (Number(o && o.qty) || 0), 0);
          return q > 0 ? q : p.objects.length;
        }
        if (Number(p.objects_count) > 0) return Number(p.objects_count);
        return Number(p.objects) > 0 ? Number(p.objects) : null;
      })(),
      parallel_group: p.parallel_group != null ? String(p.parallel_group) : '0',
      equipment: Array.isArray(p.equipment) ? p.equipment : [],
      source,
      source_ref: p.source_ref || null,
      explain: String(p.explain || '').trim() || null,
      approved: !!p.approved,
      problems: [
        !people ? 'не указано число людей' : null,
        // Срок может быть задан через mh — тогда «не указан срок» не проблема.
        !days && !(Number(p.mh) > 0) ? 'не указан срок' : null,
        source === 'expert' && !String(p.explain || '').trim() ? 'экспертная оценка без обоснования' : null
      ].filter(Boolean)
    };
  });

  /**
   * Группы параллельности.
   *
   * Дефект 06.11: модель ставила 34 позиции в ОДНУ группу, а прежний код
   * трактовал группу как «одновременно» (срок = максимум). Выходило
   * «34 позиции за 3 суток силами 102 человек» — враньё: 102 это сумма
   * бригад по всем позициям, и одновременно они не работают.
   *
   * Правильная модель:
   *   • внутри группы работает ОДНА бригада и идёт ПОСЛЕДОВАТЕЛЬНО, поэтому
   *     срок группы = сумма суток её позиций;
   *   • группы идут ПАРАЛЛЕЛЬНО, поэтому срок плана = максимум по группам;
   *   • людей на объекте = не сумма по всем позициям, а сумма бригад
   *     одновременно работающих групп (пик).
   *
   * ГЛАВНОЕ — уложиться в срок заказчика. Когда модель поставила 41 позицию
   * в 5 бригад и вышло 184 суток, это неверный ответ: при 2–3 бригадах и
   * 41 позиции работы идут ПО ОЧЕРЕДИ, и срок считается от числа бригад,
   * а не от того, как модель разложила их по группам.
   *
   * Поэтому здесь считается минимально необходимый срок:
   *   1. Срок одной бригады = сумма суток всех позиций (все работы по очереди).
   *   2. Чтобы уложиться в окно заказчика, нужно
   *      бригад = ceil(срок одной бригады / окно), но не больше maxCrews.
   *   3. Итоговый срок = ceil(срок одной бригады / бригад) — то есть работы
   *      реально делятся между бригадами поровну и идут параллельно.
   * Людей на объекте = бригады × численность бригады (пик).
   *
   * Если и на максимуме бригад в окно не влезаем — срок честно остаётся
   * больше окна с предупреждением. Подгонять цифру нельзя.
   */
  // ── Трудоёмкость плана: люди × сутки ──────────────────────────────────────
  // Было: `totalCrewDays = Σ days` — то есть 10 позиций по 5 человек и по одним
  // суткам давали 10 «бригадо-суток» вместо 50 чел·суток. Срок и, как следствие,
  // себестоимость не зависели от того, сколько людей реально нужно.
  //
  // Теперь считаем в двух мерах:
  //   • personDays — человеко-сутки (people × days), реальный объём труда;
  //   • crewDays   — бригадо-сутки (days × бригад на позицию), из них срок.
  // Бригад на позицию = ceil(people / CREW_SIZE): если нужно 12 человек, это
  // три бригады по 5, а не одна, которая «растянется». Так и объём, и срок
  // растут от позиций, и малая бригада не даёт заниженный срок.
  const personDays = positions.reduce(
    (s, p) => s + Math.max(1, Number(p.people) || 1) * Math.max(0, Number(p.days) || 0),
    0
  );
  const windowDays = Number(opts && opts.window_days) > 0 ? Number(opts.window_days) : null;

  // ── Трудоёмкость из ТЗ: срок считаем по часам, а не по нормам ────────────
  // Часть заказчиков присылает не объёмы, а готовую норму: «зачистка 1800 мин»
  // = 30 чел·ч (тендер 2143 Hi Pro). Тогда справочник не нужен — норму дал
  // заказчик. Считаем срок и число бригад из этих часов (labor-plan), а
  // мастер/ИТР добавляем СВЕРХ фонда заказчика: его часы — только рабочие.
  //
  // Без этого модуля такой тендер давал work_days = null и просчёт не
  // создавался вовсе (найдено верификатором 09.11.2026).
  const laborPlan = require('./labor-plan');
  const laborHours = (() => {
    let sum = 0;
    for (const p of positions) {
      const unit = String(p.unit || '').toLowerCase();
      const vol = Number(p.volume) || 0;
      if (!(vol > 0)) continue;
      const hours = laborPlan.toLaborHours(vol, unit);
      if (hours > 0) sum += hours;
    }
    return sum;
  })();
  const laborSchedule = laborHours > 0
    ? laborPlan.planByLabor({
      laborHours,
      workers: Math.max(1, Number(opts && opts.workers) || 10),
      shiftHours: Number(opts && opts.shift_hours) || undefined,
      shiftsPerDay: Number(opts && opts.shifts_per_day) || undefined
    })
    : null;

  // ── Бригады и срок ────────────────────────────────────────────────────────
  // Раньше здесь было жёстко: состав «1 мастер + 4 слесаря», наблюдающий
  // «1 на бригаду», ОЗП определялся по слову «аппарат» — и АВО (наружная
  // чистка) ошибочно получал наблюдающего внутри. Теперь состав выводится
  // из crew-plan (роли, ОЗП 1:1, hazard), а срок — из schedule-model.
  const crewPlan = require('./crew-plan');
  const scheduleModel = require('./schedule-model');

  const CREW_SIZE = Math.max(2, Number(opts && opts.crew_size) || 5);
  const maxWorkersPerCrew = Math.max(1, CREW_SIZE - 1);
  const maxCrews = Math.max(2, Number(opts && opts.max_crews) || 6);
  const masterSpan = Math.max(1, Number(opts && opts.master_span) || 4);
  const observerRatio = Number(opts && opts.observer_ratio) > 0 ? Number(opts.observer_ratio) : 1;
  const duplierRatio = Number(opts && opts.duplier_ratio) > 0 ? Number(opts.duplier_ratio) : 1;

  // Бригадо-сутки: сколько бригад одновременно занято на позиции × её сутки.
  const crewDays = positions.reduce((s, p) => {
    const people = Math.max(1, Number(p.people) || 1);
    const days = Math.max(0, Number(p.days) || 0);
    return s + Math.ceil(people / CREW_SIZE) * days;
  }, 0);

  // ── Заезды: режим и число выездов ────────────────────────────────────────
  // Число бригад здесь БОЛЬШЕ НЕ СЧИТАЕТСЯ. Раньше тут жила эвристика
  // (crewDays > 90 → maxCrews), и она давала свой C, пока resolveSchedule —
  // свой. В итоге в плане было 30 человек по сроку и 15 по составу.
  // Теперь C = scheduleResolved.crews (ниже), а бригадо-сутки и срок
  // пересчитываются от него же.
  const visitsMode = String(opts && opts.visit_mode) === 'visits';
  const tripCountOpt = Number(opts && opts.trip_count) > 0 ? Math.round(Number(opts.trip_count)) : 1;


  // ── Состав бригад: роли выводятся из позиций, а не из константы ─────────
  // crew-plan знает про ОЗП (наблюдающий 1:1 к исполнителям ВНУТРИ аппарата),
  // газоопасные (дежурный снаружи), огневые (сварщик), реагенты (химик).
  // Раньше наблюдающий ставился «1 на бригаду», и 5 человек внутри ёмкости
  // оставались без второго наблюдающего — нарушение 902н.
  const crewSummary = crewPlan.summarizeCrew({
    positions: positions.map((p) => ({
      name: p.name,
      tech_equip: p.tech_equip,
      method_name: p.method_name,
      category_name: p.category_name,
      work_scope: p.work_scope,
      hazard: p.hazard,
      people: p.people,
      crew_locked: p.crew_locked,
      mh: p.mh
    })),
    crew_span: CREW_SIZE,
    master_span: masterSpan,
    observer_ratio: observerRatio,
    duplier_ratio: duplierRatio
  });

  // Человеко-часы: если у позиции задано mh (норма дала готовые чел·часы),
  // берём его. Иначе считаем люди × сутки × часы смены.
  //
  // КРИТИЧНО: число смен ДОЛЖНО быть тем же, что пойдёт в resolveSchedule.
  // Раньше здесь стояло `p.shifts || 2`, а ниже — `shiftsFromPositions || 1`.
  // На одних данных man_hours считался по 24 ч/сутки (15 744), а срок — по
  // 12 ч/сутки: срок выходил вдвое длиннее, и Σqty в смете не совпадала с PS.
  // Теперь смены определяются ОДИН раз и используются в обоих местах.
  const shiftsFromPositions = positions.reduce((m, p) => Math.max(m, Number(p.shifts) || 0), 0);
  const shiftsPerDayOpt = Number(opts && opts.shifts_per_day) > 0
    ? Number(opts.shifts_per_day)
    : (shiftsFromPositions || 1);

  const manHours = positions.reduce((s, p) => {
    const direct = Number(p.mh) || Number(p.labor_hours) || 0;
    if (direct > 0) return s + direct;
    const shifts = Number(p.shifts) > 0 ? Number(p.shifts) : shiftsPerDayOpt;
    return s + (p.people || 0) * (p.days || 0) * shifts * (p.shift_hours || 12);
  }, 0);

  // ── Срок по инварианту MH (расчётная модель v2) ──────────────────────────
  // Бригадо-сутки не видят главного: человеко-часы фиксированы, а срок
  // зависит от того, сколько людей работает ОДНОВРЕМЕННО и сколько смен.
  // resolveSchedule считает: work_days = MH / (crew_size × C × h_net × s).
  // В заездах работы последовательны: параллелить можно только по фронтам
  // (числу аппаратов), а не «виртуальными» бригадами.
  // Часы смены: из явного opts, иначе из позиций, иначе 12.
  // Раньше бралось только из opts: позиции с shift_hours=8 считались по 12,
  // и C выходил меньше нужного (занижали бригады и завышали срок).
  const shiftHoursFromPositions = positions.reduce((m, p) => Math.max(m, Number(p.shift_hours) || 0), 0);
  const shiftHoursOpt = Number(opts && opts.shift_hours) > 0
    ? Number(opts.shift_hours)
    : (shiftHoursFromPositions || 12);
  // Смены уже определены выше (shiftsPerDayOpt) — здесь только часы смены.
  // Фронты: сколько бригад может работать ОДНОВРЕМЕННО. Если объекты в
  // позициях не заданы, `fronts_known: false` — это НЕ «один аппарат»,
  // а «данных нет». Разница важна: при неизвестных фронтах окно заказчика
  // может увеличить число бригад, при известном одном аппарате — нет.
  // Фронты — сколько бригад работает ОДНОВРЕМЕННО. Считаем по СУММАРНОМУ
  // числу аппаратов во всех позициях, а не по длине массива `objects`.
  //
  // Дефект 12.11: `objects` у позиции — это ОПИСАНИЕ аппарата (обычно один
  // элемент: «{tag:'2104L', size:'Ø18 L=6090 N=899'}' )», и длина массива
  // давала fronts=1 на 621 позицию. Из-за этого бригада оставалась одна,
  // а срок складывался как сумма суток всех позиций (516 суток).
  // objects_count — когда массив objects потерян (скрипт передал число,
  // модель отдала count без состава). Без него fronts=1 на всей ведомости.
  const objectsTotal = positions.reduce((s, p) => {
    const objs = Array.isArray(p.objects) ? p.objects : [];
    const q = objs.reduce((acc, o) => acc + (Number(o && o.qty) || 0), 0);
    if (q > 0) return s + q;
    if (objs.length > 0) return s + objs.length;
    const cnt = Number(p.objects_count);
    if (cnt > 0) return s + cnt;
    // Число в поле objects (ошибка маппинга length→objects) тоже фронт.
    if (!Array.isArray(p.objects) && Number(p.objects) > 0) return s + Number(p.objects);
    return s;
  }, 0);
  const frontsExplicit = Number(opts && opts.fronts) > 0;
  const frontsResolved = scheduleModel.resolveFronts({
    objects: frontsExplicit ? Number(opts.fronts) : (objectsTotal || null),
    manual: Number(opts && opts.fronts_manual) || null
  });
  const frontsKnown = frontsExplicit || objectsTotal > 0 || Number(opts && opts.fronts_manual) > 0;

  // ── Базис нормы: передаётся из каталога, а не гадается ────────────────────
  // gross_12h (8 норм min_per_unit) уже содержит внутрисменные потери в
  // коэффициенте k_irv. Если вычесть их ЕЩЁ РАЗ, срок вырастет, а деньги
  // уедут. Защита была написана, но флаг никто не передавал — и она
  // оставалась мёртвой на реальном контуре.
  //
  // Берём базис по позициям: если у всех норм одинаковый — он и есть; если
  // разные — считаем «net_productive» (осторожнее: потери добавим), а
  // расхождение отмечаем, чтобы РП видел.
  const bases = positions
    .map((p) => p.norm_basis || (p.norm && p.norm.norm_basis))
    .filter(Boolean);
  const uniqBases = [...new Set(bases)];
  const normBasis = uniqBases.length === 1
    ? uniqBases[0]
    : (uniqBases.length === 0 ? ((opts && opts.norm_basis) || 'net_productive') : 'net_productive');
  const normBasisMixed = uniqBases.length > 1;

  const scheduleResolved = scheduleModel.resolveSchedule({
    mh: manHours,
    shift_hours: shiftHoursOpt,
    shifts_per_day: shiftsPerDayOpt,
    crew_size: CREW_SIZE,
    trips: Number(opts && opts.trip_count) || 1,
    mob_days: Number(opts && opts.mob_days) || 0,
    road_days: Number(opts && opts.road_days) || 0,
    window_days: windowDays,
    fronts: frontsResolved.fronts,
    fronts_known: frontsKnown,
    max_crews: maxCrews,
    available_crews: Number(opts && opts.available_crews) || null,
    norm_basis: normBasis
  });

// Срок от бригадо-суток остаётся как справочный (его сверяет work_days_check),
  // но считается от того же C, что и состав.
  const crewsForDays = Math.max(1, Number(scheduleResolved.crews) || 1);
  const rawDays = crewDays / crewsForDays;
  const workDays = Math.round(rawDays * 100) / 100;

  // Собираем состав по ролям: базовая бригада × число бригад + спецроли.
  const roleTotals = new Map();
  const addRole = (code, role, count, note) => {
    if (!(count > 0)) return;
    const cur = roleTotals.get(code) || { role_code: code, role, count: 0, shifts_per_day: null, note };
    cur.count += count;
    roleTotals.set(code, cur);
  };

  // ── Единственный источник числа бригад — resolveSchedule ────────────────
  // Было: состав считался по `crews` (эвристика бригадо-суток), а срок — по
  // C из resolveSchedule. На одном плане получалось 30 человек в сроке и
  // 15 в составе. Теперь C берётся ТОЛЬКО отсюда, и `crews` ниже равен ему.
  // Единственный источник числа бригад — resolveSchedule. Состав и срок
  // считаются от одного C, иначе в плане две разные численности.
  const crews = Math.max(1, Number(scheduleResolved.crews) || 1);
  const basePeak = crewSummary.base_people_peak || (CREW_SIZE - 1);
  // На бригаду: мастер + слесари. Мастеров считаем по master_span.
  const mastersPerCrew = Math.max(1, Math.ceil((basePeak - 1) / masterSpan));
  const workersPerCrew = Math.max(1, basePeak - mastersPerCrew);
  addRole('itr', 'ИТР (РП)', 1, 'на все бригады');
  addRole('master', 'Мастер / бригадир', mastersPerCrew * crews, '');
  addRole('worker', 'Слесарь', workersPerCrew * crews, '');

  // Спецроли — по признакам опасности, найденным в позициях.
  const specialPeak = new Map();
  for (const plan of crewSummary.plans) {
    for (const r of plan.roles) {
      if (crewPlan.BASE_ROLES.includes(r.role_code)) continue;
      specialPeak.set(r.role_code, Math.max(specialPeak.get(r.role_code) || 0, r.count));
    }
  }
  for (const [code, count] of specialPeak) {
    addRole(code, crewPlan.ROLE_LABEL[code] || code, count, 'по признакам работ');
  }

  // ── Уровень тендера: ИТР и ПТО ────────────────────────────────────────────
  // Это роли НА ОБЪЕКТ, а не в каждой бригаде: один ИТР на все бригады, ПТО
  // подключается на объёмных работах. Раньше вызывалось из normalizeCalcPlan
  // напрямую, при переходе на crew-plan вызов потерялся — и ПТО исчезло из
  // состава молча (нашёл верификатор). Возвращаем: без ПТО нет приёмки
  // скрытых работ, а это статья затрат.
  try {
    const tenderRoles = crewPlan.planTenderCrew({
      positions: positions.length,
      crews,
      pto_threshold: Number(opts && opts.pto_threshold) || 10
    });
    for (const tr of tenderRoles) {
      // ИТР уже добавлен выше как одна роль — не дублируем.
      if (tr.role_code === 'itr') continue;
      addRole(tr.role_code, crewPlan.ROLE_LABEL[tr.role_code] || tr.role_code, tr.count, tr.reason);
    }
  } catch (_) { /* расчёт состава не должен валить план */ }

  // Совместимость: прежние поля observer/chemist считались отдельно. Их
  // больше нет — роли уже в составе выше. Флаги оставляем для отчёта.
  const insideWork = crewSummary.inside_any;
  const chemWork = crewSummary.hazard.includes('chem');

  const crewRows = [...roleTotals.values()];
  // Раскладка по бригадам — для показа в техплане.
  const crewList = [];
  for (let i = 1; i <= crews; i += 1) {
    const rows = [
      { role_code: 'master', role: 'Мастер / бригадир', count: mastersPerCrew, shifts_per_day: null, note: `бригада ${i}` },
      { role_code: 'worker', role: 'Слесарь', count: Math.max(1, basePeak - mastersPerCrew), shifts_per_day: null, note: `бригада ${i}` }
    ];
    for (const [code, count] of specialPeak) {
      rows.push({
        role_code: code,
        role: crewPlan.ROLE_LABEL[code] || code,
        count,
        shifts_per_day: null,
        note: `бригада ${i}`
      });
    }
    crewList.push(rows);
  }

  const peopleTotal = crewRows.reduce((s, r) => s + (Number(r.count) || 0), 0);

  // Группы оставляем как есть — это раскладка модели по бригадам, полезна
  // для показа, но срок больше не выводится из неё.
  const groups = new Map();
  for (const p of positions) {
    const k = String(p.parallel_group ?? '0');
    groups.set(k, Math.round((groups.get(k) || 0) + (Number(p.days) || 0)));
  }


  const fitsWindow = !!windowDays && workDays <= windowDays;

  // ── Один срок на весь контур ──────────────────────────────────────────────
  // План и смета считали срок по-разному: план — по человеко-суткам позиций,
  // смета — по `params.work_days`, который приходил из настроек/модели. На
  // проде это давало два разных срока у одного тендера (2133: план 1440 ч,
  // смета 2016 ч — 40 % расхождения). Теперь срок плана фиксируется явно и
  // уходит в смету тем же значением: `schedule.work_days = params.work_days`.
  // ── Срок: инвариант MH применяется, только если суток НЕТ ────────────────
  // Если модель дала `days` по позиции, срок уже определён: days × бригад.
  // Пересчитывать его через человеко-часы нельзя — это двойной счёт и
  // перезапись расчёта модели. MH здесь работает как СВЕРКА: если два пути
  // расходятся больше чем на 15 %, РП должен это увидеть.
  //
  // Если `days` нет, а есть только объём (mh по норме), тогда инвариант —
  // единственный способ получить срок.
  const hasExplicitDays = positions.some((p) => Number(p.days) > 0);
  const mhWork = positions.reduce(
    (s, p) => s + (Number(p.people) || 0) * (Number(p.days) || 0) * (Number(p.shift_hours) || 12),
    0
  );
  const mhDays = scheduleResolved.work_days;

  let finalWorkDays;
  let workDaysSource;
  if (laborSchedule) {
    finalWorkDays = laborSchedule.days;
    workDaysSource = 'tz_labor_hours';
  } else if (mhDays != null && mhDays > 0) {
    // ПРИОРИТЕТ MH. Он единственный согласован с деньгами: смета считает
    // qty = work_days × смены × люди, и произведение должно давать ровно
    // человеко-часы из норм. Срок «по сумме суток позиций» (crew_days)
    // этого не гарантирует: на 621 позиции он давал 516 суток при MH,
    // рассчитанном на 86, и Σqty расходилась с MH на 69 %.
    //
    // `hasExplicitDays` больше не перебивает MH: модель часто ставит
    // days=1 «на глаз», а норма даёт точные часы. Расхождение фиксируется
    // в workDaysCheck, чтобы РП видел разницу, но срок берётся из MH.
    finalWorkDays = mhDays;
    workDaysSource = 'mh_invariant';
  } else {
    // Ни нормы (MH), ни суток от модели нет: срок — от бригадо-суток, если
    // они есть. Пусто остаётся пустым: выдумывать срок нельзя.
    finalWorkDays = workDays || null;
    workDaysSource = 'crew_days';
  }
  // Сверка двух путей — только когда оба дали число.
  let workDaysCheck = null;
  if (hasExplicitDays && mhDays != null && mhDays > 0 && workDays > 0) {
    const delta = Math.abs(workDays - mhDays) / workDays;
    workDaysCheck = {
      crew_days: workDays,
      mh_invariant: mhDays,
      delta_pct: Math.round(delta * 1000) / 10,
      diverged: delta > 0.15
    };
  }

  // Заезды: приоритет у РП/анализа — opts.trip_count (это ответ пользователя
  // или visit_plan), затем ответ модели, затем периоды позиций ДВ
  // (сентябрь ≠ декабрь). Раньше opts.trip_count применялся только к
  // work_days_per_trip, а сам trip_count брался из ответа модели: подтверждённые
  // РП 6 выездов превращались в 1, и дорога/проживание занижались в 6 раз
  // (дефект D1 верификатора 10.11.2026).
  const optTrips = Number(opts && opts.trip_count) > 0 ? Math.round(Number(opts.trip_count)) : 0;
  const modelTrips = Number(raw.trip_count) > 0 ? Math.round(Number(raw.trip_count)) : 0;
  const fromPositions = deriveVisitCount(
    (opts && opts.dv_positions) || list.map((p) => ({
      visit_id: p.visit_id, period: p.period, period_start: p.period_start, when: p.when
    }))
  );
  const tripCount = Math.max(1, optTrips || modelTrips || fromPositions || 1);
  // Сколько выездов в самих visits — если модель их перечислила, число берём
  // оттуда: пустой trip_count при 3 visits оставлял смету на одном выезде.
  const rawVisitsCount = Array.isArray(raw.visits)
    ? raw.visits.filter((v) => v && (v.id || v.period || v.label)).length : 0;
  // Если модель/анализ перечислили заезды — число выездов равно их числу.
  // Иначе получалось «trip_count 5, заездов 1»: смета считала дорогу и
  // проживание за 5 приездов, а график показывал один (дефект 12.11.2026
  // на #2138, где 5 пришло из сжатого ответа модели, а заезд был один).
  const finalTripCount = rawVisitsCount > 0
    ? rawVisitsCount
    : Math.max(1, tripCount);
  const visits = Array.isArray(raw.visits)
    ? raw.visits.filter((v) => v && (v.id || v.period || v.label)).map((v, i) => ({
      id: String(v.id || `v${i + 1}`).slice(0, 40),
      label: String(v.label || v.period || v.id || `Заезд ${i + 1}`).slice(0, 80),
      period_start: normalizeLooseDate(v.period_start || v.start),
      period_end: normalizeLooseDate(v.period_end || v.end),
      position_ids: Array.isArray(v.position_ids) ? v.position_ids.map(String) : []
    }))
    : [];

  // ── Трудосутки по заездам (P2, 12.11.2026) ──────────────────────────────
  // `work_days` — трудосутки ВСЕГО объёма при текущем C, и они же знаменатель
  // ФОТ и проживания в смете. Менять их на «сумму заездов» нельзя: при том же
  // C сумма даёт ту же цифру, а при другом — разваливает смету. Что РП
  // действительно нужно видеть — сколько трудосуток приходится на КАЖДЫЙ
  // выезд и влезает ли это в окно его периода.
  //
  // Делим по доле человеко-часов заезда от общего MH: Σ по заездам = итог,
  // расхождения только на округлении копеек.
  const visitDayShare = distributeWorkDaysByVisits({
    visits,
    positions,
    totalWorkDays: finalWorkDays,
    mobDays: Number(opts && opts.mob_days) || Number(raw.mob_days) || 0,
    roadDays: Number(opts && opts.road_days) || Number(raw.road_days) || 0
  });

  return {
    positions,
    // Срок по трудоёмкости заказчика главнее расчёта по позициям: если он дал
    // часы, значит норму уже посчитал он (тендер 2143 Hi Pro).
    work_days: finalWorkDays,
    // Срок в режиме заездов: работа идёт последовательно по выездам, поэтому
    // суммарный календарный срок = сутки работ + дорога/мобилизация на каждый
    // выезд. Без этого «6 заездов за 16 дней» физически невозможно.
    // Считаем честно и отдаём наружу: visits_mode_sequential объясняет, почему
    // срок больше, чем crewDays / crews.
    work_days_per_trip: visitDayShare.perTrip != null
      ? visitDayShare.perTrip
      : (visitsMode && tripCountOpt > 1
        ? Math.round((workDays / tripCountOpt) * 100) / 100
        : null),
    // Разрез по заездам: трудосутки, люди и проверка «влезает ли в окно».
    // Σ visit.work_days == work_days (расхождение только на округлении).
    visits_work: visitDayShare.perVisit,
    visits_work_total: visitDayShare.total,
    visit_window_check: visitDayShare.windowCheck,
    trips_sequential: visitsMode && tripCountOpt > 1,
    labor_hours: laborSchedule ? laborSchedule.labor_hours : null,
    labor_basis: laborSchedule
      ? 'трудоёмкость из ТЗ: ' + laborSchedule.note
      : null,
    road_days: Number(raw.road_days) > 0 ? Number(raw.road_days) : null,
    trip_count: finalTripCount,
    visits,
    people_total: peopleTotal || null,
    crews,
    crew_size: CREW_SIZE,
    // ── Расчётная модель v2: люди, смены, пик, потери ──────────────────────
    // Пик одновременно работающих людей — не сумма ролей, а смен × бригад.
    headcount_shift: scheduleResolved.headcount_shift,
    headcount_peak: scheduleResolved.headcount_peak,
    shifts_per_day: scheduleResolved.shifts_per_day,
    shift_hours: scheduleResolved.shift_hours,
    h_net: scheduleResolved.h_net,
    loss_min: scheduleResolved.loss_min,
    ps: scheduleResolved.ps,
    fronts: frontsResolved.fronts,
    fronts_known: frontsKnown,
    fronts_source: frontsResolved.source,
    objects_total: objectsTotal,
    work_days_source: workDaysSource,
    // Сверка двух путей срока: если разошлись больше чем на 15 %, это
    // сигнал РП, а не повод молча перезаписать одно другим.
    work_days_check: workDaysCheck,
    schedule_warnings: scheduleResolved.warnings.concat(
      frontsResolved.warning ? [frontsResolved.warning] : [],
      // Ответ модели назвал больше выездов, чем перечислил заездов. Частый
      // случай: модель сжала список, а число приездов оставила. Дорогу и
      // проживание считаем по РЕАЛЬНЫМ заездам (иначе переплата), но
      // молчать нельзя — РП должен знать, что ответ сжатый.
      (Number(raw.trip_count) > 0 && rawVisitsCount > 0 && Math.round(Number(raw.trip_count)) !== finalTripCount)
        ? `ответ модели: выездов ${Math.round(Number(raw.trip_count))}, заездов перечислено ${rawVisitsCount} — `
          + `дорога и проживание посчитаны по ${finalTripCount}; уточните график`
        : null
    ).filter(Boolean),
    shortfall: scheduleResolved.shortfall,
    // Состав бригад целиком: кто именно нужен (мастер, слесари, ИТР,
    // наблюдающий, химик, ПТО). Это уходит в техплан и в смету.
    crew: crewRows,
    crew_breakdown: crewList,
    // `total_crew_days` — историческое имя, но смысл теперь бригадо-сутки:
    // от них считается срок (crewDays / число бригад). Человеко-сутки — отдельно.
    total_crew_days: Math.round(crewDays * 100) / 100,
    person_days: Math.round(personDays * 100) / 100,
    window_days: windowDays,
    fits_window: windowDays ? fitsWindow : null,
    // Сумма бригад по всем позициям — не «люди на объекте», а объём работ.
    crew_shifts_total: positions.reduce((s, p) => s + (p.people || 0), 0),
    man_hours: Math.round(manHours),
    groups: [...groups.entries()].map(([g, d]) => ({ group: g, days: d })),
    parallel_groups: groups.size,
    max_parallel_posts: maxPosts,
    warnings: [
      windowDays && !fitsWindow
        ? `в срок ${windowDays} сут не укладывается: нужно ${workDays} сут даже при ${crews} бригадах — требуется больше людей или сдвиг срока`
        : null,
      !windowDays
        ? 'срок заказчика не задан — бригады подобраны по объёму работ, проверьте график'
        : null,
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
  const state = normalizeState(r.stage_state);

  // Дозаполнение доказательства объёма для сессий, сохранённых ДО 07.11.2026:
  // тогда полей volume_source/volume_proof ещё не было, и РП видел цифру
  // без указания источника. Пересчитываем на чтении — перегонять анализ
  // всех тендеров ради этого не нужно.
  if (Array.isArray(state.positions)) {
    for (const p of state.positions) {
      if (p.volume_source == null) p.volume_source = normalizeVolumeSource(p);
      if (p.volume_proof == null) p.volume_proof = buildVolumeProof(p);
      if (p.confidence == null && p.conf_legacy != null) p.confidence = normalizeConfidence(p.conf_legacy);
    }
  }

  return {
    session_uid: r.session_uid,
    tender_id: r.tender_id,
    stage: r.stage || 'intake',
    state,
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
  // Сохранение БЕЗ смены этапа разрешено всегда: это не переход, а запись
  // состояния (например плана просчёта, когда порядок этапов ещё не пройден).
  // Дефект 07.11: canTransition('dv','dv') возвращал false, saveStage падал,
  // и план просчёта молча терялся — в БД оставалось calc:{positions:[]}.
  if (nextStage !== cur.stage && !canTransition(cur.stage, nextStage)) {
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
  estimateExpectedPositions,
  countTableRowsInText,
  countTableRowsDetailed,
  dupKey,
  deriveVisitCount,
  distributeWorkDaysByVisits,
  canTransition,
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
