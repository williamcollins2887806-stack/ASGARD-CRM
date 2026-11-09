'use strict';
/**
 * mimir-tender-stages-ai.js — генерация ДВ и плана просчёта через модель.
 *
 * Отдельный слой от `mimir-tkp-quick.generateEstimate`: там одна простыня
 * «сделай смету», здесь — два узких шага с жёсткой схемой ответа:
 *   generateDv()        → позиции с объёмом, методом, технологией и источником;
 *   generateCalcPlan()  → люди, сроки, оборудование по аппаратам + источник цифры.
 *
 * Принципы:
 *   • промпт из файла (`templates/prompts/PROMPT-dv-v1.md`, `PROMPT-calc-plan-v1.md`);
 *   • ответ валидируется нормализаторами из `mimir-tender-stages`;
 *   • если модель вернула мусор — не падаем: возвращаем `{ok:false, error}`,
 *     и UI показывает человеческое сообщение с кнопкой «Повторить»;
 *   • никакой скрытой подстановки объёмов: чего нет — того нет.
 */

const promptLoader = require('./prompt-loader');
const stages = require('./mimir-tender-stages');
const docRole = require('./doc-role');

// Что ушло в промпт на последнем вызове — для журнала анализа.
// module-level: вызовы последовательные, гонки нет.
let lastSelection = null;

/** Каталог категорий и методов в компактном виде для промпта. */
function catalogForPrompt(catalog) {
  const cats = (catalog && Array.isArray(catalog.categories)) ? catalog.categories : [];
  const rates = (catalog && Array.isArray(catalog.rates)) ? catalog.rates : [];

  /**
   * Одна норма в строке промпта: код, единица, доверие, происхождение
   * и область применимости. Без этого модель не может решить, доверять ли
   * цифре, и применяет её не по адресу (запрос заказчика 06.11).
   */
  function rateLine(r) {
    const conf = r.confidence != null ? Number(r.confidence) : null;
    const confTxt = conf == null ? '' : ` | доверие ${conf.toFixed(2)}`;
    const basisTxt = r.basis ? ` | basis: ${r.basis}` : '';
    let app = '';
    const a = r.applicability && typeof r.applicability === 'object' ? r.applicability : null;
    if (a && Object.keys(a).length) {
      const bits = [];
      if (a.min_value != null && a.max_value != null) bits.push(`${a.min_value}–${a.max_value}`);
      else if (a.min_value != null) bits.push(`от ${a.min_value}`);
      else if (a.max_value != null) bits.push(`до ${a.max_value}`);
      if (Array.isArray(a.fouling) && a.fouling.length) bits.push(`отложения ${a.fouling.join('/')}`);
      if (a.method_note) bits.push(a.method_note);
      if (bits.length) app = ` | применимо: ${bits.join(', ')}`;
    }
    const warn = (conf != null && conf < 0.4)
      ? ' | ОЦЕНКА, не норма — объясни в explain'
      : '';
    return `${r.code}: «${r.unit}», считать как ${r.calc_kind}${basisTxt}${confTxt}${app}${warn}`;
  }

  return cats.map((c) => {
    const ms = Array.isArray(c.methods_json) ? c.methods_json : [];
    const lines = ms.map((m) => {
      // Показываем ВСЕ нормы метода, а не только primary: у химии по контуру
      // есть hours_per_cycle, и без него модель решает, что нужны трубки.
      const methodRates = rates.filter((r) => r.category_code === c.code && r.method_code === m.code);
      const primary = methodRates.find((r) => r.code === m.primary_rate_code) || methodRates[0] || null;
      const others = methodRates.filter((r) => r !== primary).slice(0, 3);
      const list = [primary, ...others].filter(Boolean).map(rateLine).join(' | ');
      return `  - ${m.code} (${m.label || m.code}): ${list || 'единица ' + (m.volume_unit || '—')}`;
    });
    return `${c.code} — ${c.title || c.code}\n${lines.join('\n')}`;
  }).join('\n\n');
}

function safeJson(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  // Модель может обернуть ответ в ```json ... ```
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  try { return JSON.parse(body); } catch (_) {}
  // Последняя попытка: первый { ... последний }
  const i = body.indexOf('{');
  const j = body.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try { return JSON.parse(body.slice(i, j + 1)); } catch (_) {}
  }
  // Частичный ответ: модель упёрлась в лимит токенов и не закрыла JSON.
  // Спасаем все целые объекты из массива positions — лучше 6 позиций,
  // чем ноль и «попробуйте ещё раз» (прод 06.11, тендер 2131: 30 КБ, stop=length).
  return salvagePartialDv(body);
}

/**
 * Достаёт из обрезанного JSON всё, что успело сформироваться:
 * целые объекты массива positions и decision_recommend.
 */
function salvagePartialDv(body) {
  const text = String(body || '');
  const decMatch = text.match(/"decision_recommend"\s*:\s*"(go|no_go|need_info)"/);
  const dec = decMatch ? decMatch[1] : 'need_info';

  const start = text.indexOf('"positions"');
  if (start < 0) return null;
  const arrStart = text.indexOf('[', start);
  if (arrStart < 0) return null;

  const positions = [];
  let depth = 0;
  let objStart = -1;
  let inStr = false;
  let esc = false;

  for (let i = arrStart + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0 && objStart >= 0) {
        const chunk = text.slice(objStart, i + 1);
        try {
          const obj = JSON.parse(chunk);
          if (obj && obj.name) positions.push(obj);
        } catch (_) { /* повреждённый объект пропускаем */ }
        objStart = -1;
      }
      if (depth < 0) break;
    }
  }

  if (!positions.length) return null;

  /**
   * Строковое поле из обрезанного JSON.
   * Модель пишет summary, volume_summary и risks ДО массива positions,
   * поэтому при упоре в лимит токенов они уже есть в тексте, но терялись:
   * карточка показывала пустую «Суть для ТО» при живых позициях.
   */
  function strField(name) {
    const re = new RegExp('"' + name + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"');
    const m = re.exec(text);
    if (!m) return null;
    try { return JSON.parse('"' + m[1] + '"'); } catch (_) { return m[1]; }
  }

  return {
    decision_recommend: dec,
    summary: strField('summary'),
    volume_summary: strField('volume_summary'),
    feasibility: strField('feasibility'),
    feasibility_note: strField('feasibility_note'),
    competition: strField('competition'),
    risks: strField('risks'),
    positions,
    questions_for_customer: [],
    _salvaged: true,
    _note: 'Ответ модели обрезан по лимиту — сохранены полностью сформированные позиции'
  };
}

