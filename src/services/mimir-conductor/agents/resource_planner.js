/**
 * ASGARD CRM — Mimir Conductor: агент «Нормативный привязчик» (Сессия 6, Шаг 6.3)
 * ═══════════════════════════════════════════════════════════════════════════
 * Привязывает работы из tz_summary к нормативам ГЭСН/ФЕР/СТО через RAG-поиск
 * (rag/norms-index.searchNorms) и LLM-подбор (Yandex GPT 5 Pro через ai-provider).
 *
 * Артефакт: resources
 *   { summary, key_findings[], resources:[{work, code, source, materials[],
 *     labor_man_hours, machinery_hours, note}], to_purchase_hint[] }
 *
 * STUB-режим (баланс не тратится): LLM не вызывается реально → ресурсы
 * собираются детерминированно из найденных RAG-нормативов (их resources-поля).
 * Если индекс пуст или нормы не найдены — типовая раскладка по эвристике.
 *
 * ВАЖНО: модель yandex-pro в ai-provider ходит отдельным путём (Yandex). Если
 * ключ не настроен — complete() уйдёт в demo/ошибку, поэтому ВСЕГДА страхуемся
 * isStubMode() + try/catch и детерминированным фолбэком.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const aiProvider = require('../../ai-provider');
const { searchNorms } = require('../rag/norms-index');
const { parseStrictJson } = require('./_util');

const SYSTEM_PROMPT = `Ты — сметчик-нормировщик ООО «Асгард Сервис».
Привязываешь работы к нормативам ГЭСН/ФЕР/СТО и считаешь раскладку ресурсов.
Тебе дают работу и найденные кандидаты-нормативы. Выбери наиболее подходящий
и выдай раскладку на ЗАДАННЫЙ объём.

Верни СТРОГО JSON:
{ "code": "...", "source": "GESN|FER|STO_...", "materials": [ {"name":"...","qty":0,"unit":"..."} ],
  "labor_man_hours": 0, "machinery_hours": 0, "note": "обоснование выбора" }`;

/** Детерминированная раскладка из RAG-норматива на нужный объём. */
function deriveFromNorm(work, norm) {
  const vol = Number(work.volume) || 1;
  const r = (norm && norm.resources) || {};
  // resources в SEED заданы «на единицу norm.unit» — масштабируем приблизительно.
  const laborPerUnit = Number(r.labor_man_hours_per_unit) || 0;
  const machPerUnit = Number(r.machinery_hours_per_unit) || 0;
  // Грубый коэффициент масштабирования: объём работы / 100 (нормы часто на 100 ед.).
  const scale = vol / 100 || 1;
  const materials = Array.isArray(r.materials)
    ? r.materials.map((m) => (typeof m === 'string' ? { name: m, qty: null, unit: null } : m))
    : [];
  return {
    code: norm ? norm.code : null,
    source: norm ? norm.source : null,
    materials,
    labor_man_hours: Math.round(laborPerUnit * scale * 10) / 10,
    machinery_hours: Math.round(machPerUnit * scale * 10) / 10,
    note: norm ? `Привязано к ${norm.code} (${norm._via || 'rag'})` : 'Норматив не найден — типовая эвристика'
  };
}

/** Типовая раскладка, если нормативов нет вовсе. */
function fallbackResource(work) {
  const vol = Number(work.volume) || 1;
  return {
    code: null,
    source: null,
    materials: [{ name: 'Материалы по объёму', qty: Math.round(vol), unit: work.volume_unit || 'ед.' }],
    labor_man_hours: Math.round(vol * 0.5 * 10) / 10,
    machinery_hours: Math.round(vol * 0.1 * 10) / 10,
    note: 'Нормативы не найдены — раскладка по эвристике (0.5 чел-ч/ед.)'
  };
}

async function run({ requiredArtifacts, onThought }) {
  const tz = requiredArtifacts.tz_summary || {};
  const works = (tz.scope && Array.isArray(tz.scope.main_works)) ? tz.scope.main_works : [];

  if (!works.length) {
    onThought('В сводке ТЗ нет перечня работ — ресурсная ведомость пуста');
    return {
      summary: 'Ресурсная ведомость пуста: в tz_summary нет main_works',
      key_findings: ['Нет работ для нормирования (вероятно stub tz_summary или нет ТЗ)'],
      resources: [],
      to_purchase_hint: []
    };
  }

  const stub = aiProvider.isStubMode();
  const resources = [];

  for (const work of works) {
    const label = `${work.type || ''} ${work.object || ''}`.trim();
    onThought(`Привязываю «${label}» к нормативам…`);

    const query = `${work.type || ''} ${work.object || ''} ${work.volume_unit || ''}`.trim();
    let norms = [];
    try {
      norms = await searchNorms(query, 5);
    } catch (e) {
      onThought(`⚠ RAG-поиск недоступен: ${e.message}`);
    }

    let row;
    if (stub) {
      // STUB: берём топ-норматив из RAG и выводим раскладку детерминированно.
      row = norms.length ? deriveFromNorm(work, norms[0]) : fallbackResource(work);
    } else {
      // LIVE: Yandex GPT выбирает норматив и считает ресурсы.
      try {
        const prompt =
          `Работа: ${work.type} ${work.object}, объём ${work.volume} ${work.volume_unit}.\n\n` +
          `Найденные нормативы:\n` +
          norms.map((n) => `${n.code} (${n.source}): ${n.name}\n  ${String(n.full_text || '').slice(0, 500)}`).join('\n\n') +
          `\n\nПодбери подходящий и выдай раскладку ресурсов на объём ${work.volume}.`;
        const result = await aiProvider.complete({
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: prompt }],
          model: 'yandex-pro',
          maxTokens: 2000
        });
        row = parseStrictJson(result.text);
      } catch (e) {
        onThought(`⚠ LLM-привязка не удалась (${e.message}) — беру RAG-норматив`);
        row = norms.length ? deriveFromNorm(work, norms[0]) : fallbackResource(work);
      }
    }

    resources.push({ work: { type: work.type, object: work.object, volume: work.volume, volume_unit: work.volume_unit }, ...row });
  }

  // Подсказка закупщику: материалы без кода склада — кандидаты на закупку.
  const toPurchaseHint = [];
  for (const r of resources) {
    for (const m of r.materials || []) {
      if (m && m.name) toPurchaseHint.push({ name: m.name, qty: m.qty, unit: m.unit, from_work: r.work.type });
    }
  }

  return {
    summary: `Привязано ${resources.length} работ к нормативам${stub ? ' (stub: RAG + эвристика, LLM не вызывался)' : ''}`,
    key_findings: resources.slice(0, 8).map((r) => `${r.work.type}: ${r.code || 'без норматива'} — ${r.labor_man_hours} чел-ч`),
    resources,
    to_purchase_hint: toPurchaseHint,
    clarifications: []
  };
}

module.exports = { run };
