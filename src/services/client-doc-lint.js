/**
 * ASGARD CRM — линтер клиентских документов (ТКП/КП и любые письма заказчику)
 * ═══════════════════════════════════════════════════════════════════════════
 * Задача: механически не пускать в документ для заказчика три класса мусора:
 *   1. ИИ-штампы и канцелярит      — правило .cursor/rules/anti-ai-text.mdc
 *   2. Внутреннюю кухню            — себестоимость, маржа, ФОТ, накладные, пайковые
 *   3. Машинные артефакты          — TBD, {{...}}, markdown, JSON, null/undefined
 *
 * Плюс отдельная проверка «лишних чисел»: любая сумма в тексте, которой не было
 * во входных данных, — подозрение на выдуманную цифру.
 *
 * Два уровня строгости:
 *   - severity='block' — утечка внутренних данных / артефакт. Режется целым
 *     предложением, документ без чистки не сохраняется.
 *   - severity='warn'  — ИИ-штамп. Тоже недопустим в готовом документе, но
 *     лечится заменой ПОЛЯ на шаблон, а не вырезанием предложения (вырезание
 *     калечит смысл: «Работы выполняем в срок» → «Работы выполняем»).
 *
 * Функции:
 *   lintText(text, opts)        — найти нарушения
 *   scrubText(text)             — вырезать предложения с severity='block'
 *   stripInternal(text)         — фильтр ВХОДА: не пускать внутренние данные в промпт
 *   lintDraftFields(draft)      — проверить все текстовые поля черновика ТКП
 *   lintPdfBuffer(buf, opts)    — ГЕЙТ: прочитать готовый PDF и проверить его
 *   normaliseNumbers / extractNumbers — для сверки сумм в PDF
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

/* ─────────────────────────── словари ─────────────────────────── */

// Внутренняя кухня: если это попало заказчику — дефект, а не стилистика.
// Суффикс `*` = основа слова (проверяется только левая граница).
//
// ОСТОРОЖНО со звёздочкой (найдено верификатором): основа совпадает не только
// с падежами целевого слова, но и с другими леммами. `прибыл*` ловил «бригада
// прибыла на объект», `налог*` — «налог на добавленную стоимость» (развёрнутое
// написание НДС), `проезд*` — «проезд представителя заказчика обеспечивает
// заказчик». Это нормальный клиентский текст, и резать его нельзя.
// Поэтому для слов с омонимичными формами перечисляем ТОЧНЫЕ формы.
const INTERNAL_WORDS = [
  'себестоимост*',
  'маржинальн*', 'маржа', 'маржи', 'маржу', 'маржой', 'марже',
  'наценка', 'наценки', 'наценке', 'наценку', 'наценкой',
  'рентабельн*',
  // «прибыль» как экономический показатель. Форма «прибыли» — омоним глагола
  // «прибыть» («специалисты прибыли на объект»), поэтому в чистом виде её нет:
  // ловим только однозначные формы и устойчивые связки.
  'прибыль', 'прибылью', 'прибыльность', 'прибыльности',
  'чистая прибыль', 'чистой прибыли', 'валовая прибыль', 'валовой прибыли',
  'прибыли по сделке', 'прибыли от проекта', 'прибыли компании',
  'прибыль по сделке', 'прибыль от проекта', 'прибыль компании',
  'фонд оплаты труда', 'оплата труда', 'оплаты труда',
  'фот',
  'накладные расходы', 'накладных расходов', 'накладные',
  'непредвиденн*',
  // Налоги/взносы — только как наши затраты. «НДС» и «налог на добавленную
  // стоимость» в клиентском тексте законны, поэтому форма строгая.
  'налог на прибыль', 'налог на фонд оплаты труда', 'налоги и взносы',
  'страховые взносы', 'страховых взносов', 'страховыми взносами',
  'взносы на fot', 'взносы во внебюджетные фонды',
  'пайков*',
  'проживан*',
  'командировочн*',
  'суточн*',
  'оклад*',
  'зарплат*', 'заработная плата', 'заработной платы',
  'ставка за смену', 'ставка в час', 'стоимость чел-смены', 'стоимость челодня',
  'подготовка на складе', 'дни дороги',
  'логистик*',
  'транспортные расходы', 'транспортных расходов',
  // «проезд персонала/рабочих/бригады» — наши издержки. Проезд заказчика
  // и проезд представителя заказчика законны, поэтому только эти связки.
  'проезд персонала', 'проезд рабочих', 'проезд бригады', 'проезда персонала',
  'билеты для персонала', 'билеты для рабочих',
  'закупочн*',
  'амортизац*',
  'внутренний расчет', 'внутренний расчёт', 'внутренняя смета',
  'наша выгода', 'наша прибыль', 'заработок компании'
];

