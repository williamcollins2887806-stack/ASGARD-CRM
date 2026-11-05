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

/** Каталог категорий и методов в компактном виде для промпта. */
function catalogForPrompt(catalog) {
  const cats = (catalog && Array.isArray(catalog.categories)) ? catalog.categories : [];
  const rates = (catalog && Array.isArray(catalog.rates)) ? catalog.rates : [];
  return cats.map((c) => {
    const ms = Array.isArray(c.methods_json) ? c.methods_json : [];
    const lines = ms.map((m) => {
      const rate = rates.find((r) => r.code === m.primary_rate_code);
      const unit = (rate && rate.unit) || m.volume_unit || '—';
      const kind = rate ? rate.calc_kind : (m.derived_metric || '—');
      return `  - ${m.code} (${m.label || m.code}): единица «${unit}», считать как ${kind}`;
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
  return null;
}

function docsToText(documents, limit = 60000) {
  const list = Array.isArray(documents) ? documents : [];
  const parts = list
    .map((d) => {
      const name = d.original_name || d.filename || d.name || 'документ';
      const text = String(d.text || d.ocr_text || d.content || '').trim();
      if (!text) return null;
      return `=== ${name} ===\n${text}`;
    })
    .filter(Boolean);
  const out = parts.join('\n\n');
  return out.length > limit ? out.slice(0, limit) + '\n… (обрезано)' : out;
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
  const system = promptLoader.buildPrompt('PROMPT-dv-v1.md', {
    catalog: catalogForPrompt(catalog),
    tz_text: String(o.tz_text || '(ТЗ текстом не задано)').slice(0, 40000),
    documents_text: docsToText(o.documents) || '(документов с текстом нет)',
    history_block: o.history_block || '(истории нет)'
  });

  const user = 'Составь ведомость объёмов по этим данным. Верни ТОЛЬКО JSON по схеме.';

  let res;
  try {
    res = await o.aiProvider.complete({
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 8000,
      temperature: 0.15
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
      maxTokens: 8000,
      temperature: 0.15
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

  const plan = stages.normalizeCalcPlan(parsed, { max_parallel_posts: o.maxParallelPosts });
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
  safeJson,
  volumeKeyFor
};