/**
 * Склеивает текст документов для промпта.
 *
 * Дефект 06.11: при 553 тыс. символов в 22 документах (тендер 2133) промпт
 * обрезался до 60 тыс., и обрезанным оказывался именно ВОР с объёмами —
 * модель честно отвечала «перечень оборудования обрезан, объёмы не выводимы»
 * и возвращала 0 позиций.
 *
 * Проверено на провайдере: вход до 300 тыс. символов проходит без ошибки,
 * поэтому лимит поднят до 400 тыс. Порядок и доли сохранены: документы
 * с объёмами (ВОР, ведомость) идут первыми и получают больше места.
 */
/**
 * Отпечаток позиции для дедупликации при доборе.
 *
 * Дефект 07.11 (тендер 2138): при доборе модель начинала ведомость заново,
 * и одна строка повторялась до 39 раз — 224 лишние позиции из 364.
 * Ключ включает название, объём и единицу: разные аппараты с одинаковым
 * объёмом различаются названием, а настоящий повтор совпадает целиком.
 */
/**
 * Ключ дедупликации позиции.
 *
 * ВАЖНО: реализация ОДНА — в mimir-tender-stages.js. Здесь только проброс,
 * чтобы не было двух разных ключей: расхождение уже приводило к тому, что
 * дедупликация в цикле добора и в нормализации считала по-разному.
 *
 * Ключ учитывает название, объём, единицу и ТЕГ аппарата: одна и та же
 * работа по Т-1 и Т-2 — разные позиции.
 */
function dupKey(p) {
  return stages.dupKey(p);
}

/**
 * Сколько позиций пригодны для расчёта.
 *
 * Порог полноты нельзя закрывать «мусором»: модель может вернуть 250 позиций
 * без объёма, и формально недобора нет, хотя считать нечего. Считаем только
 * позиции с положительным объёмом и единицей измерения.
 *
 * @param {Array} positions
 * @returns {number}
 */
function countValidPositions(positions) {
  const list = Array.isArray(positions) ? positions : [];
  let n = 0;
  for (const p of list) {
    if (!p) continue;
    const vol = Number(p.volume);
    const unit = String(p.unit || '').trim();
    if (vol > 0 && unit) n += 1;
  }
  return n;
}

/**
 * Нижняя оценка ожидаемого числа позиций — по документам, которые модель
 * реально увидит в промпте.
 *
 * Считать по сырому списку нельзя по двум причинам:
 *   1. docRole.selectForPrompt отсеивает копии и лишние документы;
 *   2. docsToText обрезает текст под бюджет промпта, и модель видит меньше
 *      строк, чем в исходном документе.
 * Если оценивать по полному тексту, порог окажется недостижимым: замер на
 * ведомости 1,35 млн символов дал ожидание 15000 при реально дошедших 9220.
 *
 * Поэтому повторяем ту же выборку, что делает docsToText: отбор по ролям и
 * обрезка по бюджету — и только потом считаем строки.
 *
 * @param {Array} documents — сырой список документов
 * @returns {number} ожидаемое число позиций или 0, если оценивать нечего
 */
