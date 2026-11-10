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
 *   • ТЕГ аппарата из objects («Т-1», «РВС-5000», «К-2»).
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
  return `${name}|${vol}|${unit}|${tag}`;
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
    // ── МТР: модель предлагает расходники по документам ──────────────────
    // Промпт просит `mtr_suggestions`, модалка анализа их ждёт и раскладывает
    // в техплан, но ЭТА функция их выбрасывала: РП видел «Перечень не
    // заполнен» на каждом тендере (найдено 09.11.2026). Нормализуем здесь,
    // чтобы контракт промпт → БД → модалка был замкнут.
    mtr_suggestions: (Array.isArray(raw.mtr_suggestions) ? raw.mtr_suggestions : [])
      .filter((m) => m && String(m.name || '').trim())
      .map((m) => ({
        name: String(m.name).trim().slice(0, 200),
        qty: Number(m.qty) > 0 ? Number(m.qty) : null,
        unit: String(m.unit || '').trim().slice(0, 20) || null,
        purpose: String(m.purpose || '').trim().slice(0, 200) || null,
        source: String(m.source || '').toLowerCase() === 'typical' ? 'typical' : 'doc'
      })),
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
  // Бригада — рабочая единица: 1 мастер + до 4 слесарей (CREW_SIZE).
  const CREW_SIZE = Math.max(2, Number(opts && opts.crew_size) || 5);
  const maxWorkersPerCrew = Math.max(1, CREW_SIZE - 1);
  const maxCrews = Math.max(2, Number(opts && opts.max_crews) || 6);

  // Бригадо-сутки: сколько бригад одновременно занято на позиции × её сутки.
  // 12 человек на 2 суток = 3 бригады × 2 сут = 6 бригадо-суток.
  const crewDays = positions.reduce((s, p) => {
    const people = Math.max(1, Number(p.people) || 1);
    const days = Math.max(0, Number(p.days) || 0);
    return s + Math.ceil(people / CREW_SIZE) * days;
  }, 0);

  // Сколько бригад ставим: чтобы уложиться в окно заказчика (если оно есть).
  let crews = 1;
  if (windowDays) {
    crews = Math.ceil(crewDays / windowDays);
    crews = Math.min(Math.max(crews, 1), maxCrews);
  } else {
    crews = crewDays > 90 ? maxCrews : (crewDays > 30 ? Math.min(2, maxCrews) : 1);
  }

  // Срок = бригадо-сутки / число бригад. Работы делятся между бригадами
  // поровну и идут параллельно, поэтому срок падает с ростом числа бригад.
  const rawDays = crews > 0 ? crewDays / crews : crewDays;
  const workDays = Math.round(rawDays * 100) / 100;

  // Бригады: в каждой 1 мастер + до 4 слесарей. На все бригады — один ИТР.
  const crewList = [];
  for (let i = 1; i <= crews; i += 1) {
    crewList.push([
      { role_code: 'master', role: 'Мастер / бригадир', count: 1, shifts_per_day: null, note: `бригада ${i}` },
      { role_code: 'worker', role: 'Слесарь', count: maxWorkersPerCrew, shifts_per_day: null, note: `бригада ${i}` }
    ]);
  }
  const crewRows = [];
  crewRows.push({ role_code: 'itr', role: 'ИТР (РП)', count: 1, shifts_per_day: null, note: 'на все бригады' });
  crewRows.push({ role_code: 'master', role: 'Мастер / бригадир', count: crews, shifts_per_day: null, note: '' });
  crewRows.push({
    role_code: 'worker', role: 'Слесарь',
    count: crews * maxWorkersPerCrew, shifts_per_day: null, note: ''
  });

  // Наблюдающий обязателен при работе ВНУТРИ аппарата (наряд-допуск):
  // сосуды, котлы, бункеры, каналы. Снаружи не нужен.
  const insideWork = positions.some((p) => {
    const t = `${p.name || ''} ${p.tech_equip || ''}`.toLowerCase();
    return /внутри|внутренн|днищ|бункер|резервуар|ёмкост|емкост|котл|канал|приямк|колодец|аппарат/.test(t);
  });
  if (insideWork) {
    crewRows.push({ role_code: 'observer', role: 'Наблюдающий', count: crews, shifts_per_day: null, note: 'работа внутри аппарата' });
  }

  // Химик нужен, если работают реагентами (промывка, пассивация, нейтрализация).
  const chemWork = positions.some((p) => {
    const t = `${p.name || ''} ${p.tech_equip || ''} ${p.category_code || ''}`.toLowerCase();
    return /хим|кислот|щелоч|реагент|промыв|пассивац|нейтрализ|cip|ингибитор/.test(t);
  });
  if (chemWork) {
    crewRows.push({ role_code: 'chemist', role: 'Химик', count: 1, shifts_per_day: null, note: 'реагентные работы' });
  }

  // ПТО / приёмка — на объёмных работах с приёмкой скрытых работ (больше 10 позиций).
  if (positions.length > 10) {
    crewRows.push({ role_code: 'pto', role: 'ПТО / приёмка', count: 1, shifts_per_day: null, note: 'приёмка объёмов' });
  }

  const peopleTotal = crewRows.reduce((s, r) => s + (Number(r.count) || 0), 0);

  // Группы оставляем как есть — это раскладка модели по бригадам, полезна
  // для показа, но срок больше не выводится из неё.
  const groups = new Map();
  for (const p of positions) {
    const k = String(p.parallel_group ?? '0');
    groups.set(k, Math.round((groups.get(k) || 0) + (Number(p.days) || 0)));
  }

  const manHours = positions.reduce(
    (s, p) => s + (p.people || 0) * (p.days || 0) * (p.shifts || 2) * (p.shift_hours || 12),
    0
  );

  const fitsWindow = !!windowDays && workDays <= windowDays;

  return {
    positions,
    // Срок по трудоёмкости заказчика главнее расчёта по позициям: если он дал
    // часы, значит норму уже посчитал он (тендер 2143 Hi Pro).
    work_days: (laborSchedule ? laborSchedule.days : workDays) || null,
    labor_hours: laborSchedule ? laborSchedule.labor_hours : null,
    labor_basis: laborSchedule
      ? 'трудоёмкость из ТЗ: ' + laborSchedule.note
      : null,
    road_days: Number(raw.road_days) > 0 ? Number(raw.road_days) : null,
    people_total: peopleTotal || null,
    crews,
    crew_size: CREW_SIZE,
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