// ИИ-штампы и канцелярит (полный список правила + устойчивые словоформы).
const AI_CLICHES = [
  // вводные-пустышки
  'важно отметить', 'следует отметить', 'стоит отметить', 'необходимо отметить',
  'стоит подчеркнуть', 'хотелось бы отметить', 'отдельно стоит выделить',
  // связки-затычки
  'таким образом', 'в заключение', 'в свою очередь', 'вместе с тем',
  'тем не менее', 'подводя итог', 'резюмируя', 'в конечном счете', 'в конечном счёте',
  'как известно',
  // канцелярит
  'в рамках', 'в целях', 'в части', 'в области', 'в контексте данного',
  'надлежащ*', 'вышеуказанн*', 'вышеупомянут*', 'нижеследующ*',
  'осуществля*', 'осуществляе*', 'осуществляю*', 'осуществляет*', 'осуществляя*',
  'производится', 'производятся', 'производим работы по',
  'является', 'являются', 'являлся', 'являлась',
  'настоящим',
  // оценочный туман
  'ключев*', 'оптимальн*',
  'комплексный подход', 'индивидуальный подход', 'гибкий подход',
  'клиентоориентированн*',
  'широкий спектр', 'широкого спектра',
  'высококвалифицированн*',
  'играет важную роль', 'играет большую роль', 'имеет большое значение',
  'является неотъемлемой частью',
  'максимально эффективно', 'максимальной эффективности',
  'в современном мире', 'на сегодняшний день', 'на данный момент',
  // ТКП/КП-специфика (обещания без цифр)
  'позволит', 'позволят', 'обеспечит', 'обеспечат', 'способствует', 'способствуют',
  'в кратчайшие сроки', 'по доступной цене', 'качественно и в срок',
  'мы рады предложить', 'рады предложить', 'надеемся на сотрудничество',
  'будем рады сотрудничеству', 'гарантируем качество'
];