function estimateExpectedForSelection(documents) {
  const list = Array.isArray(documents) ? documents : [];
  try {
    // Источник числа позиций — СТРУКТУРА файла, посчитанная парсером.
    //
    // История вопроса (13 проходов верификатора): сначала считали строки
    // таблицы по тексту с единицами — ломались шапки, «м», «компл», docx,
    // csv. Потом по нумерации 1..N — ломались разделы с перезапуском, рваная
    // нумерация и колонка «Кол-во». Любая текстовая эвристика ошибочна:
    // после рендера в строку не отличить номер от объёма.
    //
    // Теперь число берётся из documents.table_positions — оно посчитано
    // парсером по СЕТКЕ ЯЧЕЕК (ExcelJS/SheetJS), где структура цела.
    // Здесь только складываем по документам-источникам перечня.
    let docRole = null;
    try { docRole = require('./doc-role'); } catch (_) { docRole = null; }

    // Несколько документов могут содержать ОДИН перечень (ВОР + акт с тем же
    // списком) либо РАЗНЫЕ перечни (ВОР на 300 и ведомость на 50).
    //
    // Гадать по числам нельзя — раньше здесь стояло `best + extra/2`: на
    // четырёх копиях ВОР это давало 750 и ложный «недобор» при полном
    // разборе, а на двух разных перечнях 325 вместо 350. Обе ошибки — из
    // одного корня: количество не говорит, копия это или другой перечень.
    //
    // Решаем по СОДЕРЖИМОМУ: подпись из первых названий. Копии схлопываются,
    // разные перечни суммируются. Тот же приём, что для листов книги.
    const docs = [];
    for (const d of list) {
      if (!d) continue;
      const name = String(d.original_name || d.name || '');
      const text = String(d.text || d.ocr_text || '');
      if (!text) continue;
      let role = String(d.doc_role || d.role || '');
      if (!role && docRole && docRole.detectRole) {
        try { role = String(docRole.detectRole({ name, text }).role || ''); } catch (_) { role = ''; }
      }
      const isSource = isPositionSourceRole(role) || isPositionSourceName(name);
      const structured = Number(d.table_positions) || 0;
      // Источник перечня — по роли/имени ИЛИ по тому, что структурный
      // счётчик уже нашёл позиции. Второе важно для обезличенных имён
      // («Приложение 2.xlsx», «extracted_7336e2.xlsx»): раньше готовый
      // table_positions=300 отбрасывался, и детектор молча выключался
      // (найдено верификатором).
      //
      // Исключение — ТЗ: там таблица требований, а не ведомость.
      const isTzDoc = /техническ|тех\.?\s*зада|(^|[^а-яё])тз([^а-яё]|$)|задани/i.test(name)
        || /techn|тз|техническ|задани/.test(String(role || '').toLowerCase());
      const usable = (isSource || structured > 0) && !isTzDoc;
      if (!usable) continue;
      if (structured <= 0) continue;
      docs.push({ name, structured, signature: textSignature(text) });
    }

    // ── Согласование двух источников ──────────────────────────────────────
    // Структурный счёт (сетка ячеек) точен, но может ЗАНИЖАТЬ: пропущенная
    // шапка, заголовок раздела, двоение, нестандартная вёрстка. Текстовый
    // счёт (по строкам) грубее, но перечитывает весь текст и часто видит
    // строки, которые структурный пропустил.
    //
    // Раньше резерв включался только при structured = 0. Это давало
    // молчаливый недобор: структурный счёт 42 при 300 реальных включал
    // «полный разбор», и 258 пропущенных строк оставались невидимыми
    // (найдено верификатором). Для детектора недобора это худший исход:
    // ноль хотя бы честно выключает детектор, а занижение его обманывает.
    //
    // Поэтому теперь считаем ОБА источника и берём БОЛЬШИЙ: занизить оценку
    // они могут только одновременно, а такое совпадение маловероятно.
    let estimate = 0;
    if (docs.length) {
      // Копии одного перечня считаем один раз, разные перечни складываем.
      const seenSignatures = new Set();
      for (const doc of docs) {
        if (doc.signature && seenSignatures.has(doc.signature)) continue;
        if (doc.signature) seenSignatures.add(doc.signature);
        estimate += doc.structured;
      }
    }

    // Текстовый резерв — по документам-ПЕРЕЧНЯМ, а не по всем подряд.
    //
    // КОРЕНЬ (найдено верификатором): резерв включался для любого документа
    // с ролью из isPositionSourceRole, а туда попадает техническое задание.
    // ТЗ на 1500 нумерованных пунктов («проход шириной не менее 1,5 м»)
    // давало textEstimate = 1500 при полном разборе ВОРа на 300, и детектор
    // писал «разбор неполный» на верном результате плюс гонял лишний раунд
    // на 64k токенов. Ложная тревога — то же зло, что и молчание.
    //
    // Поэтому текст считаем только по документам, где перечень работ И ЕСТЬ
    // содержимое: ВОР, ведомость, дефектная ведомость, акт, спецификация.
    // ТЗ и «объёмы» в названии — исключены: там объёмы упоминаются в тексте
    // требований, а не списком позиций.
    let textEstimate = 0;
    const positionDocs = [];
    for (const d of list) {
      if (!d) continue;
      const name = String(d.original_name || d.name || '');
      const text = String(d.text || d.ocr_text || '');
      if (!text) continue;
      let role = String(d.doc_role || d.role || '');
      if (!role && docRole && docRole.detectRole) {
        try { role = String(docRole.detectRole({ name, text }).role || ''); } catch (_) { role = ''; }
      }
      if (isVolumeListDoc(role, name)) positionDocs.push(text);
    }
    if (positionDocs.length) {
      // Перечни могут быть РАЗРЕЗАНЫ на несколько файлов (части одной
      // ведомости) — тогда нужна СУММА. Копии одного перечня считаем
      // один раз по подписи.
      const seenTextSignatures = new Set();
      for (const text of positionDocs) {
        const sig = textSignature(text);
        if (sig && seenTextSignatures.has(sig)) continue;
        if (sig) seenTextSignatures.add(sig);
        const one = stages.estimateExpectedPositions([{ original_name: 'ВОР', text }]) || 0;
        textEstimate += one;
      }
    }

    // Берём больший: недооценка опаснее переоценки — она маскирует недобор.
    const finalEstimate = Math.max(estimate, textEstimate);
    return { rows: finalEstimate, estimate: finalEstimate };
  } catch (_) {
    // Оценка — вспомогательная: если упала, работаем без порога.
    return { rows: 0, estimate: 0 };
  }
}

/** Имя файла, по которому видно, что внутри перечень работ. */
function isPositionSourceName(name) {
  const n = String(name || '');
  return /(^|[^а-яё])(вор|тз)([^а-яё]|$)|ведомост|дефектн|объ[её]м|перечень|спецификац|техническ/i.test(n);
}

/**
 * Документ, содержимое которого — СПИСОК ПОЗИЦИЙ (а не описание требований).
 *
 * Отличие принципиальное для текстового счёта:
 *   • ВОР, ведомость объёмов, дефектная ведомость, акт, спецификация —
 *     это перечни, каждая строка = позиция;
 *   • ТЗ, техническое задание — это требования, где объёмы упоминаются
 *     в тексте («проход не менее 1,5 м»). Считать его строки позициями
 *     нельзя: ТЗ на 1500 пунктов раздувает ожидание впятеро.
 *
 * @param {string} role — роль из doc-role
 * @param {string} name — имя файла
 * @returns {boolean}
 */
function isVolumeListDoc(role, name) {
  const r = String(role || '').toLowerCase();
  // Явные перечни по роли.
  if (/vor|act|spec|ведомость|дефектн|спецификац/.test(r)) return true;
  // Роль ТЗ или «прочее» — по названию, и только если это не ТЗ.
  if (/techn|тз|техническ|задани/.test(r)) return false;
  const n = String(name || '');
  if (/техническ|тех\.?\s*зада|(^|[^а-яё])тз([^а-яё]|$)|задани/i.test(n)) return false;
  return /(^|[^а-яё])вор([^а-яё]|$)|ведомост|дефектн|перечень|спецификац/i.test(n);
}

/**
 * Подпись содержимого документа — для схлопывания копий.
 *
 * Берём названия строк таблицы (те, где есть буквы и они не служебные),
 * нормализуем и хешируем. Копия одного перечня даёт ту же подпись независимо
 * от имени файла и от того, сколько таких копий загрузили.
 *
 * ВАЖНО: только названия, без объёмов — при копировании ведомости объёмы
 * иногда правят, а перечень остаётся тем же.
 *
 * @param {string} text
 * @returns {string} подпись или '' если подписывать нечего
 */
