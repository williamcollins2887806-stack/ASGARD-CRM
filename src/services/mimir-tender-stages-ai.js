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
const excelStructure = require('./excel-structure');

// Что ушло в промпт на последнем вызове — для журнала анализа.
// module-level: вызовы последовательные, гонки нет.
let lastSelection = null;

/**
 * complete() или stream()+parseStream() — если есть onProgress и stream API.
 * Эмитит model_stream каждые ~1.5 с (символы, черновик позиций, хвост).
 */
async function completeOrStream(aiProvider, opts, emit, streamMeta) {
  const o = opts || {};
  const meta = streamMeta || {};
  const canStream = typeof emit === 'function'
    && typeof aiProvider.stream === 'function'
    && typeof aiProvider.parseStream === 'function';
  if (!canStream) {
    return aiProvider.complete(o);
  }
  const response = await aiProvider.stream({
    system: o.system,
    messages: o.messages,
    maxTokens: o.maxTokens,
    temperature: o.temperature != null ? o.temperature : 0,
    responseFormat: o.responseFormat || (o.expectJson ? { type: 'json_object' } : undefined),
    // Reasoning-контроль ОБЯЗАН доходить и до потока, не только до complete().
    // Без него deepseek-v4.1-flash тратит max_tokens на «размышления», уходит
    // в finish_reason=length с НЕЗАКРЫТЫМ JSON, и порча ответа превращается в
    // потерю позиций: на проде 12.11.2026 порция из 164 строк давала 36–54
    // (в прямом замере с тем же промптом и reasoning:false — 164 из 164).
    // См. ai-provider.js: reasoning:{enabled:false} отдаёт весь бюджет под content.
    reasoning: o.reasoning,
    model: o.model
  });
  const provider = (aiProvider.getProvider && aiProvider.getProvider())
    || (aiProvider.getConfig && aiProvider.getConfig().provider)
    || 'openai';
  let fullText = '';
  let usage = { inputTokens: 0, outputTokens: 0 };
  let stopReason = 'end_turn';
  let lastEmitAt = 0;
  for await (const chunk of aiProvider.parseStream(
    response,
    provider === 'anthropic' ? 'anthropic' : 'openai'
  )) {
    if (chunk.type === 'text' && chunk.content) {
      fullText += chunk.content;
      const now = Date.now();
      if (now - lastEmitAt >= 1500) {
        lastEmitAt = now;
        const nameHits = (fullText.match(/"name"\s*:/g) || []).length;
        emit({
          step: 'model_stream',
          message: `Модель пишет ответ: ${fullText.length} симв.`
            + (nameHits ? `, ~${nameHits} поз. в черновике` : '')
            + (meta.label ? ` (${meta.label})` : ''),
          pct: meta.pct != null ? meta.pct : 15,
          chars: fullText.length,
          positions_draft: nameHits,
          snippet: fullText.slice(-120)
        });
      }
    } else if (chunk.type === 'done') {
      usage = chunk.usage || usage;
      if (chunk.stopReason) stopReason = chunk.stopReason;
    }
  }
  return {
    text: fullText,
    usage,
    stopReason,
    model: (aiProvider.getConfig && aiProvider.getConfig().model) || o.model || null,
    provider
  };
}

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
  // Сколько строк реально в документе — считаем ДВУМЯ путями и берём больший.
  //
  // Путь 1 (структурный): `parsed.stats.positions` из excel-structure — точный
  // счёт по СЕТКЕ ЯЧЕЕК. В БД таблица лежит CSV-склейкой, поэтому структуру
  // приходится разбирать заново (structureOf), но это единственный источник,
  // который знает про 675 строк формы 2138: `documents.table_positions`
  // в этой базе = 0, потому что .xls читался через LibreOffice без сетки.
  let structuredRows = 0;
  try {
    structuredRows = buildStructuredInput(list).rows;
  } catch (_) { structuredRows = 0; }

  try {
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
      // Дефект 675 → 318: документ с таблицей объёмов отбрасывался, если
      // структурный счётчик не сработал (нестандартная вёрстка, .xls без
      // table_positions). Теперь при structured = 0 пробуем текстовый счёт
      // по строкам — он грубее, но видит то, что сетка пропустила.
      let rows = structured;
      if (rows <= 0) {
        try { rows = docRole.countVolumeRows(text); } catch (_) { rows = 0; }
      }
      if (rows <= 0) continue;
      // Структура документа (если разбор возможен) — чтобы схлопнуть ОДИН
      // перечень, пришедший в двух вёрстках. Без этого «Форма» (675) и
      // «Дефектная ведомость» (673) суммировались в 1348 при реальных 675
      // (тендер 2138, 12.11.2026).
      let struct = null;
      try { struct = structureOf(d); } catch (_) { struct = null; }
      docs.push({
        name,
        structured: rows,
        signature: textSignature(text),
        positions: struct && Array.isArray(struct.positions) ? struct.positions : null
      });
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
      // Подписи по тексту мало: «Форма тендерного предложения» и «Дефектная
      // ведомость» — один перечень, но тексты у них разные, поэтому раньше
      // 675 + 673 = 1348. Если есть структура — сравниваем ПОЗИЦИИ.
      const kept = [];
      for (const doc of docs) {
        if (doc.signature && kept.some((k) => k.signature === doc.signature)) continue;
        let dup = false;
        if (Array.isArray(doc.positions) && doc.positions.length >= 5) {
          for (const k of kept) {
            if (!Array.isArray(k.positions) || !k.positions.length) continue;
            try {
              if (excelStructure.compareLists(k.positions, doc.positions).sameList) { dup = true; break; }
            } catch (_) { /* сравнение — вспомогательное */ }
          }
        }
        if (dup) continue;
        kept.push(doc);
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

    // ── Согласование источников ────────────────────────────────────────────
    // Было `Math.max(...)`: один завышенный источник портил результат всегда
    // (подстроки «в т.ч.» давали 672 при 336 реальных).
    //
    // Простой «берём структурный» тоже неверен: структурный счёт умеет
    // ЗАНИЖАТЬ (пропущенная шапка, нестандартная вёрстка) — это тест
    // «занижённый структурный счёт не маскирует недобор».
    //
    // Работающее правило — МЕДИАНА по доступным источникам. Она устойчива к
    // одному выбросу в любую сторону: при 42 / 300 / 300 даёт 300, при
    // 336 / 672 / 336 — 336. Максимум брал выброс, структурный брал
    // занижение; медиана не берёт ни то, ни другое.
    const structuredEst = estimate;   // сумма структурных по документам
    const candidates = [structuredEst, textEstimate, structuredRows].filter((x) => x > 0);
    let finalEstimate = 0;
    let estimateConflict = null;
    if (candidates.length) {
      const sorted = candidates.slice().sort((a, b) => a - b);
      finalEstimate = sorted[Math.floor(sorted.length / 2)];
      const maxV = sorted[sorted.length - 1];
      const minV = sorted[0];
      if (minV > 0 && maxV / minV > 1.5) {
        estimateConflict = {
          structured: structuredEst,
          text: textEstimate,
          structured_rows: structuredRows,
          applied: finalEstimate,
          reason: 'источники расходятся более чем в 1,5 раза — взята медиана'
        };
      }
    }
    return {
      rows: finalEstimate,
      estimate: finalEstimate,
      structured: structuredRows,
      estimate_conflict: estimateConflict
    };
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

/**
 * Подсказка по графику заездов для промпта.
 *
 * Модель читает документы сама — но если график лежит отдельным файлом или
 * таблицей, детерминированный разбор помогает не пропустить месяцы. Формат
 * человеческий: месяцы, даты, цитаты. Если ничего не нашли — так и пишем,
 * чтобы модель не считала, что подсказка есть.
 */
function formatVisitHints(hints) {
  const h = hints || {};
  const visits = Array.isArray(h.visits) ? h.visits : [];
  const months = Array.isArray(h.months) ? h.months : [];
  const lines = [];
  if (h.mode && h.mode !== 'unknown') {
    lines.push(`режим по тексту: ${h.mode === 'continuous' ? 'один непрерывный заезд' : 'несколько выездов'}`);
  }
  if (h.explicit_trip_count) lines.push(`явно указано выездов: ${h.explicit_trip_count}`);
  if (months.length) {
    const names = require('./schedule-extract');
    lines.push('месяцы в тексте: ' + months.map((m) => names.monthName(m)).join(', '));
  }
  for (const v of visits.slice(0, 12)) {
    lines.push(`- ${v.label || ''}`.trim()
      + (v.start || v.end ? ` (${[v.start, v.end].filter(Boolean).join('…')})` : '')
      + (v.quote ? ` · «${String(v.quote).slice(0, 120)}»` : ''));
  }
  if (h.continuous_signal) lines.push('признак непрерывных работ: есть (остановка / без перерыва)');
  if (!lines.length) return '(графика в тексте не найдено — определяй по документам сам)';
  return lines.join('\n');
}

function docsToText(documents, limit = 2500000) {  const list = Array.isArray(documents) ? documents : [];
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

// ── Структурный вход: таблица вместо CSV-сырья ──────────────────────────────
/**
 * ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ ПОТОК (тендер 2138, 11.11.2026)
 *
 * Ведомость «7. Форма тендерного предложения» — 675 позиций в 7 приложениях,
 * 49 периодов. В БД её текст лежит CSV-склейкой листов: 787 строк вида
 * `1,1,,теплообменник оборотной воды 2104L,1-Б,иловые отложения,...,апрель,,,,`.
 *
 * Раньше в промпт уходили ДВА представления одних и тех же данных: эта CSV-
 * простыня и блок `excel-structure.toPromptText()`. CSV доминировал по объёму
 * и выглядел «сырьём для анализа», поэтому модель вела себя как аналитик:
 * вернула 6–7 агрегатов по листам («Гидродинамическая чистка… — 1 143 958 п.м»)
 * вместо 675 строк, суммы не совпали с файлом, а периоды потерялись полностью
 * (`period: null` у всех).
 *
 * Теперь у Excel один источник — структура: колонки определены по заголовкам,
 * строка таблицы = позиция. CSV в промпт не попадает вообще.
 */
const SPREADSHEET_EXT = /\.(xlsx|xlsm|xls|csv)$/i;

/** Разобранная структура документа: WeakMap по объекту, чтобы не парсить дважды. */
const _structureCache = new WeakMap();

/** Это табличный файл (по имени или по уже готовой структуре от парсера)? */
function isSpreadsheetDoc(d) {
  if (!d || typeof d !== 'object') return false;
  if (d.structure && Array.isArray(d.structure.positions)) return true;
  const name = String(d.original_name || d.filename || d.name || '');
  return SPREADSHEET_EXT.test(name);
}

/**
 * Текст похож на выгрузку таблицы (CSV или `=== Лист ===` + CSV)?
 *
 * Нужен как дешёвый фильтр: не гонять XLSX.read по каждой .docx и по
 * псевдотаблицам вида `| 1 | Очистка | м3 | 10 |` (они идут текстовым путём).
 */
function looksLikeSpreadsheetText(text) {
  const s = String(text || '');
  if (!s) return false;
  if (/^=== .+ ===$/m.test(s)) return true;
  const lines = s.split(/\r?\n/).slice(0, 80);
  if (!lines.length) return false;
  let csvish = 0;
  for (const ln of lines) if ((ln.match(/,/g) || []).length >= 2) csvish += 1;
  return csvish >= 5 && csvish / lines.length >= 0.5;
}

/** Строка структуры в формате `toPromptText` — одна табличная строка = одна позиция. */
function structureLine(it) {
  const o = it || {};
  return [
    o.name || '—',
    o.volume != null ? String(o.volume) : '—',
    o.unit || '—',
    o.zone || '—',
    o.fouling || '—',
    o.period || '—',
    o.clean_count != null ? String(o.clean_count) : '—',
    // ── Геометрия аппарата ────────────────────────────────────────────────
    // Без этих трёх полей модель физически не может их вернуть: в порции она
    // видит только текст этой строки. А норма tubes.gdo/gmo/chem считает
    // ИМЕННО трубки и длину — на #2138 без них 452 позиции из 658 остались
    // без срока с ответом «Укажите число трубок» (дефект 12.11.2026).
    o.tubes != null ? String(o.tubes) : '—',
    o.length_m != null ? String(o.length_m) : '—',
    o.dn_mm != null ? String(o.dn_mm) : '—',
    o.mh != null ? String(o.mh) : '—'
  ].join(' | ');
}

/**
 * Компактный блок структуры для промпта.
 *
 * `excel-structure.toPromptText` режет список на 900 позициях и дописывает
 * служебную строку «… ещё N позиций (обрезано)». На больших ведомостях эта
 * строка оставалась в СЕРЕДИНЕ данных и прямо говорила модели, что дальше
 * ничего нет — ровно та потеря, из-за которой разбор был неполным.
 *
 * Здесь служебная пометка снимается, а остаток дописывается строками того же
 * формата: каждая строка самодостаточна, шапка ей не нужна.
 */
function structurePromptText(parsed) {
  const p = parsed || {};
  const list = Array.isArray(p.positions) ? p.positions : [];
  let text = excelStructure.toPromptText(p);
  // Снимаем пометку обрезки: она врёт, потому что ниже идёт полный хвост.
  text = text.replace(/\n?… ещё \d+ позиций \(обрезано\)/g, '');
  if (list.length > 900) {
    const tail = list.slice(900).map(structureLine).join('\n');
    text += '\n' + tail;
  }
  return text;
}

/**
 * Разбирает CSV-выгрузку листов в структуру через `excel-structure`.
 *
 * Вход — текст, который уже лежит в БД (`ocr_text`): `=== <лист> ===` плюс
 * `sheet_to_csv` этого листа. Здесь он снова превращается в сетку ячеек,
 * потому что без сетки колонки не сопоставить по заголовкам.
 */
function parseSpreadsheetText(text) {
  const src = String(text || '');
  const XLSX = require('xlsx');
  const bodies = [];
  const parts = src.split(/^=== (.+?) ===[ \t]*$/m);
  if (parts.length >= 3) {
    for (let i = 1; i < parts.length; i += 2) {
      bodies.push({ name: String(parts[i]).trim() || ('Лист' + ((i + 1) / 2)), text: parts[i + 1] || '' });
    }
  } else {
    bodies.push({ name: 'Лист1', text: src });
  }

  const wb = { SheetNames: [], Sheets: {} };
  for (const b of bodies) {
    let aoa = [];
    try {
      const one = XLSX.read(b.text, { type: 'string', raw: false, cellText: true });
      const ws = one.Sheets[one.SheetNames[0]];
      aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '', raw: false });
    } catch (_) {
      continue;
    }
    if (!Array.isArray(aoa) || !aoa.length) continue;
    // Имя листа может повторяться в выгрузке — второй такой же не затираем.
    let name = b.name;
    let n = 2;
    while (wb.Sheets[name]) { name = `${b.name} (${n})`; n += 1; }
    wb.SheetNames.push(name);
    wb.Sheets[name] = { _aoa: aoa };
  }
  if (!wb.SheetNames.length) return null;

  // parseWorkbook ждёт объект XLSX с utils.sheet_to_json — отдаём сетку как есть.
  const shim = { utils: { sheet_to_json: (sheet) => sheet._aoa } };
  const parsed = excelStructure.parseWorkbook(shim, wb);
  return parsed && parsed.stats && parsed.stats.positions > 0 ? parsed : null;
}

/** Структура документа (или null). Кэш на объекте документа. */
function structureOf(d) {
  if (!d || typeof d !== 'object') return null;
  if (_structureCache.has(d)) return _structureCache.get(d);
  let parsed = null;
  if (d.structure && Array.isArray(d.structure.positions)) {
    parsed = d.structure;
  } else if (isSpreadsheetDoc(d)) {
    const text = String(d.text || d.ocr_text || '');
    if (looksLikeSpreadsheetText(text)) {
      try { parsed = parseSpreadsheetText(text); } catch (_) { parsed = null; }
    }
  }
  _structureCache.set(d, parsed);
  return parsed;
}

/**
 * Собирает структурный вход по всем табличным документам.
 *
 * Копии одного перечня (несколько загрузок одного файла, «Форма» и «Дефектная
 * ведомость» с теми же объёмами) считаем ОДИН раз — иначе 675 строк превратятся
 * в 4050 и модель получит противоречивые данные.
 *
 * @returns {{entries:Array, text:string, rows:number, periods:number}}
 */
function buildStructuredInput(documents) {
  const list = Array.isArray(documents) ? documents : [];
  const entries = [];
  // Копии одного файла (на 2138 их по 6 штук) парсить шесть раз незачем:
  // у них то же имя и та же длина текста. Отсекаем ДО XLSX.read — иначе
  // структурный разбор становился самой долгой частью подготовки промпта.
  const seenCopies = new Set();
  for (const d of list) {
    if (!d || typeof d !== 'object') continue;
    const copyKey = String(d.original_name || d.filename || d.name || '')
      + '|' + String(d.text || d.ocr_text || '').length;
    const parsed = structureOf(d);
    if (!parsed) continue;
    if (seenCopies.has(copyKey)) continue;
    seenCopies.add(copyKey);
    const name = String(d.original_name || d.filename || d.name || 'документ');
    const dup = entries.find((e) => {
      const a = (e.parsed.positions || []).length;
      const b = (parsed.positions || []).length;
      const smaller = Math.min(a, b);
      const bigger = Math.max(a, b);
      if (!bigger) return false;
      let cmp = null;
      try { cmp = excelStructure.compareLists(e.parsed.positions, parsed.positions); } catch (_) { cmp = null; }
      // Подпись по НАЗВАНИЯМ сильнее объёмной: в «Форме» объём трубчатых
      // аппаратов посчитан из геометрии, в дефектной ведомости дан колонкой,
      // поэтому объёмы расходятся, а позиции — те же (599 общих из 601).
      // Такой перечень — копия при ЛЮБОЙ разнице размеров: ошибиться и
      // потерять настоящий перечень здесь нельзя, названия уникальны.
      if (cmp && cmp.ratio_name >= 0.9 && smaller >= 5) return true;
      // Копия одного файла — это такой же перечень: размеры отличаются на
      // единицы процентов. Сравниваем только сопоставимые по размеру.
      if (smaller / bigger >= 0.85) {
        try { return !!(cmp && cmp.sameList); } catch (_) { return false; }
      }
      // Вложенный перечень (дефектная ведомость = Прил_1) — тоже копия, но
      // ТОЛЬКО когда он большой: у маленького приложения (4–5 позиций)
      // подпись «объём+период+единица» случайно совпадает с чужими строками,
      // и потерять его молча дороже, чем продублировать несколько строк.
      if (smaller < 20) return false;
      try {
        return !!(cmp && cmp.ratio >= 0.99);
      } catch (_) { return false; }
    });
    if (dup) continue;
    entries.push({ name, parsed });
  }

  const blocks = entries.map((e) => {
    const n = Number(e.parsed.stats && e.parsed.stats.positions) || 0;
    return `=== ${e.name} — ТАБЛИЦА, разобрана по клеткам (строк ${n}) ===\n`
      + structurePromptText(e.parsed);
  });

  return {
    entries,
    text: blocks.join('\n\n'),
    rows: entries.reduce((s, e) => s + (Number(e.parsed.stats && e.parsed.stats.positions) || 0), 0),
    periods: entries.reduce((s, e) => s + (Number(e.parsed.stats && e.parsed.stats.periods) || 0), 0)
  };
}

/**
 * Текст документов БЕЗ табличных: ТЗ, письма, договоры — контекст, а не данные.
 *
 * CSV таблиц сюда не попадает: он уже превращён в структуру. Если структуру
 * разобрать не удалось (незнакомый формат), сырой текст остаётся — лучше
 * показать его с пометкой, чем потерять объёмы совсем.
 */
function freeDocsToText(documents, limit) {
  const list = (Array.isArray(documents) ? documents : []).filter((d) => {
    if (!d) return false;
    return !(isSpreadsheetDoc(d) && structureOf(d));
  });
  return docsToText(list, limit);
}

/**
 * Нарезка структурного блока ПО СТРОКАМ ТАБЛИЦЫ.
 *
 * Нужна только когда расчётный ответ не влезает в предел модели (тысячи
 * позиций). Резать структуру по строкам можно точно: каждая строка
 * самодостаточна, шапка таблицы модели уже не нужна — колонки подписаны
 * в самой строке.
 */
function chunkStructureRows(structured, maxRows) {
  const out = [];
  const limit = Math.max(20, Number(maxRows) || 250);
  const entries = (structured && Array.isArray(structured.entries)) ? structured.entries : [];
  for (const e of entries) {
    const list = (e.parsed && Array.isArray(e.parsed.positions)) ? e.parsed.positions : [];
    for (let from = 0; from < list.length; from += limit) {
      const slice = list.slice(from, from + limit);
      out.push({
        index: out.length,
        fromLine: from + 1,
        toLine: from + slice.length,
        title: `${e.name}, строки ${from + 1}–${from + slice.length}`,
        text: slice.map(structureLine).join('\n'),
        // Строки храним отдельно: при обрыве ответа порция режется пополам
        // и повторяется (рантайм-детект предела провайдера).
        _rows: slice.map(structureLine),
        _offset: from
      });
    }
  }
  return out;
}

/**
 * Запас по числу позиций при расчёте лимита выхода.
 *
 * `ai-call-budget` считает 50 токенов на позицию — это оценка для короткой
 * строки. У ведомости 2138 позиция длиннее (наименование, цех, отложения,
 * период), и ответ обрывался на `finish_reason=length`. 15 % запаса дают
 * 675 позициям ~43 тыс. токенов вместо 37,7 тыс.
 */
const BUDGET_POSITION_MARGIN = 1.15;

/**
 * Сколько строк давать в первой порции.
 *
 * Это СТАРТОВАЯ догадка, а не измеренная истина: размер дальше подбирается
 * по факту ответа (см. очередь строк в generateDv). Поэтому здесь достаточно
 * консервативной оценки, что одна строка занимает не больше
 * TOKENS_PER_POSITION_PORTION токенов. Если провайдер отдаёт меньше —
 * первая порция не пройдёт, и детект уменьшит её сам.
 *
 * @param {number} modelCap — предел ответа модели в токенах
 * @returns {number} стартовое число строк
 */
function budgetPortionRows(modelCap) {
  const budget = require('./ai-call-budget');
  const perRow = Number(budget.TOKENS_PER_POSITION_PORTION) || 300;
  const safe = Math.floor((Number(modelCap) || 32000) * 0.6);
  return Math.max(16, Math.floor(safe / perRow));
}
function budgetPositions(expectedRows, modelSaid) {
  const n = Math.max(Number(expectedRows) || 0, Number(modelSaid) || 0);
  if (!(n > 0)) return 0;
  return Math.ceil(n * BUDGET_POSITION_MARGIN);
}

/** Текст запроса пользователя — один и тот же во всех раундах первого вызова. */
const DV_USER_PROMPT = 'Перенеси строки таблицы в JSON ПОСТРОЧНО: одна строка = одна позиция. '
  + 'Не суммируй и не объединяй. Верни ТОЛЬКО JSON по схеме.';

/**
 * Собирает вход промпта ДВ: структура (главные данные) + свободный текст (контекст).
 *
 * Вынесено из `generateDv` отдельной функцией, чтобы тест проверял РЕАЛЬНУЮ
 * сборку промпта, а не её копию в тесте.
 *
 * @param {object} p
 * @param {Array} p.documents
 * @param {string} [p.tz_text]
 * @param {object} [p.catalog]
 * @param {string} [p.history_block]
 * @param {object} [p.visit_hints]
 * @param {string} [p.warehouse_text]
 * @param {boolean} [p.omitStructure] — не вставлять полную таблицу (режим порций:
 *   строки придут в сообщении пользователя, иначе модель видит их дважды)
 * @returns {{system:string, user:string, structureText:string, freeText:string,
 *            structured:object, tzText:string}}
 */
function buildDvPrompt(p) {
  const o = p || {};
  const catalog = o.catalog || { categories: [], rates: [] };
  const tzText = String(o.tz_text || '(ТЗ текстом не задано)').slice(0, 300000);
  const structured = buildStructuredInput(o.documents);
  const structureText = o.omitStructure
    ? '(таблица объёмов передана фрагментом в сообщении — разбирай ТОЛЬКО его)'
    : (structured.text || '(таблиц с объёмами не найдено — работай по тексту ниже)');
  const freeText = freeDocsToText(o.documents) || '(документов с текстом нет)';

  const system = promptLoader.buildPrompt('PROMPT-dv-v1.md', {
    catalog: catalogForPrompt(catalog),
    // Порядок в шаблоне: СНАЧАЛА структура (это данные для переноса),
    // потом свободный текст (контекст: ТЗ, письма, условия).
    structure_text: structureText,
    documents_text: freeText,
    tz_text: tzText,
    history_block: o.history_block || '(истории нет)',
    visit_hints: formatVisitHints(o.visit_hints),
    warehouse_text: String(o.warehouse_text || '(данных по складу нет)')
  });

  return {
    system,
    user: DV_USER_PROMPT,
    structureText,
    freeText,
    structured,
    tzText
  };
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
  // Прогресс для SSE/UI: шаги с числами, без «думаю…».
  // Caller (stage/analyze) передаёт onProgress({step,message,pct,...}).
  const t0 = Date.now();
  const emit = (ev) => {
    if (typeof o.onProgress !== 'function') return;
    try {
      o.onProgress(Object.assign({
        type: 'progress',
        elapsed_sec: Math.round((Date.now() - t0) / 1000)
      }, ev || {}));
    } catch (_) { /* UI не должен валить разбор */ }
  };

  const docCount = Array.isArray(o.documents) ? o.documents.filter((d) => d && String(d.text || d.ocr_text || '').trim()).length : 0;

  // ── Два потока входа: структура (данные) и свободный текст (контекст) ────
  // См. комментарий у buildStructuredInput: CSV таблиц в промпт НЕ идёт.
  const prompt = buildDvPrompt({
    documents: o.documents,
    tz_text: o.tz_text,
    catalog,
    history_block: o.history_block,
    visit_hints: o.visit_hints,
    warehouse_text: o.warehouse_text
  });
  const tzText = prompt.tzText;
  const system = prompt.system;
  const structured = prompt.structured;
  const structureText = prompt.structureText;

  emit({
    step: 'prepare',
    message: `Готовлю разбор: документов с текстом — ${docCount}`
      + (structured.rows > 0
        ? `, из них таблица объёмов — ${structured.rows} строк (${structured.periods} периодов)`
        : '')
      + `, ТЗ — ${tzText.length.toLocaleString('ru-RU')} симв.`,
    pct: 3,
    docs: docCount,
    structure_rows: structured.rows,
    structure_periods: structured.periods,
    prompt_chars: system.length,
    tz_chars: tzText.length
  });

  let user = prompt.user;

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
  emit({
    step: 'expect',
    message: expectedRows > 0
      ? `Ориентир по документам: ~${expectedRows} строк перечня (оценка сетки).`
      : 'Сетка не нашла таблицу объёмов — ориентир даст модель по тексту.',
    pct: 8,
    expected_rows: expectedRows,
    expected_min: expectedMin
  });
  // Заполняется из первого ответа модели (source_positions_count).
  let modelSaidPositions = 0;

  const MAX_ROUNDS = 8;
  // Счётчики рантайм-детекта предела провайдера: сколько раз пришлось
  // дробить порцию и сколько строк в итоге не разобралось. Объявлены здесь,
  // а не внутри ветки порций: уходят в отчёт, чтобы неполнота была видна.
  let shrinks = 0;
  let heldRows = 0;
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

  // ── Нарезка: по СТРОКАМ СТРУКТУРЫ, а не по символам CSV ─────────────────
  // Режем всегда, когда расчётный ответ не влезает в ФАКТИЧЕСКИЙ предел
  // провайдера. Раньше здесь предполагалось 128k «по паспорту модели»,
  // поэтому 673 позиции считались влезающими одним вызовом, нарезка не
  // включалась, и модель обрывалась на 115 позициях (прод, 12.11.2026).
  //
  // CSV (`countableText`) больше не участвует: он в промпт не идёт, и
  // нарезка по нему давала порции, которых в промпте нет.
  const chunker = require('./dv-chunker');
  const budget = require('./ai-call-budget');
  const callPlan = budget.planCall({
    expectedPositions: budgetPositions(expectedRows, modelSaidPositions),
    // Считаем ОБЪЁМ ПРОМПТА, а не CSV: именно он уходит в контекст.
    chars: system.length + user.length,
    model: o.model
  });
  // ── Порция: размер НЕ угадывается, а подбирается по ответу ────────────────
  // Раньше здесь стояла константа «330 токенов на позицию», снятая с ОДНОГО
  // тендера (#2138). Это плохо: смена модели, провайдера или формата позиции
  // делала её ложью, и разбор снова начинал терять данные — тихо.
  //
  // Теперь размер подбирается на ходу:
  //   • старт — консервативный (мелкая порция почти всегда проходит);
  //   • ответ прошёл — размер РАСТЁТ (до двух раз), чтобы не гонять сотни
  //     вызовов на большой ведомости;
  //   • ответ оборван (stop=length) или JSON битый — размер делится вдвое;
  //   • итоговый размер закрепляется и попадает в отчёт.
  // Так предел провайдера выясняется по факту, а не берётся из паспорта.
  const startRowsPerChunk = Math.max(20, Math.min(120,
    Math.floor(budgetPortionRows(callPlan.output.modelCap))));
  // ── Чанки считаем ДИНАМИЧЕСКИ, а не один раз вперёд ──────────────────────
  // Размер порции подбирается по ответу модели (см. цикл ниже), поэтому
  // список кусков строится не заранее, а по мере надобности: берём очередные
  // `rowsPerChunk` строк из ещё не разобранного остатка.
  const chunkRowsSource = (() => {
    const entries = (structured && Array.isArray(structured.entries)) ? structured.entries : [];
    const all = [];
    for (const e of entries) {
      const list = (e.parsed && Array.isArray(e.parsed.positions)) ? e.parsed.positions : [];
      for (const p of list) all.push({ row: p, entry: e });
    }
    return all;
  })();
  let rowsPerChunk = startRowsPerChunk;
  // Порции нужны, когда ответ не влезает И строк в ведомости больше, чем
  // помещается в одну порцию. Оба условия обязательны: иначе одна порция
  // равна всей ведомости, и режим порций не нужен.
  const useChunks = callPlan.chunk && chunkRowsSource.length > rowsPerChunk;
  if (!callPlan.chunk) {
    emit({
      step: 'single_call',
      message: `Ведомость влезает одним вызовом: ~${callPlan.output.needed} токенов ответа `
        + `при пределе ${callPlan.output.modelCap}.`
        + (callPlan.output.modelCap >= callPlan.output.needed
          ? ' Без нарезки — значит без потерь на стыках.'
          : ''),
      pct: 12,
      single_call: true,
      needed_tokens: callPlan.output.needed,
      model_cap: callPlan.output.modelCap
    });
  } else if (callPlan.chunk) {
    emit({
      step: 'chunk_plan',
      message: `Нужна нарезка: ${callPlan.reason}.`,
      pct: 12,
      chunk_reason: callPlan.reason
    });
  }

  if (useChunks) {
    // Полная таблица в системном промпте + строки порции в сообщении = модель
    // видит одни и те же данные дважды и путается, из какой части брать.
    // Поэтому для режима порций системный промпт собирается БЕЗ полной таблицы.
    const chunkPrompt = buildDvPrompt({
      documents: o.documents,
      tz_text: o.tz_text,
      catalog,
      history_block: o.history_block,
      visit_hints: o.visit_hints,
      warehouse_text: o.warehouse_text,
      omitStructure: true
    });
    const chunkSystem = chunkPrompt.system;
    emit({
      step: 'chunks',
      message: `Большая ведомость: разбираю порциями по строкам таблицы. `
        + `Размер порции подбираю по ответу модели (старт ${rowsPerChunk} строк).`,
      pct: 12,
      structure_rows: structured.rows,
      rows_per_chunk: rowsPerChunk
    });

    // ── Очередь строк: размер порции подбирается по ответу ────────────────
    // Не режем заранее: строки берутся из остатка текущим `rowsPerChunk`.
    //   • ответ прошёл — размер растёт (до двух раз), чтобы не гонять
    //     сотни вызовов на большой ведомости;
    //   • оборван (stop=length) или JSON битый — пополам и повтор;
    //   • мельче MIN_PORTION строк не дробим: честно пишем в потери.
    const MIN_PORTION = 8;
    const perChunk = [];
    let cursor = 0;
    let chunkNo = 0;
    let guardTotal = 0;
    let growUps = 0;

    while (cursor < chunkRowsSource.length && guardTotal < 200) {
      guardTotal += 1;
      chunkNo += 1;
      const slice = chunkRowsSource.slice(cursor, cursor + rowsPerChunk);
      const fromLine = cursor + 1;
      const toLine = cursor + slice.length;
      const rows = slice.map((x) => structureLine(x.row));
      const chunkPct = 12 + Math.round((cursor / Math.max(chunkRowsSource.length, 1)) * 55);

      emit({
        step: 'chunk_wait',
        message: `Порция ${chunkNo}: строки ${fromLine}–${toLine} (${rows.length}) — жду модель…`,
        pct: chunkPct,
        chunk: chunkNo,
        rows: rows.length,
        rows_per_chunk: rowsPerChunk,
        positions: allPositions.length
      });

      const text = rows.join('\n');
      const outLimit = Math.min(64000, Math.max(16000,
        budget.outputLimit({
          expectedPositions: Math.ceil(rows.length * BUDGET_POSITION_MARGIN),
          model: o.model
        }).limit));

      let res = null;
      try {
        res = await completeOrStream(o.aiProvider, {
          system: chunkSystem,
          messages: [{
            role: 'user',
            content: `Перенеси ВСЕ строки этой порции таблицы в JSON — по одной позиции на строку. `
              + `Ничего не суммируй, ничего не пропускай. Порция: строки ${fromLine}–${toLine}.\n\n`
              + text
          }],
          maxTokens: outLimit,
          temperature: 0,
          expectJson: true,
          reasoning: { enabled: false },
          model: o.model
        }, typeof o.onProgress === 'function' ? emit : null, {
          pct: chunkPct,
          label: `порция ${chunkNo}`
        });
      } catch (e) {
        emit({
          step: 'chunk_fail',
          message: `Порция ${chunkNo} не ответила: ${String(e.message || '').slice(0, 80)}`,
          chunk: chunkNo
        });
        res = null;
      }

      const stopReason = String((res && res.stopReason) || '').toLowerCase();
      const truncated = stopReason === 'length' || stopReason === 'max_tokens';
      const parsed = res ? safeJson(res.text) : null;

      if (truncated || !parsed) {
        if (rows.length > MIN_PORTION) {
          // Делим пополам и пробуем тот же участок снова — курсор НЕ двигаем.
          rowsPerChunk = Math.max(MIN_PORTION, Math.floor(rows.length / 2));
          shrinks += 1;
          emit({
            step: 'chunk_shrink',
            message: `Порция ${chunkNo}: ответ оборван (${truncated ? 'stop=length' : 'JSON не собрался'}) — `
              + `уменьшаю до ${rowsPerChunk} строк и повторяю.`,
            pct: chunkPct,
            chunk: chunkNo,
            rows: rows.length,
            rows_per_chunk: rowsPerChunk,
            shrinks
          });
          continue;
        }
        // Мельче некуда — строки честно считаем потерянными и идём дальше.
        heldRows += rows.length;
        cursor += rows.length;
        emit({
          step: 'chunk_lost_rows',
          message: `Порция ${chunkNo}: ${rows.length} строк не разобралось даже по ${rows.length} — `
            + `попадут в предупреждения.`,
          chunk: chunkNo,
          rows: rows.length
        });
        continue;
      }

      // Успех: позиции в котёл, курсор двигаем, размер порции растёт.
      const dvPart = stages.normalizeDv(parsed, catalog);
      if (!firstDv) firstDv = dvPart;
      perChunk.push(dvPart.positions || []);
      const got = (dvPart.positions || []).length;
      heldRows += Math.max(0, rows.length - got);
      const said = Number(parsed.source_positions_count);
      if (Number.isFinite(said) && said > 0) modelSaidPositions += Math.round(said);
      cursor += rows.length;

      const interim = chunker.mergeChunkPositions(perChunk);
      emit({
        step: 'chunk_done',
        message: `Порция ${chunkNo}: +${got} поз. Собрано ${interim.length}.`,
        pct: 12 + Math.round((cursor / Math.max(chunkRowsSource.length, 1)) * 55),
        chunk: chunkNo,
        rows: rows.length,
        rows_per_chunk: rowsPerChunk,
        positions: interim.length,
        chunk_positions: got
      });

      // Рост: пока ответ проходит и порций впереди много — удваиваем размер.
      const left = chunkRowsSource.length - cursor;
      if (left > rowsPerChunk && growUps < 3 && rowsPerChunk < 250) {
        rowsPerChunk = Math.min(250, Math.floor(rowsPerChunk * 2));
        growUps += 1;
        emit({
          step: 'chunk_grow',
          message: `Ответ прошёл — увеличиваю порцию до ${rowsPerChunk} строк.`,
          pct: chunkPct,
          rows_per_chunk: rowsPerChunk
        });
      }
    }
    rounds += chunkNo;

    // Склейка с удалением повторов на стыках порций.
    allPositions.push(...chunker.mergeChunkPositions(perChunk));
    lastAdded = allPositions.length;
    emit({
      step: 'chunks_merged',
      message: `Склеил порции: ${allPositions.length} уникальных позиций.`,
      pct: 70,
      positions: allPositions.length
    });
  }

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    // Порционный разбор уже собрал позиции — обычный цикл не нужен.
    if (useChunks && allPositions.length) break;
    emit({
      step: 'round_wait',
      message: round === 0
        ? 'Отправил ведомость в модель — жду полный JSON (это может занять несколько минут)…'
        : `Добор раунд ${round + 1}/${MAX_ROUNDS}: уже ${allPositions.length} поз., прошу продолжить…`,
      pct: 15 + Math.min(50, round * 8),
      round: round + 1,
      rounds_max: MAX_ROUNDS,
      positions: allPositions.length
    });
    let res;
    const outLimit = budget.outputLimit({
      // Запас 15 %: у ведомости позиция длиннее, чем 50 токенов из оценки
      // ai-call-budget, и без запаса ответ обрывался по length.
      expectedPositions: budgetPositions(expectedRows, modelSaidPositions),
      model: o.model
    }).limit;
    try {
      // Стрим токенов, когда есть onProgress: UI видит прирост JSON, а не
      // минуты тишины на «15% жду». Без onProgress — прежний complete().
      res = await completeOrStream(o.aiProvider, {
        system,
        messages: [{ role: 'user', content: user }],
        maxTokens: outLimit,
        temperature: 0,
        responseFormat: { type: 'json_object' },
        reasoning: { enabled: false },
        model: o.model
      }, typeof o.onProgress === 'function' ? emit : null, {
        pct: 15 + Math.min(50, round * 8),
        label: `раунд ${round + 1}`
      });
    } catch (e) {
      emit({ step: 'error', message: 'Модель недоступна: ' + e.message, pct: null });
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
    {
      const orient = Math.max(modelSaidPositions || 0, expectedRows || 0);
      emit({
        step: 'round_done',
        message: `Раунд ${round + 1}: +${added} новых (всего ${allPositions.length}`
          + (orient ? `, ориентир ${orient}` : '')
          + ')'
          + (finishedByLength ? ' — ответ обрезан, буду добирать' : ''),
        pct: 20 + Math.min(55, Math.round((allPositions.length / Math.max(orient || allPositions.length || 1, 1)) * 55)),
        round: round + 1,
        positions: allPositions.length,
        added,
        truncated: !!finishedByLength,
        model_said: modelSaidPositions || null,
        expected_rows: expectedRows || null
      });
    }

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
    // Необрезанный — тоже добираем, если позиций МЕНЬШЕ ожидаемого.
    //
    // Дефект, найденный на проде 12.11: модель на втором раунде вернула
    // ЗАКРЫТЫЙ JSON (stop), но всего 289 позиций. Флаг обрезки стал false,
    // и добор прекратился на 612 из 1348 — хотя половина ведомости не
    // разобрана. Полнота определяется КОЛИЧЕСТВОМ против ожидания, а не
    // тем, закрыл ли модель массив.
    if (!wasTruncated) {
      // Один «необрезанный» недобор прощаем: модель могла ответить на
      // другом языке/формате. Но если и он не добрал 20 % ожидаемого —
      // дальше просить бессмысленно.
      if (round > 0 && validCount < expectedMin * 0.8) {
        // продолжаем: недобор существенный
      } else if (round > 0) {
        break;
      }
    }

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
  // Schedule-pass после порций/раундов: firstDv часто без visits[] (хвост
  // JSON съеден или первая порция без графика). Дособираем детерминированно.
  try {
    const visitSvc = require('./visit-plan');
    const schedulePass = visitSvc.buildVisitPlan({
      positions: allPositions,
      text: (Array.isArray(o.documents) ? o.documents : [])
        .map((d) => String(d && d.text || '')).join('\n'),
      modelPlan: {
        schedule_mode: dv.schedule_mode || null,
        visits: Array.isArray(dv.visits) ? dv.visits : [],
        trip_count: dv.trip_count || null
      }
    });
    if (schedulePass) {
      const modelVisitsEmpty = !Array.isArray(dv.visits) || !dv.visits.length;
      const tzContinuous = schedulePass.mode === 'continuous'
        && (schedulePass.source === 'docs_tz'
          || (Array.isArray(schedulePass.conflicts)
            && schedulePass.conflicts.some((c) => c.resolved_as === 'continuous')));
      // Доверяем досбору, если модель молчала / visits пусты / ТЗ continuous.
      if (!dv.schedule_mode || dv.schedule_mode === 'unknown'
        || modelVisitsEmpty || tzContinuous) {
        dv.schedule_mode = schedulePass.mode || dv.schedule_mode;
      }
      if (!(Number(dv.trip_count) > 0) || modelVisitsEmpty || tzContinuous) {
        if (schedulePass.trip_count) dv.trip_count = schedulePass.trip_count;
      }
      if ((modelVisitsEmpty || tzContinuous)
        && Array.isArray(schedulePass.visits) && schedulePass.visits.length) {
        dv.visits = schedulePass.visits.map((v) => ({
          id: v.id,
          label: v.label,
          period_start: v.period_start || null,
          period_end: v.period_end || null,
          position_ids: v.position_ids || []
        }));
      }
      dv.visit_plan_pass = {
        mode: schedulePass.mode,
        trip_count: schedulePass.trip_count,
        visits: (schedulePass.visits || []).length,
        source: schedulePass.source,
        unconfirmed: !!schedulePass.unconfirmed
      };
      emit({
        step: 'schedule_pass',
        message: schedulePass.mode === 'visits'
          ? `График (досбор): ${schedulePass.trip_count} заезд(ов).`
          : schedulePass.mode === 'continuous'
            ? 'График (досбор): один непрерывный заезд.'
            : 'График (досбор): режим не подтверждён.',
        pct: 84,
        visit_mode: schedulePass.mode,
        trip_count: schedulePass.trip_count
      });
    }
  } catch (_) { /* досбор графика не блокирует разбор */ }
  // Считаем валидные позиции ДО сверки полноты: `checkCompleteness` получает
  // это число параметром. Раньше строка `const validFound = ...` стояла ниже
  // вызова и модуль падал с «Cannot access 'validFound' before initialization»
  // — весь разбор ДВ обрывался (найдено 10.11.2026).
  const validFound = countValidPositions(allPositions);

  // ── Роль «объёмы» из dv-agents: проверка полноты ──────────────────────────
  // Модуль ролей (dv-agents) держит три раздельных промпта и функцию сверки
  // «сколько строк перечня увидели — сколько позиций выписали». Здесь
  // используется именно сверка: она ловит случай «модель прочитала таблицу
  // и молча выписала треть», не требуя угадывать формат документа.
  const agents = require('./dv-agents');
  const agentsCompleteness = agents.checkCompleteness(
    Math.max(expectedRows || 0, modelSaidPositions || 0),
    validFound
  );

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

  // Флаг полноты обязан попасть В САМУ ДВ, а не только в ответ функции:
  // карточка сохраняет `dv`, и без этих полей UI видит incomplete = undefined,
  // то есть «всё хорошо», хотя разбор неполный. На проде это дало 612
  // позиций из 1348 с молчаливым «полно».
  dv.incomplete = !!incomplete;
  dv.expected_rows = expectedFinal || null;
  dv.found_positions = validFound;
  dv.rounds = rounds;
  dv.incomplete_reason = incomplete
    ? (lastTruncated
      ? `модель не успела выдать весь разбор: ${validFound} из ~${expectedFinal || '?'}`
      : (exhaustedRounds
        ? `исчерпаны раунды добора: ${validFound} из ~${expectedFinal || '?'}`
        : `собрано меньше половины ожидаемого: ${validFound} из ~${expectedFinal}`))
    : null;

  emit({
    step: 'dv_ready',
    message: incomplete
      ? `Разбор неполный: ${validFound} позиций` + (expectedFinal ? ` из ~${expectedFinal}` : '') + '. Проверьте ведомость.'
      : `Разбор готов: ${validFound} позиций с объёмом` + (allPositions.length !== validFound ? ` (всего строк ${allPositions.length})` : '') + '.',
    pct: 85,
    positions: allPositions.length,
    valid_positions: validFound,
    expected_rows: expectedFinal,
    incomplete: !!incomplete
  });

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
    // Заключение роли объёмов: отдельное поле, чтобы модалка показала его
    // даже когда общая оценка выглядит нормально, а строки разошлись.
    agents_completeness: agentsCompleteness,
    // Рантайм-детект предела провайдера: сколько раз пришлось дробить порцию
    // и сколько строк не разобралось даже после дробления. Без этих чисел
    // неполнота разбора снова стала бы невидимой.
    portion_shrinks: typeof shrinks === 'number' ? shrinks : 0,
    portion_lost_rows: typeof heldRows === 'number' ? heldRows : 0,
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
      `${i + 1}. [${x.id || ('p' + (i + 1))}] ${x.name} — ${x.volume} ${x.unit}`
      + ` · ${x.category_code}.${x.method_code || '—'}`
      + (x.period || x.period_start
        ? `\n   срок/заезд: ${x.period || ''}`
          + (x.period_start ? ` (${x.period_start}` + (x.period_end ? `…${x.period_end}` : '') + ')' : '')
          + (x.visit_id ? ` · visit=${x.visit_id}` : '')
        : '')
      + (x.tech_equip ? `\n   технология: ${x.tech_equip}` : '')
      + (Array.isArray(x.objects) && x.objects.length
        ? `\n   аппараты: ${x.objects.map((ob) => ob.tag || ob.type).filter(Boolean).join(', ')}` : '')
    ).join('\n'),
    tech_equip: positions.map((x) => x.tech_equip).filter(Boolean).join('; ') || '(не задана)',
    norm_preview: o.normPreviewMd || '(нормативов нет)',
    workers: o.workersMd || '(данные по бригаде не переданы)',
    date_window: o.dateWindow != null ? String(o.dateWindow) : '(не задано)',
    max_parallel_posts: String(o.maxParallelPosts || 2)
  });

  const user = 'Разложи работы по аппаратам и ЗАЕЗДАМ: люди, сроки, оборудование, trip_count/visits и источник каждой цифры. Только JSON.';

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

  // Фронты из ДВ: иначе calc-модель на 600+ позициях не отдаёт objects
  // и resolveFronts ставит 1 → срок раздувается.
  const dvObjectsTotal = positions.reduce((s, p) => {
    const objs = Array.isArray(p.objects) ? p.objects : [];
    const q = objs.reduce((acc, ob) => acc + (Number(ob && ob.qty) || 0), 0);
    if (q > 0) return s + q;
    if (objs.length) return s + objs.length;
    if (Number(p.objects_count) > 0) return s + Number(p.objects_count);
    return s;
  }, 0);
  // Прокидываем objects/mh/source с ДВ в позиции плана, если модель их сжала.
  if (Array.isArray(parsed.positions)) {
    parsed.positions = parsed.positions.map((pp, i) => {
      const src = positions.find((x) => String(x.id) === String(pp.id))
        || positions[i]
        || null;
      if (!src) return pp;
      return Object.assign({}, pp, {
        objects: Array.isArray(pp.objects) && pp.objects.length
          ? pp.objects
          : (Array.isArray(src.objects) ? src.objects : pp.objects),
        objects_count: pp.objects_count != null
          ? pp.objects_count
          : (src.objects_count != null ? src.objects_count : null),
        mh: Number(pp.mh) > 0 ? pp.mh : (Number(src.mh) > 0 ? src.mh : null),
        days: Number(pp.days) > 0 ? pp.days : (Number(src.days) > 0 ? src.days : null),
        people: Number(pp.people) > 0 ? pp.people : (Number(src.people) > 0 ? src.people : null),
        source: pp.source || src.source || null,
        norm_basis: pp.norm_basis || src.norm_basis || (src.norm && src.norm.norm_basis) || null,
        period: pp.period || src.period || null
      });
    });
  }
  const plan = stages.normalizeCalcPlan(parsed, {
    max_parallel_posts: o.maxParallelPosts,
    // Окно дат нужно, чтобы подобрать число бригад под график заказчика.
    window_days: o.dateWindow,
    // Периоды ДВ → число заездов (сентябрь ≠ декабрь), если модель не дала trip_count.
    dv_positions: positions,
    // Режим заездов: при нескольких выездах бригада едет последовательно,
    // и число бригад нельзя размножать по объёму (иначе 6 заездов за 16 дней).
    visit_mode: o.visitMode || null,
    trip_count: o.tripCount || null,
    fronts: Number(o.fronts) > 0 ? Number(o.fronts) : (dvObjectsTotal > 0 ? dvObjectsTotal : null),
    // Базис нормы: gross-норма уже содержит внутрисменные потери, вычитать их
    // повторно нельзя. Определяем по коду нормы из каталога — иначе защита
    // от двойного счёта остаётся мёртвой (нашёл верификатор).
    norm_basis: resolvePlanNormBasis(parsed, o.catalog, o.normBasis)
  });
  return {
    ok: true,
    plan,
    model: res.model || null,
    provider: res.provider || null,
    tokens: res.usage || null
  };
}