// Машинные артефакты: модели любят возвращать markdown и JSON внутри текста.
//
// ВАЖНО (найдено на реальном OCR): буллет `•` — это штатная типографика
// документов заказчика, а не markdown из ответа модели. Раньше строка
// «• Срок действия предложения: 30 дней» считалась артефактом и выпадала
// из контекста промпта. Поэтому буллеты из markdown-списка убраны:
// остаются только маркеры, которых в деловых документах не бывает.
const ARTIFACT_PATTERNS = [
  { re: /\{\{|\}\}/g, label: 'плейсхолдер {{…}}' },
  { re: /\*\*/g, label: 'markdown **' },
  { re: /(^|\n)\s*#{1,6}\s/g, label: 'markdown-заголовок' },
  { re: /(^|\n)\s*[-*]\s+\S/g, label: 'markdown-список' },
  { re: /```/g, label: 'markdown-блок кода' },
  { re: /<[a-z/][^>]{0,40}>/gi, label: 'html-тег' },
  { re: /\b(tbd|todo|lorem ipsum|xxx|n\/a)\b/gi, label: 'плейсхолдер' },
  // snake_case-ключ из JSON-ответа модели. Минимум два подчёркивания/сегмента,
  // чтобы не ловить обычное «e_mail» в реквизитах.
  { re: /\b[a-z][a-z0-9]+_[a-z0-9_]{2,}\b/g, label: 'snake_case-ключ' },
  { re: /"(?:[a-z_]+)"\s*:/gi, label: 'json-ключ' },
  { re: /\bundefined\b/gi, label: 'undefined' },
  { re: /\bnull\b/gi, label: 'null' },
  { re: /\bTrue\b|\bFalse\b/g, label: 'python-литерал' },
  { re: /\\n/g, label: 'экранированный перенос \\n' },
  { re: /[\uFFFD]/g, label: 'битый символ U+FFFD' }
];

/* ─────────────────────────── утилиты ─────────────────────────── */

/**
 * Нормализация для поиска.
 *
 * КРИТИЧНО (найдено верификатором): pdf-parse вставляет переносы строк в точках
 * переноса вёрстки, поэтому «Таким \nобразом» — это один штамп, а не два слова.
 * Все пробельные последовательности (включая \n, \t, nbsp) схлопываем в один
 * пробел. Без этого гейт PDF слеп к половине реальных штаммов.
 */
function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s\u00a0\u2007\u2009\u202f]+/g, ' ')
    .trim();
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Поиск слова/фразы.
 *
 * Поддержка суффикса `*` = основа слова: `'себестоимост*'` ловит
 * «себестоимости», «себестоимостью». Без `*` — строгое совпадение с границами
 * по КИРИЛЛИЦЕ и цифрам (латиница не считается частью слова: «ФОТ» внутри
 * «ФОТО» — не совпадение, но «ФОТ_налог» — совпадение).
 */
function hasWord(hayNorm, phrase) {
  const p = norm(phrase);
  const stem = p.endsWith('*');
  const body = stem ? p.slice(0, -1) : p;
  if (!body) return false;
  const re = stem
    ? new RegExp('(^|[^а-я0-9])' + escapeRe(body), 'i')
    : new RegExp('(^|[^а-я0-9])' + escapeRe(body) + '(?![а-я0-9])', 'i');
  return re.test(hayNorm);
}

/** Найти позицию фразы в исходном тексте (для контекста цитаты). */
function findPhrase(original, phrase) {
  const p = norm(phrase).replace(/\*$/, '').trim();
  if (!p) return -1;
  // Пробелы в фразе могут быть любыми (в т.ч. переносом строки из PDF).
  const pattern = escapeRe(p).replace(/\\?\s+/g, '\\s+');
  const re = new RegExp(pattern, 'i');
  const m = re.exec(original);
  return m ? m.index : -1;
}

function contextOf(text, index, pad) {
  const p = pad == null ? 45 : pad;
  const from = Math.max(0, index - p);
  const to = Math.min(text.length, index + p);
  return (from > 0 ? '…' : '') + text.slice(from, to).replace(/\s+/g, ' ').trim() + (to < text.length ? '…' : '');
}

/** Разбить на предложения, сохранив разделители (чтобы можно было склеить обратно). */
function splitSentences(text) {
  const parts = String(text || '').split(/(?<=[.!?…])\s+/);
  return parts.filter((p) => p !== '');
}

/* ─────────────────────────── ядро ─────────────────────────── */

/**
 * Найти нарушения в тексте.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {number[]|string[]} [opts.allowedNumbers] — числа, которые законны
 *        (взяты из просчёта/условий). Всё остальное с 4+ значащими цифрами — hit.
 * @param {boolean} [opts.skipNumbers]
 * @returns {{ok:boolean, blocking:boolean, hits:Array, text:string}}
 */
function lintText(text, opts) {
  const o = opts || {};
  const src = String(text == null ? '' : text);
  const hits = [];

  if (!src.trim()) {
    return { ok: true, blocking: false, hits: [], text: src };
  }

  const n = norm(src);

  // 1. Внутренняя кухня — block
  for (const w of INTERNAL_WORDS) {
    if (!hasWord(n, w)) continue;
    const idx = findPhrase(src, w);
    hits.push({
      kind: 'internal',
      severity: 'block',
      phrase: w,
      context: idx >= 0 ? contextOf(src, idx) : ''
    });
  }

  // 2. ИИ-штампы — warn
  for (const c of AI_CLICHES) {
    if (!hasWord(n, c)) continue;
    const idx = findPhrase(src, c);
    hits.push({
      kind: 'ai_cliche',
      severity: 'warn',
      phrase: c,
      context: idx >= 0 ? contextOf(src, idx) : ''
    });
  }

  // 3. Машинные артефакты — block
  for (const a of ARTIFACT_PATTERNS) {
    a.re.lastIndex = 0;
    const m = a.re.exec(src);
    if (!m) continue;
    hits.push({
      kind: 'artifact',
      severity: 'block',
      phrase: m[0],
      label: a.label,
      context: contextOf(src, m.index)
    });
  }

  // 4. Лишние числа: сумма, которой не было во входных данных.
  if (!o.skipNumbers && Array.isArray(o.allowedNumbers) && o.allowedNumbers.length) {
    const allowed = new Set(o.allowedNumbers.map(numKey).filter(Boolean));
    const seen = new Set();
    for (const f of extractNumbers(src)) {
      if (allowed.has(f.key) || seen.has(f.key)) continue;
      seen.add(f.key);
      const idx = src.indexOf(f.raw);
      hits.push({
        kind: 'alien_number',
        severity: 'block',
        phrase: f.raw,
        context: idx >= 0 ? contextOf(src, idx) : ''
      });
    }
  }

  const blocking = hits.some((h) => h.severity === 'block');
  return { ok: hits.length === 0, blocking, hits, text: src };
}

/**
 * Удалить предложения, содержащие hard-нарушения.
 * Мягкие (ИИ-штампы) НЕ вырезаются: там лечится всё поле шаблоном, иначе
 * предложение теряет смысл.
 */
function scrubText(text) {
  const src = String(text == null ? '' : text);
  if (!src.trim()) return '';

  const sentences = splitSentences(src);
  const kept = [];
  let removed = 0;

  for (const s of sentences) {
    const probe = lintText(s, { skipNumbers: true });
    const hard = probe.hits.some((h) => h.severity === 'block');
    if (hard) { removed += 1; continue; }
    kept.push(s);
  }

  let out = kept.join(' ').replace(/[ \t]{2,}/g, ' ').trim();
  if (removed > 0) {
    // Предложения могли исчезнуть между двумя абзацами — не оставляем «висящий» заголовок без текста.
    out = out.replace(/\s+([,.;:])/g, '$1');
  }
  return out;
}

/**
 * Фильтр ВХОДА. Не пускает внутренние данные в промпт и в черновик.
 * Работает построчно: если в строке есть внутренняя статья — строки нет.
 * В отличие от scrubText, здесь не жалко потерять смысл: лучше меньше
 * контекста, чем утечка себестоимости в клиентский текст.
 */
function stripInternal(text) {
  const src = String(text == null ? '' : text);
  if (!src.trim()) return '';

  const lines = src.split(/\r?\n/);
  const kept = [];

  for (const line of lines) {
    const probe = lintText(line, { skipNumbers: true });
    const leak = probe.hits.some((h) => h.kind === 'internal' || h.kind === 'artifact');
    if (leak) continue;
    kept.push(line);
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Текстовые поля ТКП, которые уйдут заказчику. */
const DRAFT_TEXT_FIELDS = [
  'subject', 'work_description', 'services', 'payment_terms_text',
  'deadline_text', 'warranty_text', 'scope_boundary', 'deliverables', 'duties', 'cost_notes'
];

const DRAFT_LIST_FIELDS = ['scope_included', 'scope_excluded', 'risks_paras'];

/**
 * Проверить весь черновик ТКП (и краткий, и полный — поля плоские).
 * Возвращает хит-лист с указанием поля — чтобы UI показал «где именно».
 */
function lintDraftFields(draft, opts) {
  const d = draft || {};
  const o = opts || {};
  const hits = [];

  for (const f of DRAFT_TEXT_FIELDS) {
    if (d[f] == null || d[f] === '') continue;
    const r = lintText(String(d[f]), o);
    r.hits.forEach((h) => hits.push(Object.assign({ field: f }, h)));
  }
  for (const f of DRAFT_LIST_FIELDS) {
    const arr = Array.isArray(d[f]) ? d[f] : (d[f] ? [d[f]] : []);
    arr.forEach((item, i) => {
      const r = lintText(String(item || ''), o);
      r.hits.forEach((h) => hits.push(Object.assign({ field: f + '[' + i + ']' }, h)));
    });
  }
  // Позиции: названия уходят клиенту как есть.
  const items = Array.isArray(d && d.items) ? d.items : [];
  items.forEach((it, i) => {
    const r = lintText(String((it && it.name) || ''), Object.assign({ skipNumbers: true }, o));
    r.hits.forEach((h) => hits.push(Object.assign({ field: 'items[' + i + '].name' }, h)));
  });

  return {
    ok: hits.length === 0,
    blocking: hits.some((h) => h.severity === 'block'),
    hits
  };
}

/**
 * Разбить текст на предложения, сохранив смысл (для точечной чистки).
 * Экспортируется, потому что используется в tkp-ai-draft.stripCliches.
 */

/* ─────────────────────────── числа ─────────────────────────── */

/** Нормализованный ключ числа: только цифры целой части, без разделителей и копеек. */
function numKey(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  // Отбрасываем копейки: «1 234 567,89» → «1234567». Округление до рубля — норма.
  return s.split(/[.,]/)[0].replace(/[^\d]/g, '');
}

/**
 * Вытащить из текста числа, похожие на деньги (4+ значащих цифр).
 * Используется гейтом PDF для сверки с просчётом.
 */
function extractNumbers(text) {
  const out = [];
  const re = /\d[\d\s\u00a0]*(?:[.,]\d{1,2})?/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const raw = m[0].trim();
    const key = numKey(raw);
    if (!key || key.length < 4) continue;
    out.push({ raw, key });
  }
  return out;
}

/**
 * Сверить суммы в тексте PDF с ожидаемыми из просчёта.
 * @param {string} text
 * @param {number[]} expected — price_no_vat, price_with_vat, суммы строк
 * @returns {{ok:boolean, missing:number[], alien:string[]}}
 */
function reconcileNumbers(text, expected) {
  const keys = new Set((expected || []).map(numKey).filter(Boolean));
  const found = extractNumbers(text);
  const missing = [];
  for (const k of keys) {
    if (!found.some((f) => f.key === k)) missing.push(k);
  }
  const alien = [];
  for (const f of found) {
    if (keys.has(f.key)) continue;
    // Проценты, годы, короткие номера — не суммы.
    if (f.key.length <= 3) continue;
    if (alien.indexOf(f.raw) === -1) alien.push(f.raw);
  }
  return { ok: missing.length === 0, missing, alien };
}

/* ─────────────────────────── гейт PDF ─────────────────────────── */

/**
 * Прочитать готовый PDF и проверить его. Это единственное доказательство,
 * что «в ТКП нет мусора»: проверяется именно тот байт-стрим, который уйдёт
 * заказчику, а не исходные данные.
 *
 * ВАЖНО про числа: в PDF законно живут реквизиты компании (ИНН, ОГРН, КПП),
 * индекс, номер ТКП, год, суммы строк. Отличить «выдуманную сумму» от ИНН
 * по тексту нельзя — поэтому в PDF числа НЕ линтуются на «чужие». Вместо
 * этого:
 *   - слова линтуются полностью (внутренняя кухня, штампы, артефакты);
 *   - суммы сверяются адресно: каждая ожидаемая сумма обязана найтись,
 *     а итог с НДС обязан совпасть с просчётом (reconcileNumbers).
 *
 * pdf-parse — уже в зависимостях (используется src/services/pdf-ocr.js).
 *
 * @param {Buffer} buffer
 * @param {object} [opts] { expectedNumbers, skipNumbers }
 * @returns {Promise<{ok:boolean, hits:Array, text:string, pages:number, numbers:object}>}
 */
async function lintPdfBuffer(buffer, opts) {
  const o = opts || {};
  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch (e) {
    // Без pdf-parse гейт нельзя считать пройденным — честно падаем.
    throw new Error('lintPdfBuffer: модуль pdf-parse недоступен — гейт PDF невозможен');
  }

  const parsed = await pdfParse(buffer);
  const text = String(parsed && parsed.text ? parsed.text : '');

  // В PDF буллеты — это вёрстка, а не markdown из ответа модели. Убираем их
  // до линта, иначе каждый список превращается в ложный «артефакт».
  const textForLint = text.replace(/^[\s]*[•·▪◦‣∙]\s*/gm, '');

  const lintRes = lintText(textForLint, { skipNumbers: true });
  const hits = lintRes.hits.slice();

  // Сверка сумм: если передали ожидаемые — они обязаны быть в PDF.
  let numbers = null;
  if (Array.isArray(o.expectedNumbers) && o.expectedNumbers.length) {
    numbers = reconcileNumbers(text, o.expectedNumbers);
    if (!numbers.ok) {
      numbers.missing.forEach((v) => {
        hits.push({
          kind: 'amount_missing',
          severity: 'block',
          phrase: String(v),
          context: 'сумма из просчёта не найдена в PDF'
        });
      });
    }
  }

  // Внутренние цифры (себестоимость, маржа, чистая прибыль) не имеют права
  // появиться в клиентском PDF вообще. Проверяем адресно: это конкретные
  // числа из просчёта, а не «любое незнакомое число» (ИНН/ОГРН/индекс живут
  // в PDF законно, и отличить их от выдуманной суммы по тексту невозможно).
  if (Array.isArray(o.forbiddenNumbers) && o.forbiddenNumbers.length) {
    const found = extractNumbers(text);
    const foundKeys = new Set(found.map((f) => f.key));
    for (const v of o.forbiddenNumbers) {
      const k = numKey(v);
      if (!k || k.length < 4) continue;
      if (!foundKeys.has(k)) continue;
      hits.push({
        kind: 'internal_number',
        severity: 'block',
        phrase: String(v),
        context: 'внутренняя цифра просчёта (себестоимость/маржа/прибыль) попала в PDF'
      });
    }
  }

  return {
    ok: hits.length === 0,
    hits,
    text,
    pages: Number(parsed && parsed.numpages) || 0,
    numbers
  };
}

/* ─────────────────────────── экспорт ─────────────────────────── */

module.exports = {
  INTERNAL_WORDS,
  AI_CLICHES,
  ARTIFACT_PATTERNS,
  DRAFT_TEXT_FIELDS,
  DRAFT_LIST_FIELDS,
  lintText,
  scrubText,
  stripInternal,
  lintDraftFields,
  splitSentences,
  lintPdfBuffer,
  numKey,
  extractNumbers,
  reconcileNumbers,
  _internal: { norm, hasWord, splitSentences }
};