function textSignature(text) {
  const names = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length < 6) continue;
    if (!/[а-яёa-z]{3}/i.test(line)) continue;
    if (/^(№|наименование|ед\.?\s*изм|кол-?во|количество|объ[её]м|цена|сумма|итог|всего)/i.test(line)) continue;

    // ВАЖНО: берём ТОЛЬКО текст названия, без чисел и единиц.
    //
    // Раньше сюда попадала вся строка вместе с объёмом, хотя комментарий
    // обещал обратное. Из-за этого копия ведомости с поправленными объёмами
    // (обычное дело: одну и ту же ведомость правят и присылают заново)
    // давала другую подпись, не схлопывалась, и ожидание раздувалось —
    // на четырёх копиях до 1200 при 300 реальных позициях.
    // Найдено верификатором.
    const nameOnly = line
      .split(/[|,;\t]/)
      .map((cell) => cell.trim())
      .filter((cell) => cell && /[а-яёa-z]{3}/i.test(cell))
      // Ячейка с названием — самая длинная из текстовых, без цифр.
      .filter((cell) => !/^\d+([.,]\d+)?$/.test(cell))
      .sort((a, b) => b.length - a.length)[0];
    if (!nameOnly) continue;

    const norm = nameOnly.toLowerCase().replace(/\s+/g, ' ').trim();
    if (norm.length < 6) continue;
    names.push(norm.slice(0, 80));
    if (names.length >= 12) break;
  }
  if (names.length < 3) return '';
  // Названия сортируем: копия с другим порядком строк даёт ту же подпись.
  names.sort();
  let h = 5381;
  const joined = names.join('\u0001');
  for (let i = 0; i < joined.length; i += 1) {
    h = ((h * 33) ^ joined.charCodeAt(i)) >>> 0;
  }
  return 'sig' + h.toString(36);
}

/**
 * Разбирает текст промпта обратно на блоки документов.
 *
 * docsToText склеивает документы заголовками `=== <имя> [<роль>] ===`.
 * Возвращаем [{name, role, text}], чтобы можно было отличить ВОР от ТЗ.
 */
function splitPromptBlocks(text) {
  const src = String(text || '');
  const re = /^=== (.+?)(?: \[([^\]]+)\])? ===$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    marks.push({ at: m.index, end: m.index + m[0].length, name: m[1], role: m[2] || null });
  }
  if (!marks.length) return [{ name: 'промпт', role: null, text: src }];

  const blocks = [];
  for (let i = 0; i < marks.length; i += 1) {
    const to = i + 1 < marks.length ? marks[i + 1].at : src.length;
    blocks.push({ name: marks[i].name, role: marks[i].role, text: src.slice(marks[i].end, to) });
  }
  return blocks;
}

/** Документ, в котором бывает перечень работ (ВОР, ведомость, акт, спецификация). */
function isPositionSourceRole(role) {
  const r = String(role || '').toLowerCase();
  // Роли из doc-role.js — ЛАТИНИЦА: vor, act, spec, estimate, vedomost, defect.
  // В регулярке были кириллические «акт»/«вор», поэтому роль `act` (акты
  // выполненных работ — их присылают чаще всего) не проходила и детектор
  // выключался.
  return /vor|act|spec|estimate|ведомость|акт|дефектн|спецификац|смет/.test(r);
}

function docsToText(documents, limit = 400000) {  const list = Array.isArray(documents) ? documents : [];

  // ── Отсев мусора и копий (замечание РП 06.11.2026) ─────────────────────────
  // Раньше в промпт шли договоры, наши ТКП, шаблоны и по 5 копий одного ТЗ
  // из разных архивов: 1,3 млн символов, из них 60–70 % без объёмов.
  // Теперь назначение определяется по имени (doc-role.js), копии схлопываются
  // по отпечатку содержимого, а в промпт остаются только источники объёмов.
  const picked = docRole.selectForPrompt(list);
  lastSelection = picked;
  const items = picked.selected
    .map((d) => ({
      name: d.original_name || d.filename || d.name || 'документ',
      text: String(d.text || '').trim(),
      pr: d.doc_weight,
      role: d.doc_role,
      roleTitle: d.doc_role_title
    }))
    .filter((d) => d.text)
    .sort((a, b) => b.pr - a.pr || b.text.length - a.text.length);

  if (!items.length) return '';

  // Приоритет — не только порядок, но и ДОЛЯ лимита: документ с объёмами
  // (ВОР, ведомость) должен получить больше места, чем договор на 200 страниц.
  // Дефект 06.11: ВОР на 19 тыс. символов резался вместе со всеми, и модель
  // честно отвечала «перечень оборудования обрезан, объёмы не выводимы».
  // Веса теперь приходят из doc-role.js (5 — ВОР, 4 — ТЗ, 0 — мусор).
  const totalWeight = items.reduce((s, it) => s + (it.pr || 1), 0);
  const minPer = 1500;
  const budget = Math.max(limit, items.length * minPer);

  // ПРОХОД 1: раздаём квоты по весам.
  // ПРОХОД 2: остаток бюджета отдаём тем, кто не влез.
  // Дефект 06.11 (тендер 2138): дефектная ведомость на 100 тыс. символов
  // обрезалась до 50 тыс., хотя в бюджете лежало ещё 225 тыс. неиспользованных:
  // квоты делились поровну, и место коротких документов просто пропадало.
  // Модель недосчитывала объёмы из-за обрезки середины таблицы.
  const alloc = items.map((it) => ({ it, quota: (budget * (it.pr || 1)) / totalWeight }));
  let free = budget - alloc.reduce((s, a) => s + Math.min(a.it.text.length, a.quota), 0);

  // Нуждающиеся — от самого важного и самого длинного.
  const needy = alloc
    .filter((a) => a.it.text.length > a.quota)
    .sort((a, b) => (b.it.pr - a.it.pr) || (b.it.text.length - a.it.text.length));

  for (const a of needy) {
    if (free <= 0) break;
    const room = a.it.text.length - a.quota;
    const add = Math.min(room, Math.floor(free * 0.6));   // 60 %, чтобы хватило всем
    a.quota += add;
    free -= add;
  }
  // Второй добор: если после первого круга остались и место, и нужда.
  for (const a of needy) {
    if (free <= 0) break;
    const room = a.it.text.length - a.quota;
    if (room <= 0) continue;
    const add = Math.min(room, free);
    a.quota += add;
    free -= add;
  }

  const parts = [];
  for (const a of alloc) {
    const it = a.it;
    const head = `=== ${it.name}${it.roleTitle ? ` [${it.roleTitle}]` : ''} ===\n`;
    const room = Math.max(800, Math.floor(a.quota) - head.length);

    if (it.text.length <= room) {
      parts.push(head + it.text);
    } else {
      // Берём начало и конец: в ВОР таблица идёт с первых строк,
      // а итоги и примечания — в конце.
      const headPart = Math.floor(room * 0.75);
      const tailPart = room - headPart - 70;
      parts.push(
        head + it.text.slice(0, headPart) +
        `\n… (середина опущена, всего ${it.text.length} симв.) …\n` +
        (tailPart > 200 ? it.text.slice(-tailPart) : '')
      );
    }
  }

  return parts.join('\n\n');
}

