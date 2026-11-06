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
function docsToText(documents, limit = 400000) {
  const list = Array.isArray(documents) ? documents : [];

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

  const parts = [];
  for (const it of items) {
    const head = `=== ${it.name}${it.roleTitle ? ` [${it.roleTitle}]` : ''} ===\n`;
    const quota = Math.max(minPer, Math.floor((budget * (it.pr || 1)) / totalWeight));
    const room = Math.max(800, quota - head.length);

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

  const user = 'Составь ведомость объёмов по этим данным. Верни ТОЛЬКО JSON по схеме.';

  let res;
  try {
    // response_format json_object + отключённый reasoning: иначе DeepSeek
    // уходит в 8000 токенов рассуждений и возвращает пустой content
    // (finish_reason=length). Проверено на проде 06.11.2026.
    //
    // maxTokens поднят до 32000: на тендере 2133 было 553 тыс. символов
    // документов, и при 12000 ответ обрывался на середине массива позиций.
    res = await o.aiProvider.complete({
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 32000,
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
      error: 'Модель вернула ответ не по схеме — попробуйте ещё раз',
      raw: (res && res.text || '').slice(0, 500)
    };
  }

  const dv = stages.normalizeDv(parsed, catalog);
  return {
    ok: true,
    dv,
    salvaged: !!parsed._salvaged,
    model: res.model || null,
    provider: res.provider || null,
    tokens: res.usage || null
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
  generateDv,
  generateCalcPlan,
  buildCalibrationPreview,
  catalogForPrompt,
  docsToText,
  lastSelection: () => lastSelection,
  safeJson,
  volumeKeyFor
};