/**
 * Базис нормы для плана расчёта.
 *
 * Модель возвращает позиции с кодом нормы, но без флага базиса. Сам флаг
 * живёт в каталоге (`params_json.norm_basis`, а если пусто — по `calc_kind`).
 * Собираем по всем позициям: если базисы одинаковые — он один, если
 * разные — `null` (план возьмёт net_productive и добавит потери, что
 * безопаснее занижения).
 *
 * @param {object} parsed — ответ модели (positions с rate_code/method_code)
 * @param {object} catalog — loadCatalog()
 * @param {string} [explicit] — если вызывающий знает базис точно
 * @returns {string|null}
 */
function resolvePlanNormBasis(parsed, catalog, explicit) {
  if (explicit === 'gross_12h' || explicit === 'gross_calendar' || explicit === 'net_productive') {
    return explicit;
  }
  const rates = (catalog && Array.isArray(catalog.rates)) ? catalog.rates : [];
  if (!rates.length) return null;
  const byCode = new Map();
  for (const r of rates) {
    if (r && r.code) byCode.set(String(r.code), r);
  }
  const list = (parsed && Array.isArray(parsed.positions)) ? parsed.positions : [];
  const seen = new Set();
  for (const p of list) {
    const code = String((p && (p.rate_code || p.norm_code || p.code)) || '');
    if (!code) continue;
    const r = byCode.get(code);
    if (r && r.norm_basis) seen.add(r.norm_basis);
  }
  if (seen.size === 1) return [...seen][0];
  // Разные базисы в одной смете: берём осторожный (потери добавим).
  return null;
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
  // Сборка входа ДВ: структура + свободный текст. Экспортируется, чтобы тест
  // проверял реальную сборку промпта, а не её копию.
  buildDvPrompt,
  buildStructuredInput,
  parseSpreadsheetText,
  structurePromptText,
  chunkStructureRows,
  estimateExpectedForSelection,
  lastSelection: () => lastSelection,
  safeJson,
  volumeKeyFor
};