/**
 * Генерирует ведомость объёмов (ДВ).
 *
 * @param {object} p
 * @param {object} p.db
 * @param {object} p.aiProvider — модуль ai-provider (complete/runAgentLoop)
 * @param {string} p.tz_text
 * @param {Array}  p.documents
 * @param {string} p.history_block
 * @param {object} p.catalog — loadCatalog()
 * @returns {Promise<{ok:boolean, dv?:object, error?:string, model?:string, raw?:string}>}
 */
async function generateDv(p) {
  const o = p || {};
  const catalog = o.catalog || { categories: [], rates: [] };

  const tzText = String(o.tz_text || '(ТЗ текстом не задано)').slice(0, 40000);
  const docsText = docsToText(o.documents) || '(документов с текстом нет)';
  const system = promptLoader.buildPrompt('PROMPT-dv-v1.md', {
    catalog: catalogForPrompt(catalog),
    tz_text: tzText,
    documents_text: docsText,
    history_block: o.history_block || '(истории нет)'
  });

  let user = 'Составь ведомость объёмов по этим данным. Верни ТОЛЬКО JSON по схеме.';

  // ── Сколько позиций ожидаем ────────────────────────────────────────────────
  // Детектор недобора: отличить «модель закончила» от «модель сдалась».
  // Без него один и тот же тендер давал то 1, то 353 позиции (тендер 2138).
  //
  // ── ПОЧЕМУ МОДЕЛЬ ГЛАВНЕЕ СЧЁТЧИКА ────────────────────────────────────────
  // Заказчики присылают объёмы по-разному: Excel с ведомостью, Word с
  // таблицей, иногда просто текст ТЗ без всякой таблицы. Признака «это
  // ведомость» в общем виде не существует: у одного есть колонка «Ед. изм.»,
  // у другого единица внутри имени колонки, у третьего только текст.
  //
  // Счётчик по сетке ячеек работает лишь на тех форматах, которые знает.
  // Поэтому источник истины — САМА МОДЕЛЬ: она читает документы любого вида
  // и в поле source_positions_count сообщает, сколько строк-позиций увидела.
  //
  // Счётчик остаётся как СТРАХОВКА: если модель назвала меньше, чем видит
  // сетка, берём большее — так модель не сможет «не заметить» половину
  // таблицы. Если модель назвала число, берём его: она видит документ целиком.
  const expected = estimateExpectedForSelection(o.documents);
  const expectedMin = expected.estimate;
  const expectedRows = expected.rows;
  // Заполняется из первого ответа модели (source_positions_count).
  let modelSaidPositions = 0;

  const MAX_ROUNDS = 8;
  // Минимальный прирост новых позиций за раунд, при котором добор продолжается.
  // ВАЖНО: абсолютная константа, а не доля от ожидания. Порог, зависящий от
  // размера ведомости, нарушает монотонность: крупная ведомость обрывала бы
  // добор раньше мелкой при том же ответе модели.
  const MIN_GROWTH_PER_ROUND = 10;
  const allPositions = [];
  let firstDv = null;
  let lastRaw = '';
  let totalUsage = { inputTokens: 0, outputTokens: 0 };
  let salvaged = false;
  let usedModel = null;
  let usedProvider = null;
  let rounds = 0;
  // Прирост последнего раунда — нужен снаружи цикла, чтобы отличить
  // «модель закончила» от «мы остановились по лимиту раундов».
  let lastAdded = 0;
  let truncatedByLength = false;
  // Обрезка в ПОСЛЕДНЕМ раунде — именно она означает, что разбор оборван.
  let lastTruncated = false;

  // ── Большая ведомость: режем на порции ДО обращения к модели ────────────
  // На 673 строках модель отдавала от 1 до 353 позиций: ответ не влезал в
  // лимит токенов и обрывался в случайном месте. Режем по естественным
  // границам (цех, раздел) и разбираем порции отдельно — тогда каждый ответ
  // короткий, а склейка даёт полный список.
  const chunker = require('./dv-chunker');
  const sourceText = `${tzText}\n${docsText}`;
  // Нарезка нужна только на РЕАЛЬНО больших документах. Порог по символам:
  // меньше него модель справляется одним ответом, и нарезка лишь добавила бы
  // вызовы и стоимость. 60 000 символов — примерно 15 тыс. токенов.
  //
  // ВАЖНО: считаем только перечни, не ТЗ. В ТЗ тысячи нумерованных пунктов
  // требований, и их «порции» модель посчитает позициями, раздув ожидание
  // в разы (найдено на тесте: 3000 вместо 300).
  const countableText = (Array.isArray(o.documents) ? o.documents : [])
    .filter((d) => d && isVolumeListDoc(String(d.doc_role || d.role || ''), String(d.original_name || d.name || '')))
    .map((d) => String(d.text || d.ocr_text || ''))
    .join('\n');
  const CHUNK_THRESHOLD = 60000;
  const chunks = countableText.length > CHUNK_THRESHOLD ? chunker.chunkText(countableText) : [];
  const useChunks = chunks.length > 1;

  if (useChunks) {
    const perChunk = [];
    for (const ch of chunks) {
      let chRes;
      try {
        chRes = await o.aiProvider.complete({
          system,
          messages: [{
            role: 'user',
            content: `Разбери ТОЛЬКО этот фрагмент ведомости (${ch.title}, `
              + `строки ${ch.fromLine}–${ch.toLine}). Не бери позиции из других частей.\n\n`
              + ch.text
          }],
          maxTokens: 64000,
          temperature: 0,
          expectJson: true
        });
      } catch (_) {
        continue;
      }
      const chParsed = safeJson(chRes && chRes.text);
      if (!chParsed) continue;
      const chDv = stages.normalizeDv(chParsed, catalog);
      if (!firstDv) firstDv = chDv;
      perChunk.push(chDv.positions || []);
      rounds += 1;
      const said = Number(chParsed.source_positions_count);
      if (Number.isFinite(said) && said > 0) modelSaidPositions += Math.round(said);
    }
    // Склейка с удалением повторов на стыках порций.
    allPositions.push(...chunker.mergeChunkPositions(perChunk));
    lastAdded = allPositions.length;
  }

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    // Порционный разбор уже собрал позиции — обычный цикл не нужен.
    if (useChunks && allPositions.length) break;
    let res;
    try {
      res = await o.aiProvider.complete({
        system,
        messages: [{ role: 'user', content: user }],
        // Поднято с 32000: 673 позиции дефектной ведомости 2138 — это ~34 тыс.
        // токенов, и при 32000 ответ обрезался на середине массива.
        maxTokens: 64000,
        // temperature 0 — ОБЯЗАТЕЛЬНО для разбора ведомости.
        // Было 0.15: при повторном запуске на том же документе модель давала
        // то 1, то 353 позиции. Разбор перечня — не творческая задача, здесь
        // нужна воспроизводимость: один документ = один результат.
        temperature: 0,
        responseFormat: { type: 'json_object' },
        reasoning: { enabled: false }
      });
    } catch (e) {
      return { ok: false, error: 'Модель недоступна: ' + e.message };
    }
    rounds += 1;
    if (res && res.model) usedModel = res.model;
    if (res && res.provider) usedProvider = res.provider;

    if (res && res.usage) {
      totalUsage.inputTokens += Number(res.usage.inputTokens) || 0;
      totalUsage.outputTokens += Number(res.usage.outputTokens) || 0;
    }
    lastRaw = String((res && res.text) || '');

    // Обрезка по лимиту токенов определяется по finish_reason, а не догадкой
    // по падению JSON.parse: при коротком ответе парсинг проходит, и обрезка
    // оставалась незамеченной.
    // OpenAI отдаёт 'length', Anthropic — 'max_tokens'. Учитываем оба.
    const reason = String((res && res.stopReason) || '').toLowerCase();
    const finishedByLength = reason === 'length' || reason === 'max_tokens';
    if (finishedByLength) truncatedByLength = true;

    const parsed = safeJson(lastRaw);
    if (!parsed) {
      // Первый круг без разбора JSON — это провал. Дальше — обрываем добор.
      if (!firstDv) {
        return {
          ok: false,
          error: 'Модель вернула ответ не по схеме — попробуйте ещё раз',
          raw: lastRaw.slice(0, 500)
        };
      }
      break;
    }

    const dvRound = stages.normalizeDv(parsed, catalog);
    if (!firstDv) firstDv = dvRound;

    // Сколько позиций модель САМА увидела в документах. Берём из первого
    // ответа: дальше она отдаёт только продолжение и счётчика не повторяет.
    if (!modelSaidPositions) {
      const said = Number(parsed.source_positions_count);
      if (Number.isFinite(said) && said > 0) modelSaidPositions = Math.round(said);
    }

    // ── Дедупликация ────────────────────────────────────────────────────────
    // Дефект 07.11: при доборе модель начинала ведомость заново, и одна и та
    // же строка повторялась до 39 раз (тендер 2138: 224 лишние позиции из 364).
    // Сравниваем по отпечатку «название + объём + единица»: разные аппараты
    // с одинаковым объёмом различаются названием, а настоящий повтор — нет.
    const seen = new Set(allPositions.map(dupKey));
    let added = 0;
    for (const p of (dvRound.positions || [])) {
      const k = dupKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      allPositions.push(p);
      added += 1;
    }
    const got = added;
    lastAdded = added;

    // ── Условие выхода: полнота, а не «ответ валиден» ────────────────────
    // Дефект 07.11: раньше выход был по `!parsed._salvaged`, то есть валидный
    // JSON с одной позицией принимался как полный ответ. Теперь сравниваем
    // с ожидаемым числом позиций, посчитанным по документам, которые модель
    // реально видела.
    //
    // ВАЖНО: если ожидание неизвестно (expectedMin = 0 — в тендере только ТЗ
    // без перечня работ), порог не применяется вообще. Иначе добор шёл бы
    // всегда: продолжать нечего, а модель возвращала бы хвост первого ответа
    // и плодила фантомные позиции без объёма.
    const wasTruncated = parsed._salvaged || finishedByLength;
    if (wasTruncated) salvaged = true;
    // Обрезка отслеживается по ПОСЛЕДНЕМУ раунду: если модель в итоге закрыла
    // массив (stop), разбор полный, даже если середина была обрезана.
    lastTruncated = wasTruncated;

    const validCount = countValidPositions(allPositions);

    // ── Решение о продолжении ───────────────────────────────────────────
    // ВАЖНО (найдено верификатором): выход был заперт внутри `if (!wasTruncated)`,
    // поэтому при обрезке цикл шёл до 8 раундов даже когда:
    //   • ожидание неизвестно (expectedMin = 0, в тендере только ТЗ) —
    //     продолжать нечего, модель возвращала хвост первого ответа;
    //   • позиций уже достаточно — лишние раунды стоили по 64k токенов.
    //
    // Правильный порядок: сначала решаем, НУЖЕН ли ещё добор, и только потом
    // смотрим, есть ли что добавлять.

    // Ожидание неизвестно — сравнивать не с чем, выходим после первого разбора.
    if (expectedMin === 0) break;

    // Позиций достаточно — выходим.
    // НО: если ответ обрезан и модель в прошлом раунде ещё добавляла позиции,
    // обрывать рано нельзя — теряются реальные данные. Проверяем оба условия.
    const enough = validCount >= expectedMin * 0.8;
    if (enough && !wasTruncated) break;

    // ── Обрезка: единственный критерий — прирост, не количество ────────────
    // КОРЕНЬ (найдено верификатором, трижды): expectedMin — НИЖНЯЯ оценка
    // (строки / 2), примерно половина реального объёма. Любое правило вида
    // «собрали >= expectedMin → выходим» описывает не полноту, а совпадение
    // с заниженной оценкой, и потому работает немонотонно:
    //   673 строки → 353 позиции → 1 вызов (потеря 320)
    //   720 строк  → 353 позиции → 2 вызова (добор сработал)
    //
    // При обрезке выходим ТОЛЬКО по приросту новых позиций:
    //   • первый раунд — всегда добираем, модель не успела;
    //   • дальше — пока раунд даёт заметный прирост.
    // Никаких проверок по количеству здесь быть не должно.
    if (wasTruncated) {
      if (round > 0) {
        // Порог прироста — АБСОЛЮТНЫЙ, не зависит от размера ведомости.
        // Верификатор доказал: порог вида `expectedMin * 0.05` растёт вместе
        // с ведомостью, поэтому крупная ведомость обрывала добор раньше
        // мелкой — 673 строки давали 670 позиций, а 720 строк всего 370.
        // Монотонности при зависимом пороге быть не может по построению.
        const grownInRound = added || 0;
        if (grownInRound < MIN_GROWTH_PER_ROUND) break;
      }
    }

    // Недобор. Обрезанный ответ — добираем (модель не успела).
    // Необрезанный — просим продолжить один раз.
    if (!wasTruncated && round > 0) break;

    if (!got) break;

    // Защита от фантомов: если два раунда подряд дают новые позиции, но ни
    // одной годной (без объёма и единицы), добирать бессмысленно — это уже
    // не разбор, а генерация заголовков. Выходим.
    if (validCount === 0 && round >= 1) break;

    // Просим продолжить с последней полученной позиции и явно перечисляем,
    // что уже собрано: иначе модель генерирует ведомость заново.
    const last = allPositions[allPositions.length - 1] || {};
    const already = allPositions.slice(-40).map((p) => String(p.name || '').slice(0, 70)).join('\n- ');
    user = `Продолжи ведомость с позиции «${String(last.name || '').slice(0, 80)}» (она уже учтена, не повторяй).

УЖЕ СОБРАНО ${allPositions.length} позиций. Последние из них:
- ${already}

Верни ТОЛЬКО JSON с массивом positions — позиции, которых в списке выше НЕТ.
Не повторяй уже собранное. Не начинай сначала.`;
  }

  if (!firstDv) {
    return { ok: false, error: 'Модель не вернула разбор — попробуйте ещё раз', raw: lastRaw.slice(0, 500) };
  }

  // Собираем итоговую ДВ: поля-описания из первого круга, позиции — все.
  const dv = Object.assign({}, firstDv, { positions: allPositions });

  // ── Диагностика полноты ──────────────────────────────────────────────────
  // Без этих полей РП не отличает полный разбор от частичного: в ответе API
  // было только generation_rounds, и «353 позиции» выглядели одинаково
  // независимо от того, 353 их в ведомости или 673.
  //
  // ── Признак полноты ──────────────────────────────────────────────────────
  // Тринадцать проходов верификатора доказали одно: ЛЮБАЯ оценка числа
  // позиций по тексту ошибочна. Считали строки с единицами — ломались «м»,
  // «компл», Гкал, шапки, docx, csv. Считали нумерацию — ломались разделы с
  // перезапуском, пропущенный номер (300 → 150), колонка «Кол-во» (300 → 400).
  // Перечисление форматов бесконечно, а знаменатель каждый раз врёт.
  //
  // Поэтому знаменатель больше не угадывается. Флаг ставится по НАБЛЮДАЕМОМУ
  // факту, который не зависит от формата документа:
  //
  //   1) модель сама сообщила обрезку (finish_reason = length/max_tokens) —
  //      значит ответ оборван на полуслове, часть позиций не дошла;
  //   2) И при этом добор уже не может продолжаться (цикл вышел по приросту
  //      или по !got) — то есть продолжить мы больше не можем.
  //
  // Это честно: сигнал означает «ответ был обрезан, и мы остановились», а не
  // «мы посчитали, сколько должно быть». Ложных срабатываний нет по
  // построению: если обрезки не было, флаг не встанет никогда.
  //
  // Оценка числа позиций (expectedRows) остаётся в ответе как СПРАВОЧНАЯ —
  // РП видит, сколько строк нашлось в документах, но она не управляет флагом.
  // Флаг ставится по фактам, не зависящим от точности оценки:
  //   1) последний ответ оборван по лимиту длины;
  //   2) исчерпан лимит раундов, а последний раунд давал новые позиции;
  //   3) собрано меньше ПОЛОВИНЫ найденных строк с объёмом — грубый недобор.
  //
  // Порог 50% выбран намеренно консервативным. Тринадцать проходов показали,
  // что счётчик строк может ошибаться в обе стороны (подстроки завышают,
  // рваная нумерация занижает). При ошибке вдвое в любую сторону 50% остаётся
  // внутри допуска: недобор в 10 раз (1 позиция из 400) ловится всегда, а
  // ложного срабатывания на полном разборе не будет.
  //
  // Точную сверку даёт review_hint с конкретными числами: РП видит
  // «найдено 400 строк, в разборе 353» и решает сам.
  const validFound = countValidPositions(allPositions);
  const exhaustedRounds = rounds >= MAX_ROUNDS && lastAdded > 0;

  // Ожидание: что сказала модель, а что видит сетка — берём БОЛЬШЕЕ.
  //
  // Модель читает документ любого формата и видит перечень целиком, поэтому
  // её слово главнее. Но если она «не заметила» половину таблицы, сетка её
  // поправит — так мы не потеряем недобор. Обратное тоже верно: сетка может
  // ошибиться на незнакомом формате, и тогда модель её вытянет.
  const expectedFinal = Math.max(expectedRows || 0, modelSaidPositions || 0);
  const grossShortfall = expectedFinal > 0 && validFound < expectedFinal * 0.5;
  const incomplete = lastTruncated || exhaustedRounds || grossShortfall;

  return {
    ok: true,
    dv,
    salvaged,
    truncated_by_length: truncatedByLength,
    rounds,
    expected_min: expectedMin,
    expected_rows: expectedFinal,
    expected_rows_grid: expectedRows,
    model_said_positions: modelSaidPositions,
    found_positions: allPositions.length,
    valid_positions: validFound,
    incomplete,
    incomplete_note: incomplete
      ? (lastTruncated
        ? `Модель не успела выдать весь разбор: получено ${validFound} позиций, `
          + 'ответ оборван по лимиту длины. Нажмите «Продолжить разбор» или '
          + 'разбейте ведомость на части.'
        : exhaustedRounds
          ? `Разбор остановлен по лимиту раундов: получено ${validFound} позиций. `
            + 'Проверьте, не остались ли строки ведомости неразобранными.'
          : `Разбор неполный: получено ${validFound} позиций, а в документах `
            + `позиций: ${expectedFinal}. Проверьте ведомость `
            + 'или повторите разбор.')
      : null,
    // Сводка для сверки: сколько позиций в документах.
    // Две величины намеренно: модель читает любой формат, сетка знает только
    // свои. Если они расходятся — РП видит обе и решает сам.
    review_hint: expectedFinal > 0 && validFound < expectedFinal * 0.9
      ? `В документах позиций: ${expectedFinal}`
        + (modelSaidPositions && expectedRows && modelSaidPositions !== expectedRows
          ? ` (модель: ${modelSaidPositions}, сетка: ${expectedRows})` : '')
        + `, в разборе: ${validFound}. Сверьте с ведомостью.`
      : null,
    model: usedModel,
    provider: usedProvider,
    tokens: totalUsage
  };
}

/**
 * Генерирует план просчёта (люди, сроки, оборудование).
 *
 * @param {object} p
 * @param {object} p.aiProvider
 * @param {Array}  p.positions — согласованные позиции ДВ
 * @param {string} p.normPreviewMd — блок NORM PREVIEW
 * @param {string} p.workersMd — бригада и допуска
 * @param {number} p.dateWindow — календарных дней (может быть null)
 * @param {number} p.maxParallelPosts
 */
async function generateCalcPlan(p) {
  const o = p || {};
  const positions = Array.isArray(o.positions) ? o.positions : [];
  if (!positions.length) {
    return { ok: false, error: 'Нет позиций для плана — сначала заполните ДВ' };
  }

  const system = promptLoader.buildPrompt('PROMPT-calc-plan-v1.md', {
    positions: positions.map((x, i) =>
      `${i + 1}. ${x.name} — ${x.volume} ${x.unit} · ${x.category_code}.${x.method_code || '—'}` +
      (x.tech_equip ? `\n   технология: ${x.tech_equip}` : '') +
      (Array.isArray(x.objects) && x.objects.length
        ? `\n   аппараты: ${x.objects.map((ob) => ob.tag || ob.type).filter(Boolean).join(', ')}` : '')
    ).join('\n'),
    tech_equip: positions.map((x) => x.tech_equip).filter(Boolean).join('; ') || '(не задана)',
    norm_preview: o.normPreviewMd || '(нормативов нет)',
    workers: o.workersMd || '(данные по бригаде не переданы)',
    date_window: o.dateWindow != null ? String(o.dateWindow) : '(не задано)',
    max_parallel_posts: String(o.maxParallelPosts || 2)
  });

  const user = 'Разложи работы по аппаратам: люди, сроки, оборудование и источник каждой цифры. Только JSON.';

  let res;
  try {
    res = await o.aiProvider.complete({
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 12000,
      temperature: 0.15,
      responseFormat: { type: 'json_object' },
      reasoning: { enabled: false }
    });
  } catch (e) {
    return { ok: false, error: 'Модель недоступна: ' + e.message };
  }

  const parsed = safeJson(res && res.text);
  if (!parsed) {
    return {
      ok: false,
      error: 'Модель вернула план не по схеме — попробуйте ещё раз',
      raw: (res && res.text || '').slice(0, 500)
    };
  }

  const plan = stages.normalizeCalcPlan(parsed, {
    max_parallel_posts: o.maxParallelPosts,
    // Окно дат нужно, чтобы подобрать число бригад под график заказчика.
    window_days: o.dateWindow
  });
  return {
    ok: true,
    plan,
    model: res.model || null,
    provider: res.provider || null,
    tokens: res.usage || null
  };
}

/** Предпросмотр калибровки справочника: что изменится после сохранения. */
function buildCalibrationPreview(positions, plan) {
  const calc = (plan && plan.positions) || [];
  const rows = [];
  for (const c of calc) {
    // Для калибровки нужен код нормы и связь с позицией ДВ. У экспертных оценок
    // нормы нет — они в обучение не идут (это фиксируется в отчёте, не молча).
    if (!c.source_ref) continue;
    if (c.source !== 'norm' && c.source !== 'history' && c.source !== 'analog') continue;
    const pos = (positions || []).find((x) => x.id === c.position_id)
      || (positions || []).find((x) => x.name === c.name)
      || null;
    if (!pos || !(Number(pos.volume) > 0) || !(Number(c.days) > 0)) continue;
    rows.push({
      code: c.source_ref,
      position: pos.name,
      source: c.source,
      train: c.source === 'norm',
      work_days: Number(c.days),
      people: Number(c.people) || null,
      inputs: { [volumeKeyFor(pos)]: Number(pos.volume) }
    });
  }
  return rows;
}

function volumeKeyFor(pos) {
  const u = String(pos && pos.unit || '').toLowerCase();
  if (u.includes('м³') || u.includes('м3')) return 'circuit_m3';
  if (u.includes('м²') || u.includes('м2')) return 'surface_m2';
  if (u.includes('труб')) return 'tubes';
  if (u.includes('стык')) return 'joints';
  if (u.includes('м')) return 'length_m';
  if (u.includes('цикл')) return 'cycles';
  return 'qty';
}

module.exports = {
  dupKey,
  generateDv,
  generateCalcPlan,
  buildCalibrationPreview,
  catalogForPrompt,
  docsToText,
  lastSelection: () => lastSelection,
  safeJson,
  volumeKeyFor
};
